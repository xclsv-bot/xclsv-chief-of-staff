#!/usr/bin/env bash
# Build (or monthly-refresh) the voice corpus — spec §6.1.
# Output stays under gitignored data/; the generated profile is a CANDIDATE that
# Zaire reviews and promotes to agent/voice-profile.md himself.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run corpus -- "$@"
