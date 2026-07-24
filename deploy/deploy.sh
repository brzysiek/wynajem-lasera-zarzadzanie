#!/usr/bin/env bash
# Run over SSH by the GitHub Actions workflow on every push to main.
# Target: cPanel account with a Node.js app already created via
# "Setup Node.js App" (Node.js Selector / Passenger). No root/sudo used.

set -euo pipefail

APP_DIR="${APP_DIR:?Set APP_DIR, e.g. /home/USERNAME/wynajem-lasera-zarzadzanie}"
NODEVENV_DIR="${NODEVENV_DIR:?Set NODEVENV_DIR, e.g. /home/USERNAME/nodevenv/wynajem-lasera-zarzadzanie/20}"

cd "$APP_DIR"

echo "==> Fetching latest main"
git fetch origin main
git reset --hard origin/main

echo "==> Activating cPanel Node.js virtual environment"
# shellcheck disable=SC1091
source "$NODEVENV_DIR/bin/activate"

echo "==> Installing dependencies"
# npm ci is strict about optional platform-specific packages (e.g. the
# @emnapi/* WASM fallback deps) matching the lockfile exactly, which has
# proven flaky across different npm versions/hosts; npm install tolerates
# and self-heals that instead.
npm install

echo "==> Generating Prisma client"
npx prisma generate

echo "==> Building"
npm run build

echo "==> Restarting app (Passenger restart trigger)"
mkdir -p tmp
touch tmp/restart.txt

echo "==> Deploy finished ($(git rev-parse --short HEAD))"
