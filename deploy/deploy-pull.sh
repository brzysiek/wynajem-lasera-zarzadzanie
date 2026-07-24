#!/usr/bin/env bash
# Run over SSH by the GitHub Actions workflow on every push to main, before
# the built .next/ artifact is rsynced over. Only syncs source (git), does
# not install deps or build — the cyberfolks account's CloudLinux LVE limits
# make `next build` panic (Rust/tokio can't spawn enough OS threads even
# though ulimit -u looks unrestricted), so building happens in CI instead.

set -euo pipefail

APP_DIR="${APP_DIR:?Set APP_DIR, e.g. /home/USERNAME/wynajem-lasera-zarzadzanie}"

cd "$APP_DIR"

echo "==> Fetching latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Source synced ($(git rev-parse --short HEAD))"
