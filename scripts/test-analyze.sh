#!/usr/bin/env bash
# Usage: ./scripts/test-analyze.sh <video.mp4> <session-cookie>
# Example: ./scripts/test-analyze.sh 1000002887~6.mp4 "sb-xxx=..."
#
# Get your session cookie from browser DevTools → Application → Cookies → sb-*

set -euo pipefail

VIDEO="${1:?Usage: $0 <video.mp4> <session-cookie>}"
COOKIE="${2:?Usage: $0 <video.mp4> <session-cookie>}"
API="http://localhost:4321/api/analyze"

echo "Base64-encoding video: $VIDEO"
B64=$(base64 -w 0 "$VIDEO")

PAYLOAD="{\"video\":\"$B64\"}"

echo "$PAYLOAD" > payload.json
echo "Sending to $API ..."
curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d "@payload.json" | python3 -m json.tool
