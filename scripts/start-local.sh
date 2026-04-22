#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SCRIPT_DIR/common.sh"

echo "=== Card Game — Local Polkadot Network ==="
echo ""
log_info "Starts relay chain + parachain via Zombienet. No contracts or frontend."
log_info "Override ports with STACK_PORT_OFFSET or STACK_*_PORT env vars."
log_info "Use start-all.sh for the full stack."
echo ""

echo "[1/2] Downloading SDK binaries (stable2512-3)..."
ensure_local_sdk_binaries polkadot polkadot-prepare-worker polkadot-execute-worker polkadot-omni-node
ensure_local_zombienet_binary

echo "[2/2] Spawning relay chain + parachain via Zombienet..."
generate_chain_spec
log_info "Substrate RPC will be available at $SUBSTRATE_RPC_WS"
echo ""

run_zombienet_foreground
