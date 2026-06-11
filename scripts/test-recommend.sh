#!/usr/bin/env bash
# Usage: ./scripts/test-recommend.sh <session-id> <session-cookie>
# Example: ./scripts/test-recommend.sh "uuid-here" "sb-xxx=..."

set -euo pipefail

SESSION_ID="${1:?Usage: $0 <session-id> <session-cookie>}"
COOKIE="${2:?Usage: $0 <session-id> <session-cookie>}"
API="http://localhost:4321/api/sessions/$SESSION_ID/recommend"

cat > /tmp/recommend-payload.json << 'EOF'
{
  "body_angles": [
    { "name": "Knee angle at BDC", "value": 132.5, "reference_min": 137, "reference_max": 147, "unit": "degrees" },
    { "name": "Knee angle at TDC", "value": 70.1, "reference_min": 65,  "reference_max": 75,  "unit": "degrees" },
    { "name": "Hip angle at TDC",  "value": 60.3, "reference_min": 55,  "reference_max": 65,  "unit": "degrees" },
    { "name": "Torso angle",       "value": 42.0, "reference_min": 45,  "reference_max": 55,  "unit": "degrees" },
    { "name": "Elbow angle",       "value": 155.8, "reference_min": 150, "reference_max": 160, "unit": "degrees" }
  ]
}
EOF

echo "Sending to $API ..."
curl -s -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "Cookie: $COOKIE" \
  -d "@/tmp/recommend-payload.json" | python3 -m json.tool
