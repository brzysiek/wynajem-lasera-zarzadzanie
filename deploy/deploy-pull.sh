#!/usr/bin/env bash
# Run over SSH by the GitHub Actions workflow on every push to main, before
# the built .next/ artifact is rsynced over. Only syncs source (git), does
# not install deps or build — the cyberfolks account's CloudLinux LVE limits
# make `next build` panic (Rust/tokio can't spawn enough OS threads even
# though ulimit -u looks unrestricted), so building happens in CI instead.

set -euo pipefail

APP_DIR="${APP_DIR:?Set APP_DIR, e.g. /home/USERNAME/wynajem-lasera-zarzadzanie}"
NODEVENV_DIR="${NODEVENV_DIR:?Set NODEVENV_DIR, e.g. /home/USERNAME/nodevenv/wynajem-lasera-zarzadzanie/20}"

cd "$APP_DIR"

echo "==> Fetching latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Source synced ($(git rev-parse --short HEAD))"

echo "==> Ensuring .htaccess (Passenger routing config)"
# cPanel's own .htaccess generation for this app has been unreliable (it has
# gone missing entirely at least once, causing plain Apache 404s with no
# app-level error at all), so write it ourselves on every deploy instead of
# relying on the cPanel UI to keep it in sync.
cat > .htaccess <<EOF
PassengerAppRoot "$APP_DIR"
PassengerBaseURI "/wynajem"
PassengerNodejs "$NODEVENV_DIR/bin/node"
PassengerAppType node
PassengerStartupFile server.js
PassengerEnv NODE_ENV production
# Default is 90s; this account's CloudLinux LVE CPU throttling can make a
# cold start (Next.js init + Prisma engine) take longer than that, causing
# Passenger to kill and retry the spawn in a tight loop — which is what
# drove the account's process limit to its cap. Give it more headroom.
PassengerStartTimeout 300
EOF

echo "==> Restarting app (Passenger restart trigger)"
mkdir -p tmp
touch tmp/restart.txt
