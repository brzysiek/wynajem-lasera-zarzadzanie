#!/usr/bin/env bash
# Run over SSH by the GitHub Actions workflow on every push to main, before
# the built .next/ artifact is rsynced over. Only syncs source (git), does
# not install deps or build — the cyberfolks account's CloudLinux LVE limits
# make `next build` panic (Rust/tokio can't spawn enough OS threads even
# though ulimit -u looks unrestricted), so building happens in CI instead.

set -euo pipefail

APP_DIR="${APP_DIR:?Set APP_DIR, e.g. /home/USERNAME/wynajem-lasera-zarzadzanie}"
NODEVENV_DIR="${NODEVENV_DIR:?Set NODEVENV_DIR, e.g. /home/USERNAME/nodevenv/wynajem-lasera-zarzadzanie/20}"
# Must match the NEXT_PUBLIC_BASE_PATH the deployed build artifact was
# compiled with (see next.config.ts / src/lib/base-path.ts) — Next.js bakes
# basePath into the build, so this can't drift independently of which
# artifact got rsynced here. "" means the app is served at the domain root.
# Uses `-` (not `:-`) so an explicitly empty value from the workflow is kept
# instead of falling back to the default.
BASE_PATH="${BASE_PATH-/wynajem}"

cd "$APP_DIR"

echo "==> Syncing NEXT_PUBLIC_BASE_PATH in .env with this deploy's BASE_PATH"
# server.js's custom server calls next({ dev }), which reloads next.config.ts
# from disk on every process start using THIS PROCESS's own process.env (from
# .env here on the server) — not the env the CI build ran with. NEXT_PUBLIC_*
# inlining only rewrites references inside application code (auth.ts,
# client components, etc.), it does NOT apply to next.config.ts itself, which
# is a plain file evaluated fresh at runtime. Without this, a stale/missing
# NEXT_PUBLIC_BASE_PATH here silently falls back to next.config.ts's own
# "/wynajem" default regardless of what the CI-built .next artifact was
# actually compiled with, mismatching build vs runtime and 404ing every route.
if [[ -f .env ]] && grep -q '^NEXT_PUBLIC_BASE_PATH=' .env; then
  sed -i "s|^NEXT_PUBLIC_BASE_PATH=.*|NEXT_PUBLIC_BASE_PATH=$BASE_PATH|" .env
else
  echo "NEXT_PUBLIC_BASE_PATH=$BASE_PATH" >> .env
fi

echo "==> Fetching latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Source synced ($(git rev-parse --short HEAD))"

echo "==> Generating node-wrapper.sh (ulimit/taskset, exec'd in place of node)"
# lsnode (this account's actual LiteSpeed Node.js/LSAPI integration — see
# server.js's top comment) execs PassengerNodejs directly and tracks that
# exact PID for request routing, so the ulimit/taskset fix has to be applied
# by substituting the node binary itself, not by having the app spawn a
# child (a child gets a new PID lsnode never learns about, which left the
# app alive but orphaned from all traffic). Regenerated every deploy so the
# real node path always matches NODEVENV_DIR.
sed "s#__REAL_NODE_BIN__#$NODEVENV_DIR/bin/node#" deploy/node-wrapper.sh.template > node-wrapper.sh
chmod +x node-wrapper.sh

echo "==> Ensuring .htaccess (Passenger routing config)"
# cPanel's own .htaccess generation for this app has been unreliable (it has
# gone missing entirely at least once, causing plain Apache 404s with no
# app-level error at all), so write it ourselves on every deploy instead of
# relying on the cPanel UI to keep it in sync.
{
  echo "PassengerAppRoot \"$APP_DIR\""
  # Omit the directive entirely for an app served at the domain root —
  # Passenger then treats the vhost's own docroot as the app's base.
  if [[ -n "$BASE_PATH" ]]; then
    echo "PassengerBaseURI \"$BASE_PATH\""
  fi
  cat <<EOF
PassengerNodejs "$APP_DIR/node-wrapper.sh"
PassengerAppType node
PassengerStartupFile server.js
PassengerEnv NODE_ENV production
# Default is 90s; this account's CloudLinux LVE CPU throttling can make a
# cold start (Next.js init + Prisma engine) take longer than that, causing
# Passenger to kill and retry the spawn in a tight loop — which is what
# drove the account's process limit to its cap. Give it more headroom.
PassengerStartTimeout 300
EOF
} > .htaccess

echo "==> Restarting app (Passenger restart trigger)"
mkdir -p tmp
touch tmp/restart.txt
