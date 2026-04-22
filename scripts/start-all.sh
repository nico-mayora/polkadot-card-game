#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

ETH_RPC_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo "Shutting down..."
    [[ -n "$FRONTEND_PID" ]] && { kill "$FRONTEND_PID" 2>/dev/null || true; wait "$FRONTEND_PID" 2>/dev/null || true; }
    [[ -n "$ETH_RPC_PID" ]] && { kill "$ETH_RPC_PID" 2>/dev/null || true; wait "$ETH_RPC_PID" 2>/dev/null || true; }
    cleanup_zombienet
}
trap cleanup EXIT INT TERM

echo "=== Card Game — Full Local Stack ==="
echo ""
log_info "Starts relay chain + parachain (Zombienet), eth-rpc, deploys contracts, and runs the frontend."
log_info "Override ports with STACK_PORT_OFFSET or STACK_*_PORT env vars."
echo ""

echo "[1/5] Downloading SDK binaries (stable2512-3)..."
ensure_local_sdk_binaries polkadot polkadot-prepare-worker polkadot-execute-worker polkadot-omni-node eth-rpc
ensure_local_zombienet_binary

echo "[2/5] Starting Zombienet (relay chain + parachain)..."
generate_chain_spec
validate_full_stack_ports
start_zombienet_background
wait_for_substrate_rpc

echo "[3/5] Starting eth-rpc adapter..."
start_eth_rpc_background
wait_for_eth_rpc

echo "[4/5] Deploying contracts..."
cd "$ROOT_DIR/contracts"
npm install --silent
npm run deploy:local
cd "$ROOT_DIR"

echo "[5/5] Starting frontend..."
cd "$ROOT_DIR/web"
npm install --silent
export VITE_LOCAL_WS_URL="$SUBSTRATE_RPC_WS"
export VITE_LOCAL_ETH_RPC_URL="$ETH_RPC_HTTP"
npm run dev -- --host 127.0.0.1 --port "$STACK_FRONTEND_PORT" &
FRONTEND_PID=$!
cd "$ROOT_DIR"

echo ""
echo "=== Full local stack running ==="
log_info "Substrate RPC: $SUBSTRATE_RPC_WS"
log_info "Ethereum RPC:  $ETH_RPC_HTTP"
log_info "Frontend:      $FRONTEND_URL"
echo ""
log_info "Press Ctrl+C to stop all."
wait "$ZOMBIE_PID"
