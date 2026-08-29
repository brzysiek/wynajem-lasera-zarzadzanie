#!/usr/bin/env bash
# Run over SSH by the GitHub Actions workflow after deploy-pull.sh (source
# sync) and after the pre-built .next/ artifact has been rsynced into
# APP_DIR. Installs deps (light enough to run here) and generates the
# Prisma client natively for this server's own platform, then restarts the
# app. Does NOT run `next build` — that happens in CI, see deploy-pull.sh
# for why.

set -euo pipefail

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

echo "==> Generating Prisma client"
# Prisma's CLI spawns a detached "checkpoint" child on every invocation to
# phone home for a version check. Under this account's CloudLinux LVE process
# cap that extra fork intermittently fails with `spawn ... EAGAIN` and takes
# the whole deploy down (it has nothing to do with codegen itself). These
# vars make checkpoint-client a no-op so `generate` never forks it. Retry a
# couple of times regardless, in case the LVE budget is momentarily used up
# by another process on the account.
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

echo "==> Applying database migrations"
# NOT `prisma migrate deploy`: it spawns the Rust schema engine, which hangs
# under this account's CloudLinux LVE limits (same reason next build runs in
# CI and the app uses the mariadb driver adapter). deploy/migrate.mjs applies
# prisma/migrations/*/migration.sql with the plain-JS mariadb driver and
# records them in _prisma_migrations in Prisma's own format. It self-baselines
# a pre-existing database (0_init marked applied, not executed) on first run.
node deploy/migrate.mjs

echo "==> Restarting app (Passenger restart trigger)"
mkdir -p tmp
touch tmp/restart.txt

echo "==> Deploy finished ($(git rev-parse --short HEAD))"
