#!/usr/bin/env bash
# Scale stress via the official LiveKit CLI — simulates many publishers/subscribers
# server-side with NO per-participant browser cost, so it goes far past the ~8
# real-Chromium ceiling. Pair with the Playwright "observe" spec (LOADTEST_ROOM)
# to screenshot the host UI while the room is full.
#
# Requires livekit-cli (`lk`):  https://github.com/livekit/livekit-cli
#   brew install livekit-cli   |   curl -sSL https://get.livekit.io/cli | bash
#
# Env:
#   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET  (a TEST project, not prod)
#   PUBLISHERS  (default 10)  SUBSCRIBERS (default 50)  DURATION (default 60s)
#   ROOM        (default loadtest-<epoch>)
set -euo pipefail

: "${LIVEKIT_URL:?set LIVEKIT_URL (use a test project, not prod)}"
: "${LIVEKIT_API_KEY:?set LIVEKIT_API_KEY}"
: "${LIVEKIT_API_SECRET:?set LIVEKIT_API_SECRET}"

PUBLISHERS="${PUBLISHERS:-10}"
SUBSCRIBERS="${SUBSCRIBERS:-50}"
DURATION="${DURATION:-60s}"
ROOM="${ROOM:-loadtest-$(date +%s)}"

mkdir -p audit
OUT="audit/loadtest-${ROOM}.txt"

echo "load-test → room=$ROOM publishers=$PUBLISHERS subscribers=$SUBSCRIBERS duration=$DURATION"
echo "(host can observe live at: \$APP_URL/r/$ROOM  — or run the observe spec with LOADTEST_ROOM=$ROOM)"

lk load-test \
  --url "$LIVEKIT_URL" \
  --api-key "$LIVEKIT_API_KEY" \
  --api-secret "$LIVEKIT_API_SECRET" \
  --room "$ROOM" \
  --video-publishers "$PUBLISHERS" \
  --subscribers "$SUBSCRIBERS" \
  --duration "$DURATION" 2>&1 | tee "$OUT"

echo "saved → $OUT"
