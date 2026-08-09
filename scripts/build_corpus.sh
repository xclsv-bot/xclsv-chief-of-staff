#!/usr/bin/env bash
# Build (or monthly-refresh) the writing corpus — spec §6.1.
# Output stays under gitignored data/; the generated profile is a CANDIDATE that
# Zaire reviews and promotes to agent/writing-profile.md himself.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run corpus -- "$@"
