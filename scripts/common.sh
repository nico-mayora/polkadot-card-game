#!/usr/bin/env bash
set -euo pipefail

# Shared helpers for local Polkadot development.
# Adapted from https://github.com/shawntabrizi/polkadot-stack-template

COMMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$COMMON_DIR/.." && pwd)"
CHAIN_SPEC="$ROOT_DIR/blockchain/chain_spec.json"

STACK_PORT_OFFSET="${STACK_PORT_OFFSET:-0}"
STACK_SUBSTRATE_RPC_PORT="${STACK_SUBSTRATE_RPC_PORT:-$((9944 + STACK_PORT_OFFSET))}"
STACK_ETH_RPC_PORT="${STACK_ETH_RPC_PORT:-$((8545 + STACK_PORT_OFFSET))}"
STACK_FRONTEND_PORT="${STACK_FRONTEND_PORT:-$((5173 + STACK_PORT_OFFSET))}"
STACK_COLLATOR_P2P_PORT="$((30333 + STACK_PORT_OFFSET))"
STACK_COLLATOR_PROMETHEUS_PORT="$((9615 + STACK_PORT_OFFSET))"
STACK_RELAY_ALICE_RPC_PORT="$((9949 + STACK_PORT_OFFSET))"
STACK_RELAY_ALICE_P2P_PORT="$((30335 + STACK_PORT_OFFSET))"
STACK_RELAY_ALICE_PROMETHEUS_PORT="$((9617 + STACK_PORT_OFFSET))"
STACK_RELAY_BOB_RPC_PORT="$((9951 + STACK_PORT_OFFSET))"
STACK_RELAY_BOB_P2P_PORT="$((30336 + STACK_PORT_OFFSET))"
STACK_RELAY_BOB_PROMETHEUS_PORT="$((9618 + STACK_PORT_OFFSET))"

SUBSTRATE_RPC_HTTP="http://127.0.0.1:${STACK_SUBSTRATE_RPC_PORT}"
SUBSTRATE_RPC_WS="ws://127.0.0.1:${STACK_SUBSTRATE_RPC_PORT}"
ETH_RPC_HTTP="http://127.0.0.1:${STACK_ETH_RPC_PORT}"
FRONTEND_URL="http://127.0.0.1:${STACK_FRONTEND_PORT}"

export STACK_PORT_OFFSET STACK_SUBSTRATE_RPC_PORT STACK_ETH_RPC_PORT STACK_FRONTEND_PORT
export SUBSTRATE_RPC_HTTP SUBSTRATE_RPC_WS ETH_RPC_HTTP FRONTEND_URL

# SDK binary versions (polkadot-stable2512-3)
STACK_EXPECTED_POLKADOT_SEMVER="${STACK_EXPECTED_POLKADOT_SEMVER:-1.21.3}"
STACK_EXPECTED_OMNI_NODE_SEMVER="${STACK_EXPECTED_OMNI_NODE_SEMVER:-1.21.3}"
STACK_EXPECTED_ETH_RPC_SEMVER="${STACK_EXPECTED_ETH_RPC_SEMVER:-0.12.0}"
STACK_EXPECTED_CHAIN_SPEC_BUILDER_SEMVER="${STACK_EXPECTED_CHAIN_SPEC_BUILDER_SEMVER:-16.0.0}"
STACK_EXPECTED_ZOMBIE_MAJOR_MINOR="${STACK_EXPECTED_ZOMBIE_MAJOR_MINOR:-1.3}"
STACK_ZOMBIENET_VERSION="${STACK_ZOMBIENET_VERSION:-v1.3.133}"
STACK_SKIP_BINARY_VERSION_CHECK="${STACK_SKIP_BINARY_VERSION_CHECK:-0}"

STACK_LOCAL_BIN_DIR="${STACK_LOCAL_BIN_DIR:-$ROOT_DIR/bin}"
STACK_SDK_RELEASE_TAG="${STACK_SDK_RELEASE_TAG:-polkadot-stable2512-3}"
STACK_DOWNLOAD_SDK_BINARIES="${STACK_DOWNLOAD_SDK_BINARIES:-1}"

ZOMBIE_DIR="${ZOMBIE_DIR:-}"
ZOMBIE_LOG="${ZOMBIE_LOG:-}"
ZOMBIE_PID="${ZOMBIE_PID:-}"
ETH_RPC_PID="${ETH_RPC_PID:-}"

log_info() { echo "INFO: $*"; }
log_warn() { echo "WARN: $*"; }
log_error() { echo "ERROR: $*" >&2; }

require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        log_error "Missing required command: $1"
        exit 1
    fi
}

first_line_semver() {
    echo "$1" | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1
}

stack_sdk_remote_filename() {
    local tool="$1"
    case "$(uname -s):$(uname -m)" in
        Darwin:arm64) printf '%s-aarch64-apple-darwin\n' "$tool" ;;
        Linux:x86_64) printf '%s\n' "$tool" ;;
        *)
            log_error "No prebuilt $tool for $(uname -s) $(uname -m)."
            exit 1
            ;;
    esac
}

stack_sdk_expected_semver() {
    case "$1" in
        polkadot|polkadot-prepare-worker|polkadot-execute-worker) printf '%s\n' "$STACK_EXPECTED_POLKADOT_SEMVER" ;;
        polkadot-omni-node) printf '%s\n' "$STACK_EXPECTED_OMNI_NODE_SEMVER" ;;
        eth-rpc) printf '%s\n' "$STACK_EXPECTED_ETH_RPC_SEMVER" ;;
        chain-spec-builder) printf '%s\n' "$STACK_EXPECTED_CHAIN_SPEC_BUILDER_SEMVER" ;;
        *) log_error "Unknown SDK binary: $1"; exit 1 ;;
    esac
}

_ensure_one_sdk_binary() {
    local name="$1"
    local dest="$STACK_LOCAL_BIN_DIR/$name"
    local expected
    expected="$(stack_sdk_expected_semver "$name")"
    local need_dl=1

    if [[ -x "$dest" ]]; then
        if [[ "$STACK_SKIP_BINARY_VERSION_CHECK" == "1" ]]; then
            need_dl=0
        else
            local out ver
            out="$("$dest" --version 2>&1)" || true
            ver="$(first_line_semver "$out")"
            if [[ "$ver" == "$expected" ]]; then
                need_dl=0
            elif [[ -z "$ver" && "$name" =~ ^polkadot-(prepare|execute)-worker$ ]]; then
                need_dl=0
            else
                log_info "Refreshing $name (found ${ver:-?}, want $expected)."
            fi
        fi
    fi

    [[ "$need_dl" -eq 0 ]] && return 0

    require_command curl
    local url remote tmp
    remote="$(stack_sdk_remote_filename "$name")"
    url="https://github.com/paritytech/polkadot-sdk/releases/download/${STACK_SDK_RELEASE_TAG}/${remote}"
    tmp="$(mktemp "${TMPDIR:-/tmp}/stack-sdk.XXXXXX")"
    log_info "Downloading $name ($STACK_SDK_RELEASE_TAG)..."
    if ! curl -fsSL "$url" -o "$tmp"; then
        rm -f "$tmp"
        log_error "Failed to download $name from $url"
        exit 1
    fi
    chmod +x "$tmp"
    mv "$tmp" "$dest"
}

ensure_local_sdk_binaries() {
    [[ "${STACK_DOWNLOAD_SDK_BINARIES:-1}" == "1" ]] || return 0
    [[ "$#" -eq 0 ]] && return 0
    require_command curl
    mkdir -p "$STACK_LOCAL_BIN_DIR"
    for n in "$@"; do
        _ensure_one_sdk_binary "$n"
    done
    export PATH="$STACK_LOCAL_BIN_DIR:$PATH"
}

ensure_local_zombienet_binary() {
    [[ "${STACK_DOWNLOAD_SDK_BINARIES:-1}" == "1" ]] || return 0
    local dest="$STACK_LOCAL_BIN_DIR/zombienet"
    local need_dl=1

    if [[ -x "$dest" ]]; then
        if [[ "$STACK_SKIP_BINARY_VERSION_CHECK" == "1" ]]; then
            need_dl=0
        else
            local ver
            ver="$("$dest" version 2>&1 | head -1 | tr -d '\r\n')" || true
            if [[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
                local major_minor="${ver%.*}"
                [[ "$major_minor" == "$STACK_EXPECTED_ZOMBIE_MAJOR_MINOR" ]] && need_dl=0
            fi
        fi
    fi

    [[ "$need_dl" -eq 0 ]] && { export PATH="$STACK_LOCAL_BIN_DIR:$PATH"; return 0; }

    require_command curl
    mkdir -p "$STACK_LOCAL_BIN_DIR"
    local remote
    case "$(uname -s):$(uname -m)" in
        Darwin:arm64)  remote="zombienet-macos-arm64" ;;
        Darwin:x86_64) remote="zombienet-macos-x64" ;;
        Linux:x86_64)  remote="zombienet-linux-x64" ;;
        Linux:aarch64) remote="zombienet-linux-arm64" ;;
        *) log_error "No prebuilt zombienet for $(uname -s) $(uname -m)."; exit 1 ;;
    esac

    local url="https://github.com/paritytech/zombienet/releases/download/${STACK_ZOMBIENET_VERSION}/${remote}"
    local tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/stack-zombienet.XXXXXX")"
    log_info "Downloading zombienet (${STACK_ZOMBIENET_VERSION})..."
    if ! curl -fsSL "$url" -o "$tmp"; then
        rm -f "$tmp"
        log_error "Failed to download zombienet from $url"
        exit 1
    fi
    chmod +x "$tmp"
    mv "$tmp" "$dest"
    export PATH="$STACK_LOCAL_BIN_DIR:$PATH"
}

require_port_free() {
    local port="$1"
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        log_error "Port $port is already in use."
        lsof -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -5 >&2
        exit 1
    fi
}

validate_zombienet_ports() {
    require_port_free "$STACK_SUBSTRATE_RPC_PORT"
    require_port_free "$STACK_RELAY_ALICE_RPC_PORT"
    require_port_free "$STACK_RELAY_ALICE_P2P_PORT"
    require_port_free "$STACK_RELAY_BOB_RPC_PORT"
    require_port_free "$STACK_RELAY_BOB_P2P_PORT"
    require_port_free "$STACK_COLLATOR_P2P_PORT"
}

validate_full_stack_ports() {
    validate_zombienet_ports
    require_port_free "$STACK_ETH_RPC_PORT"
    require_port_free "$STACK_FRONTEND_PORT"
}

# Generates chain_spec.json by extracting it from the Docker image.
# The Docker build compiles the polkadot-stack-template runtime which includes pallet-revive (EVM).
generate_chain_spec() {
    if [[ -f "$CHAIN_SPEC" ]]; then
        log_info "Chain spec already exists at $CHAIN_SPEC"
        return 0
    fi

    log_error "Chain spec not found at $CHAIN_SPEC"
    log_info "It should be committed in blockchain/chain_spec.json — check your git checkout."
    exit 1
}

basic_substrate_rpc_ready() {
    curl -s \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"chain_getHeader","params":[]}' \
        "$SUBSTRATE_RPC_HTTP" | grep -q '"result"'
}

substrate_block_producing() {
    curl -s \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"chain_getHeader","params":[]}' \
        "$SUBSTRATE_RPC_HTTP" | grep -Eq '"number":"0x[1-9a-fA-F][0-9a-fA-F]*"'
}

wait_for_substrate_rpc() {
    log_info "Waiting for parachain RPC at $SUBSTRATE_RPC_WS..."
    local max_wait="${STACK_RPC_TIMEOUT:-600}"
    for _ in $(seq 1 "$max_wait"); do
        if basic_substrate_rpc_ready && substrate_block_producing; then
            log_info "Parachain ready at $SUBSTRATE_RPC_WS"
            return 0
        fi
        if [[ -n "$ZOMBIE_PID" ]] && ! kill -0 "$ZOMBIE_PID" 2>/dev/null; then
            log_error "Zombienet stopped during startup."
            [[ -n "$ZOMBIE_LOG" && -f "$ZOMBIE_LOG" ]] && tail -n 50 "$ZOMBIE_LOG" >&2
            return 1
        fi
        sleep 1
    done
    log_error "Parachain RPC did not become ready in ${max_wait}s."
    return 1
}

eth_rpc_ready() {
    curl -s \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
        "$ETH_RPC_HTTP" >/dev/null 2>&1
}

wait_for_eth_rpc() {
    log_info "Waiting for Ethereum RPC at $ETH_RPC_HTTP..."
    for _ in $(seq 1 120); do
        if eth_rpc_ready; then
            log_info "Ethereum RPC ready at $ETH_RPC_HTTP"
            return 0
        fi
        if [[ -n "$ETH_RPC_PID" ]] && ! kill -0 "$ETH_RPC_PID" 2>/dev/null; then
            log_error "eth-rpc stopped during startup."
            return 1
        fi
        sleep 1
    done
    log_error "Ethereum RPC did not become ready in 120s."
    return 1
}

write_zombienet_config() {
    local config_path="$1"
    cat >"$config_path" <<EOF
[settings]
timeout = 1000

[relaychain]
chain = "rococo-local"
default_command = "polkadot"

  [[relaychain.nodes]]
  name = "alice"
  validator = true
  rpc_port = $STACK_RELAY_ALICE_RPC_PORT
  p2p_port = $STACK_RELAY_ALICE_P2P_PORT
  prometheus_port = $STACK_RELAY_ALICE_PROMETHEUS_PORT

  [[relaychain.nodes]]
  name = "bob"
  validator = true
  rpc_port = $STACK_RELAY_BOB_RPC_PORT
  p2p_port = $STACK_RELAY_BOB_P2P_PORT
  prometheus_port = $STACK_RELAY_BOB_PROMETHEUS_PORT

[[parachains]]
id = 1000
chain = "./chain_spec.json"
cumulus_based = true

  [[parachains.collators]]
  name = "collator-01"
  validator = true
  rpc_port = $STACK_SUBSTRATE_RPC_PORT
  p2p_port = $STACK_COLLATOR_P2P_PORT
  prometheus_port = $STACK_COLLATOR_PROMETHEUS_PORT
  command = "polkadot-omni-node"
EOF
}

start_zombienet_background() {
    validate_zombienet_ports

    ZOMBIE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cardgame-zombienet.XXXXXX")"
    ZOMBIE_LOG="$ZOMBIE_DIR/zombienet.log"
    local zombie_config="$ZOMBIE_DIR/zombienet.toml"
    cp "$CHAIN_SPEC" "$ZOMBIE_DIR/chain_spec.json"
    write_zombienet_config "$zombie_config"

    (
        cd "$ZOMBIE_DIR"
        zombienet -p native -f -l text -d "$ZOMBIE_DIR" spawn zombienet.toml >"$ZOMBIE_LOG" 2>&1
    ) &
    ZOMBIE_PID=$!

    log_info "Zombienet dir: $ZOMBIE_DIR"
    log_info "Zombienet log: $ZOMBIE_LOG"
}

run_zombienet_foreground() {
    validate_zombienet_ports

    ZOMBIE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cardgame-zombienet.XXXXXX")"
    ZOMBIE_LOG="$ZOMBIE_DIR/zombienet.log"
    local zombie_config="$ZOMBIE_DIR/zombienet.toml"
    cp "$CHAIN_SPEC" "$ZOMBIE_DIR/chain_spec.json"
    write_zombienet_config "$zombie_config"

    log_info "Zombienet dir: $ZOMBIE_DIR"
    trap cleanup_zombienet EXIT INT TERM

    cd "$ZOMBIE_DIR"
    zombienet -p native -f -l text -d "$ZOMBIE_DIR" spawn zombienet.toml &
    ZOMBIE_PID=$!
    wait "$ZOMBIE_PID"
}

start_eth_rpc_background() {
    ensure_local_sdk_binaries eth-rpc
    require_port_free "$STACK_ETH_RPC_PORT"

    local eth_rpc_log="$ZOMBIE_DIR/eth-rpc.log"

    eth-rpc \
        --node-rpc-url "$SUBSTRATE_RPC_WS" \
        --rpc-port "$STACK_ETH_RPC_PORT" \
        --no-prometheus \
        --rpc-cors all \
        -d "$ZOMBIE_DIR/eth-rpc-data" >"$eth_rpc_log" 2>&1 &
    ETH_RPC_PID=$!

    log_info "eth-rpc log: $eth_rpc_log"
}

cleanup_zombienet() {
    if [[ -n "$ZOMBIE_DIR" ]]; then
        pkill -INT -f "$ZOMBIE_DIR" 2>/dev/null || true
        sleep 1
        pkill -KILL -f "$ZOMBIE_DIR" 2>/dev/null || true
    fi
    [[ -n "$ZOMBIE_PID" ]] && wait "$ZOMBIE_PID" 2>/dev/null || true
}
