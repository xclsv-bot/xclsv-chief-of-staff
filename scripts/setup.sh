#!/usr/bin/env bash
# First-time setup: dependencies, runtime dirs, env template.
set -euo pipefail
cd "$(dirname "$0")/.."

npm install
mkdir -p data
[ -f .env ] || cp .env.example .env

echo
echo "Setup done. Next steps:"
echo "  1. Fill in .env (Google OAuth client, Anthropic key, ZAIRE_EMAIL)."
echo "  2. npm run auth:gmail   # once per mailbox, prints the refresh token"
echo "  3. npm run sweep -- --dry-run   # verify triage before writing labels"
