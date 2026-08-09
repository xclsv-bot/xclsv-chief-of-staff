#!/usr/bin/env bash
# Build and serve the voice PWA on the pipeline host (v1.4 step 14, self-host
# decision): same machine as the cron pipelines so the tool handlers see the
# real data/state.db. Expose the port via your tunnel of choice
# (cloudflared tunnel / tailscale serve) and bookmark:
#   https://<your-host>/?k=<VOICE_SHARED_SECRET>
set -euo pipefail
cd "$(dirname "$0")/../web"

[ -f .env.local ] || {
  echo "web/.env.local missing — copy the voice + connector vars there first." >&2
  exit 1
}
npm install
npm run build
exec npm run start -- --port "${VOICE_PORT:-3100}"
