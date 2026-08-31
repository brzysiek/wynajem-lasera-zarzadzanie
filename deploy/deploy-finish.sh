#!/usr/bin/env bash
# Run over SSH by the GitHub Actions workflow after deploy-pull.sh (source
# sync) and after the pre-built .next/ artifact + prisma-client.tgz have been
# rsynced into APP_DIR. Installs deps (light enough to run here), unpacks the
# CI-generated Prisma client, applies migrations, restarts the app. Does NOT
# run `next build` OR `prisma generate` — both spawn too many threads for
# this account's CloudLinux LVE cap; see deploy-pull.sh and the Prisma step
# below.

set -euo pipefail

# Stop `@prisma/client`'s install script from trying to run `prisma generate`
# during `npm install` — on this LVE-capped account codegen aborts with
# `pthread_create: Resource temporarily unavailable`. The client is shipped
# pre-generated from CI instead (prisma-client.tgz).
export PRISMA_SKIP_POSTINSTALL_GENERATE=true

APP_DIR="${APP_DIR:?Set APP_DIR, e.g. /home/USERNAME/wynajem-lasera-zarzadzanie}"
NODEVENV_DIR="${NODEVENV_DIR:?Set NODEVENV_DIR, e.g. /home/USERNAME/nodevenv/wynajem-lasera-zarzadzanie/20}"

cd "$APP_DIR"

echo "==> Activating cPanel Node.js virtual environment"
# cPanel's activate script isn't written to be safe under `set -u` — it
# references CL_VIRTUAL_ENV without a default, which aborts the deploy
# here even though it's harmless. Relax nounset just for the source.
set +u
# shellcheck disable=SC1091
source "$NODEVENV_DIR/bin/activate"
set -u

echo "==> Installing dependencies"
npm install

echo "==> Prisma client"
# `prisma generate` can't run here: its codegen spawns worker threads and
# this account's CloudLinux LVE cap kills them with `pthread_create:
# Resource temporarily unavailable` (same class as `next build` and the
# Rust query engine). The client is generated in CI and rsynced in as
# prisma-client.tgz (contents: node_modules/.prisma). It's platform-portable
# here because the app talks to the DB through @prisma/adapter-mariadb (plain
# JS driver), so the bundled native query-engine binary is never loaded.
if [[ -f prisma-client.tgz ]]; then
  echo "    unpacking CI-generated client"
  rm -rf node_modules/.prisma
  tar xzf prisma-client.tgz -C node_modules
  rm -f prisma-client.tgz
elif [[ -d node_modules/.prisma/client ]]; then
  echo "    no CI bundle this run — keeping the client already in node_modules"
else
  echo "    no CI bundle and no existing client — falling back to on-server generate" >&2
  export CHECKPOINT_DISABLE=1
  export PRISMA_HIDE_UPDATE_MESSAGE=1
  for attempt in 1 2 3; do
    if npx prisma generate; then
      break
    fi
    if [[ "$attempt" -eq 3 ]]; then
      echo "prisma generate failed after $attempt attempts" >&2
      exit 1
    fi
    echo "prisma generate attempt $attempt failed; retrying in 10s..." >&2
    sleep 10
  done
fi

echo "==> Applying database migrations"
# NOT `prisma migrate deploy`: it spawns the Rust schema engine, which hangs
# under this account's CloudLinux LVE limits (same reason next build runs in
# CI and the app uses the mariadb driver adapter). deploy/migrate.mjs applies
# prisma/migrations/*/migration.sql with the plain-JS mariadb driver and
# records them in _prisma_migrations in Prisma's own format. It self-baselines
# a pre-existing database (0_init marked applied, not executed) on first run.
node deploy/migrate.mjs

echo "==> Boot self-test (node server.js, 15s cap)"
# Surfaces a start-up crash (bad Prisma client, missing env, …) directly in
# the GitHub Actions deploy log instead of only in a server-side file the
# operator can't easily reach. Never fails the deploy — informational only.
set +e
timeout 15 node server.js > /tmp/wl-boot-selftest.log 2>&1
selftest_code=$?
set -e
if [[ "$selftest_code" -eq 124 ]]; then
  echo "    server.js still running after 15s — no immediate crash (good)"
else
  echo "    server.js exited on its own (code $selftest_code) — likely a boot crash:"
  echo "    ----------------------------------------------------------------"
  tail -n 60 /tmp/wl-boot-selftest.log | sed 's/^/    /'
  echo "    ----------------------------------------------------------------"
fi
rm -f /tmp/wl-boot-selftest.log

echo "==> Restarting app (Passenger restart trigger)"
mkdir -p tmp
touch tmp/restart.txt

echo "==> Deploy finished ($(git rev-parse --short HEAD))"
