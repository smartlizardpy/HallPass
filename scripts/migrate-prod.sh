#!/usr/bin/env bash
#
# HallPass — apply pending DB migrations to ONE explicit Neon branch (prod).
#
# WHY THIS EXISTS. `npm run migrate` with no DATABASE_URL falls back to
# `.env.local`, which points at the DEV Neon branch — and dev already has every
# migration, so it prints "up to date — nothing to apply" and you conclude prod
# is done when prod was never touched. We use Neon database *branching*: prod is a
# separate branch with its own connection string, and migration 014 (the mobile
# `platform` column) still has to be applied there. This script forces you to pass
# the prod string in, so you can't silently run against dev again.
#
# Usage:
#   ./scripts/migrate-prod.sh 'postgresql://USER:PASS@ep-...-prod.../db?sslmode=require'
#     — or —
#   PROD_DATABASE_URL='postgresql://...' ./scripts/migrate-prod.sh
#
# Get the prod branch's string from the Neon dashboard (or Vercel → the
# production DATABASE_URL env var). It is NOT the one in .env.local.

set -euo pipefail

# Run from the repo root regardless of where this is invoked from.
cd "$(dirname "$0")/.."

# --- resolve the connection string (arg wins, then env) ------------------------
DB_URL="${1:-${PROD_DATABASE_URL:-}}"
if [[ -z "$DB_URL" ]]; then
  cat >&2 <<'EOF'
error: no connection string given.

Pass the PRODUCTION Neon branch string (not the .env.local / dev one):

  ./scripts/migrate-prod.sh 'postgresql://USER:PASS@ep-...-prod.../db?sslmode=require'

or:

  PROD_DATABASE_URL='postgresql://...' ./scripts/migrate-prod.sh

Find it in the Neon dashboard for the prod branch, or as the production
DATABASE_URL in your Vercel project settings.
EOF
  exit 1
fi

# Override .env.local for the node runner (it only falls back when this is unset).
export DATABASE_URL="$DB_URL"

# --- show the host WITHOUT leaking the password --------------------------------
HOST="$(node -e 'try{process.stdout.write(new URL(process.env.DATABASE_URL).host)}catch{process.stdout.write("(unparseable DATABASE_URL)")}')"

echo "=============================================================="
echo " Target Neon host : $HOST"
echo "=============================================================="
echo

# --- before: what's pending ----------------------------------------------------
echo ">> Current status on that host:"
npm run migrate -- --status
echo

# --- confirm -------------------------------------------------------------------
# Re-type the host so a wrong branch can't slip through on a reflexive "y".
read -r -p "Type the host shown above to APPLY pending migrations to it: " CONFIRM
if [[ "$CONFIRM" != "$HOST" ]]; then
  echo "aborted — \"$CONFIRM\" does not match \"$HOST\". Nothing was changed." >&2
  exit 1
fi
echo

# --- apply ---------------------------------------------------------------------
echo ">> Applying…"
npm run migrate
echo

# --- after: prove it landed ----------------------------------------------------
echo ">> Status after applying:"
npm run migrate -- --status

echo
echo "Done. Confirm 014_game_platform.sql now shows a ✓ above."
