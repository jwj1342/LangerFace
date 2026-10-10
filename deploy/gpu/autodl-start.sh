#!/bin/bash
set -euo pipefail

APP_DIR="${LANGERFACE_APP_DIR:-/root/autodl-tmp/langerface-app}"
RUNTIME_DIR="${LANGERFACE_RUNTIME_DIR:-/root/autodl-tmp/langerface-runtime}"
PYTHON="${LANGERFACE_PYTHON:-$RUNTIME_DIR/pyenv/bin/python}"
NODE="${LANGERFACE_NODE:-$RUNTIME_DIR/node-v24.15.0-linux-x64/bin/node}"
PORT="${LANGERFACE_PORT:-6006}"
SERVICE_PID_FILE="$RUNTIME_DIR/service.pid"
SERVICE_LOG="$RUNTIME_DIR/service.log"
TUNNEL_PID_FILE="$RUNTIME_DIR/tunnel.pid"
TUNNEL_LOG="$RUNTIME_DIR/tunnel.log"
CLOUDFLARED="$RUNTIME_DIR/bin/cloudflared"

mkdir -p "$RUNTIME_DIR/bin"

if [[ -f /etc/profile.d/autodl.env.sh ]]; then
  # AutoDL publishes the stable HTTPS proxy URL through this profile.
  # shellcheck disable=SC1091
  source /etc/profile.d/autodl.env.sh
fi

if [[ -n "${AutoDLService6006URL:-}" ]]; then
  printf '%s\n' "$AutoDLService6006URL" >"$RUNTIME_DIR/public-url.txt"
fi

service_ready() {
  curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/gpu/health" |
    grep -q '"yoloProvider":"CUDAExecutionProvider"'
}

if ! service_ready; then
  if [[ -f "$SERVICE_PID_FILE" ]] && kill -0 "$(cat "$SERVICE_PID_FILE")" 2>/dev/null; then
    kill "$(cat "$SERVICE_PID_FILE")"
    sleep 2
  fi
  cd "$APP_DIR"
  nohup env \
    LANGERFACE_BIND=0.0.0.0 \
    LANGERFACE_PORT="$PORT" \
    LANGERFACE_NODE="$NODE" \
    "$PYTHON" deploy/gpu/service.py >"$SERVICE_LOG" 2>&1 &
  echo $! >"$SERVICE_PID_FILE"

  for _ in $(seq 1 90); do
    service_ready && break
    sleep 2
  done
  service_ready || {
    tail -80 "$SERVICE_LOG" >&2 || true
    exit 1
  }
fi

if [[ "${LANGERFACE_ENABLE_QUICK_TUNNEL:-0}" == "1" ]]; then
  [[ -x "$CLOUDFLARED" ]] || {
    echo "cloudflared is missing at $CLOUDFLARED" >&2
    exit 1
  }
  if [[ ! -f "$TUNNEL_PID_FILE" ]] || ! kill -0 "$(cat "$TUNNEL_PID_FILE")" 2>/dev/null; then
    : >"$TUNNEL_LOG"
    nohup "$CLOUDFLARED" tunnel \
      --url "http://127.0.0.1:$PORT" \
      --no-autoupdate >"$TUNNEL_LOG" 2>&1 &
    echo $! >"$TUNNEL_PID_FILE"
  fi

  for _ in $(seq 1 30); do
    public_url=$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | tail -1 || true)
    if [[ -n "$public_url" ]]; then
      printf '%s\n' "$public_url" >"$RUNTIME_DIR/public-url.txt"
      break
    fi
    sleep 1
  done
elif [[ -f "$TUNNEL_PID_FILE" ]]; then
  tunnel_pid=$(cat "$TUNNEL_PID_FILE")
  if kill -0 "$tunnel_pid" 2>/dev/null; then
    kill "$tunnel_pid"
  fi
  rm -f "$TUNNEL_PID_FILE"
fi

service_ready
