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

echo "==> Applying database migrations (prisma migrate deploy)"
# Prisma CLI auto-loads DATABASE_URL from ./.env (we're in APP_DIR).
#
# One-time baseline: these databases predate Prisma Migrate — their tables
# were created from the old hand-written sql/schema.sql, so the very first
# `migrate deploy` would otherwise try to re-run 0_init (the full schema)
# and fail on "table already exists". If the schema is already present
# (users table exists) but 0_init hasn't been recorded yet, mark it applied
# without running it. This is a genuine no-op on every later deploy (the
# row already exists → the command exits non-zero → `|| true`) and is
# correctly skipped on a truly empty database (no users table → 0_init runs
# normally via migrate deploy below).
if npx prisma db execute --schema prisma/schema.prisma --stdin <<<'SELECT 1 FROM `users` LIMIT 1;' >/dev/null 2>&1; then
  npx prisma migrate resolve --applied 0_init >/dev/null 2>&1 || true
fi
npx prisma migrate deploy

echo "==> Restarting app (Passenger restart trigger)"
mkdir -p tmp
touch tmp/restart.txt

echo "==> Deploy finished ($(git rev-parse --short HEAD))"
