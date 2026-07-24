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
npx prisma generate

echo "==> Restarting app (Passenger restart trigger)"
mkdir -p tmp
touch tmp/restart.txt

echo "==> Deploy finished ($(git rev-parse --short HEAD))"
