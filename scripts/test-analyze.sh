#!/usr/bin/env bash
# Usage: ./scripts/test-analyze.sh <video.mp4> <session-cookie> <session-id>
# Example: ./scripts/test-analyze.sh 1000002887~6.mp4 "sb-xxx=..." 3f7b...
#
# Get your session cookie from browser DevTools → Application → Cookies → sb-*

set -euo pipefail

VIDEO="${1:?Usage: $0 <video.mp4> <session-cookie> <session-id>}"
COOKIE="${2:?Usage: $0 <video.mp4> <session-cookie> <session-id>}"
SESSION_ID="${3:?Usage: $0 <video.mp4> <session-cookie> <session-id>}"
API="http://localhost:4321/api/analyze"

echo "Base64-encoding video: $VIDEO"
B64=$(base64 -w 0 "$VIDEO")

PAYLOAD="{\"video\":\"$B64\", \"session_id\":\"$SESSION_ID\"}"

echo "$PAYLOAD" > payload.json
echo "Sending to $API ..."
curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d "@payload.json" | python3 -m json.tool
