#!/bin/bash
# Truth Social RSSHub - Full Test Script
# Pulls image, starts container, tests route, cleans up
set -e

IMAGE="ghcr.io/0xmario27/rsshub-truthsocial:latest"
CONTAINER="rsshub-test"
PORT="1200"
TIMEOUT=90
RSSHUB_URL="http://localhost:${PORT}"
ROUTE="/truthsocial/user/realDonaldTrump"

PASS=0; FAIL=0
green() { printf "\033[32m  ✓ %s\033[0m\n" "$1"; PASS=$((PASS+1)); }
red()   { printf "\033[31m  ✗ %s\033[0m\n" "$1"; FAIL=$((FAIL+1)); }
info()  { printf "\033[36m\n▶ %s\033[0m\n" "$1"; }
warn()  { printf "\033[33m  ⚠ %s\033[0m\n" "$1"; }

cleanup() {
    info "Cleaning up..."
    docker rm -f "$CONTAINER" 2>/dev/null && green "Container removed" || true
    echo ""
    echo "============================================"
    echo " Results: ${PASS} passed, ${FAIL} failed"
    echo "============================================"
    [ "$FAIL" -gt 0 ] && exit 1 || exit 0
}
trap cleanup EXIT

echo "============================================"
echo " Truth Social RSSHub - Full Test"
echo "============================================"
echo ""

# === Step 1: Pull image ===
info "Step 1/5: Pulling Docker image..."
if docker pull "$IMAGE" 2>&1 | grep -iq "downloaded\|up to date\|pulled"; then
    green "Image ready: $IMAGE"
else
    red "Failed to pull image. Check: docker pull $IMAGE"
    exit 1
fi

# === Step 2: Stop old container ===
info "Step 2/5: Stopping old test container..."
docker rm -f "$CONTAINER" 2>/dev/null && warn "Removed old container" || true

# === Step 3: Start container ===
info "Step 3/5: Starting container..."
CONTAINER_ID=$(docker run -d --name "$CONTAINER" -p "${PORT}:${PORT}" "$IMAGE" 2>&1)
if [ $? -eq 0 ]; then
    green "Container started: ${CONTAINER_ID:0:12}"
else
    red "Failed to start container: $CONTAINER_ID"
    exit 1
fi

# === Step 4: Wait for RSSHub ===
info "Step 4/5: Waiting for RSSHub to be ready..."
for i in $(seq 1 20); do
    if curl -sI --max-time 2 "$RSSHUB_URL" > /dev/null 2>&1; then
        green "RSSHub is ready (${i}s)"
        break
    fi
    if [ "$i" -eq 20 ]; then
        red "RSSHub failed to start in 20s"
        docker logs "$CONTAINER" | tail -20
        exit 1
    fi
    sleep 1
done

# === Step 5: Check environment ===
info "Step 5/5: Checking environment..."
# Chromium
CHROMIUM=$(docker exec "$CONTAINER" sh -c 'find / -name headless_shell -type f 2>/dev/null | head -1; which chromium 2>/dev/null' | head -1)
if [ -n "$CHROMIUM" ]; then
    green "Chromium found: $CHROMIUM"
else
    warn "Chromium not found on PATH (checking .env)"
    docker exec "$CONTAINER" cat /app/.env 2>/dev/null | head -3
fi

# Stealth plugin
EVASIONS=$(docker exec "$CONTAINER" sh -c 'ls /app/node_modules/.pnpm/puppeteer-extra-plugin-stealth*/node_modules/puppeteer-extra-plugin-stealth/evasions/ 2>/dev/null | wc -l')
if [ "$EVASIONS" -gt 0 ]; then
    green "Stealth plugin evasions: ${EVASIONS}"
else
    red "Stealth plugin evasions missing"
fi

# Xvfb
if docker exec "$CONTAINER" pgrep Xvfb > /dev/null 2>&1; then
    green "Xvfb is running"
else
    warn "Xvfb not detected (may be headless:false issue)"
fi

echo ""
echo "============================================"
echo " Testing Route: ${ROUTE}"
echo " (first request may take 60+ seconds)"
echo "============================================"
echo ""

# === Test Route (3 attempts) ===
for attempt in 1 2 3; do
    info "Attempt ${attempt}/3..."
    START=$(date +%s)
    RESP=$(curl -s --max-time "$TIMEOUT" "${RSSHUB_URL}${ROUTE}" 2>&1) || true
    ELAPSED=$(( $(date +%s) - START ))

    if echo "$RESP" | grep -q '<rss'; then
        ITEMS=$(echo "$RESP" | python3 -c "
import sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
print(len(root.findall('.//item')))
" 2>/dev/null || echo "?")
        TITLE=$(echo "$RESP" | python3 -c "
import sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
print(root.find('.//channel/title').text or 'N/A')
" 2>/dev/null || echo "?")

        green "RSS OK! (${ELAPSED}s)"
        echo "       Feed: ${TITLE}"
        echo "       Items: ${ITEMS}"

        if [ "$ITEMS" -gt 0 ]; then
            echo ""
            green "✅ ROUTE WORKING! ${ITEMS} items from Truth Social"
            break
        else
            warn "0 items - retrying..."
            continue
        fi
    elif echo "$RESP" | grep -q "Error Message"; then
        red "Error after ${ELAPSED}s"
        ERR=$(echo "$RESP" | python3 -c "import sys,re; m=re.search(r'Error Message:[^<]*', sys.stdin.read()); print(m.group() if m else 'unknown')" 2>/dev/null || echo "parse error")
        echo "       ${ERR}"
    elif echo "$RESP" | grep -q "Connection refused\|Unable to connect\|Empty reply"; then
        red "Connection refused after ${ELAPSED}s"
    else
        red "Unexpected response after ${ELAPSED}s"
        echo "       First 200 chars: $(echo "$RESP" | head -c 200)"
    fi

    if [ "$attempt" -lt 3 ]; then
        sleep 5
    fi
done

# Show logs on failure
if [ "$FAIL" -gt 0 ]; then
    echo ""
    info "Docker logs (last 10 lines):"
    docker logs "$CONTAINER" 2>&1 | tail -10
fi
