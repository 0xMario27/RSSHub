#!/bin/bash
# Truth Social Route Test Script
# Usage: bash test-truthsocial.sh [rsshub_url]
#   Default RSSHub URL: http://localhost:1200

set -e

RSSHUB_URL="${1:-http://localhost:1200}"
ROUTE="${RSSHUB_URL}/truthsocial/user/realDonaldTrump"
PASS=0
FAIL=0

green() { printf "\033[32m✓ %s\033[0m\n" "$1"; PASS=$((PASS + 1)); }
red()   { printf "\033[31m✗ %s\033[0m\n" "$1"; FAIL=$((FAIL + 1)); }
info()  { printf "\033[36m→ %s\033[0m\n" "$1"; }
warn()  { printf "\033[33m⚠ %s\033[0m\n" "$1"; }

echo "============================================"
echo " Truth Social RSSHub Route Test"
echo " Target: $RSSHUB_URL"
echo "============================================"
echo ""

# --- 1. RSSHub alive ---
info "1. Checking RSSHub is reachable..."
if curl -sI --max-time 5 "$RSSHUB_URL" > /dev/null 2>&1; then
    green "RSSHub is running"
else
    red "RSSHub is NOT reachable at $RSSHUB_URL"
    echo "   Start it with: docker compose up -d"
    exit 1
fi

# --- 2. Route exists ---
info "2. Checking Truth Social route exists..."
RESP=$(curl -s --max-time 10 "${RSSHUB_URL}/truthsocial/user/test123" 2>&1)
if echo "$RESP" | grep -q "Truth Social\|truthsocial\|User.*not found"; then
    green "Route is registered"
else
    warn "Route may not be registered (unexpected response)"
fi

# --- 3. Basic route test ---
info "3. Testing /truthsocial/user/realDonaldTrump ..."
echo "   (This may take up to 60 seconds on first request)"

START=$(date +%s)
RESP=$(curl -s --max-time 90 "$ROUTE" 2>&1)
ELAPSED=$(( $(date +%s) - START ))

if echo "$RESP" | grep -q '<rss'; then
    # Parse RSS
    ITEMS=$(echo "$RESP" | grep -c '<item>' || echo 0)
    TITLE=$(echo "$RESP" | grep -o '<title>[^<]*</title>' | head -1 | sed 's/<[^>]*>//g')
    green "Got RSS response in ${ELAPSED}s"
    echo "   Feed title: $TITLE"
    echo "   Items: $ITEMS"
    if [ "$ITEMS" -gt 0 ]; then
        green "Has items - ROUTE WORKING!"
    else
        red "0 items - check Docker logs: docker logs rsshub"
    fi
elif echo "$RESP" | grep -q "Error Message"; then
    ERR=$(echo "$RESP" | grep -o 'Error Message:.*</code>' | sed 's/<[^>]*>//g' | head -1)
    red "Route returned error after ${ELAPSED}s"
    echo "   $ERR"
elif echo "$RESP" | grep -q "Connection refused\|Unable to connect"; then
    red "Connection refused - is RSSHub running?"
else
    red "Unexpected response after ${ELAPSED}s"
    echo "   First 300 chars: ${RESP:0:300}"
fi

echo ""
echo "============================================"
echo " Results: ${PASS} passed, ${FAIL} failed"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "Troubleshooting:"
    echo "  docker logs rsshub                           # RSSHub logs"
    echo "  docker exec rsshub cat /app/.env             # Chromium path"
    echo "  docker exec rsshub ls /tmp/rsshub-chrome-profile/  # Browser profile"
    exit 1
fi
