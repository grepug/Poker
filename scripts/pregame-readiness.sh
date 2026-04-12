#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-full}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/pregame-readiness.sh [--fast|--full]

Modes:
  --fast  Build + PM2 restart + health + LAN URL checks (no Playwright smoke)
  --full  Same as --fast, plus critical Playwright smoke tests (default)
EOF
}

log() {
  printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

restart_or_start_pm2() {
  local name="$1"
  local cmd="$2"
  local cwd="$3"
  if pm2 describe "$name" >/dev/null 2>&1; then
    pm2 restart "$name" >/dev/null
  else
    pm2 start "$cmd" --name "$name" --cwd "$cwd" >/dev/null
  fi
}

check_http_200() {
  local url="$1"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" || true)"
  if [[ "$code" != "200" ]]; then
    echo "Health check failed for $url (status: $code)" >&2
    exit 1
  fi
}

get_lan_ip() {
  local ip
  for iface in en0 en1; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    if [[ -n "$ip" ]]; then
      echo "$ip"
      return 0
    fi
  done

  ip="$(ifconfig | awk '/inet / && $2 != "127.0.0.1" {print $2; exit}')"
  if [[ -n "$ip" ]]; then
    echo "$ip"
    return 0
  fi

  echo ""
}

if [[ "$MODE" == "--help" || "$MODE" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "$MODE" == "full" ]]; then
  MODE="--full"
fi

if [[ "$MODE" == "fast" ]]; then
  MODE="--fast"
fi

if [[ "$MODE" != "--fast" && "$MODE" != "--full" ]]; then
  echo "Unknown mode: $MODE" >&2
  usage
  exit 1
fi

require_cmd pnpm
require_cmd pm2
require_cmd curl
require_cmd ifconfig

cd "$ROOT_DIR"

log "Building poker-types"
pnpm --filter poker-types build

log "Building poker-server"
pnpm --filter poker-server build

log "Building poker-client"
pnpm --filter poker-client build

log "Ensuring PM2 services are running"
restart_or_start_pm2 \
  "poker-client" \
  "pnpm run dev -- --host 0.0.0.0 --port 5173" \
  "$ROOT_DIR/poker-client"
restart_or_start_pm2 \
  "poker-server" \
  "node dist/main.js" \
  "$ROOT_DIR/poker-server"

sleep 2

log "Checking local health endpoints"
check_http_200 "http://localhost:5173"
check_http_200 "http://localhost:3001"

LAN_IP="$(get_lan_ip)"

if [[ "$MODE" == "--full" ]]; then
  log "Running critical smoke tests"
  SERVER_WAS_ONLINE=0
  if pm2 describe poker-server >/dev/null 2>&1; then
    STATUS="$(pm2 jlist | node -e "const fs=require('fs');const data=JSON.parse(fs.readFileSync(0,'utf8'));const app=data.find(p=>p.name==='poker-server');process.stdout.write(app?.pm2_env?.status||'')")"
    if [[ "$STATUS" == "online" ]]; then
      SERVER_WAS_ONLINE=1
    fi
  fi

  if [[ "$SERVER_WAS_ONLINE" -eq 1 ]]; then
    pm2 stop poker-server >/dev/null || true
  fi

  set +e
  pnpm --filter poker-server test:e2e:playwright:smoke
  SMOKE_EXIT=$?
  set -e

  if [[ "$SERVER_WAS_ONLINE" -eq 1 ]]; then
    pm2 restart poker-server >/dev/null || true
    sleep 1
    check_http_200 "http://localhost:3001"
  fi

  if [[ "$SMOKE_EXIT" -ne 0 ]]; then
    echo "Critical smoke tests failed." >&2
    exit "$SMOKE_EXIT"
  fi
fi

log "Pre-game readiness passed"
echo "Frontend (local): http://localhost:5173"
echo "Backend  (local): http://localhost:3001"
if [[ -n "$LAN_IP" ]]; then
  echo "Frontend (LAN)  : http://$LAN_IP:5173"
  echo "Backend  (LAN)  : http://$LAN_IP:3001"
else
  echo "LAN IP not detected automatically."
fi
