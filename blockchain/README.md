# Blockchain

A Polkadot SDK parachain built with FRAME and Cumulus, compatible with `polkadot-omni-node`.

## Directory Guide

| Path | What it contains |
| --- | --- |
| [`pallets/template/`](pallets/template/) | The Proof of Existence FRAME pallet |
| [`runtime/`](runtime/) | The parachain runtime built on `polkadot-sdk stable2512-3` |
| [`chain_spec.json`](chain_spec.json) | Generated local chain spec used by the dev scripts and some Docker flows |
| [`Dockerfile`](Dockerfile) | Lightweight runtime image that packages a pre-generated chain spec |
| [`zombienet.toml`](zombienet.toml) | Example relay-backed local topology |

## Common Commands

```bash
# Build the runtime
cargo build -p stack-template-runtime --release

# Pallet unit tests
cargo test -p pallet-template

# All workspace tests including benchmarks
SKIP_PALLET_REVIVE_FIXTURES=1 cargo test --workspace --features runtime-benchmarks
```

## Running Locally

- [`../scripts/start-dev.sh`](../scripts/start-dev.sh) — Fastest solo-node runtime/pallet loop
- [`../scripts/start-local.sh`](../scripts/start-local.sh) — Relay-backed Zombienet network
- [`../scripts/start-all.sh`](../scripts/start-all.sh) — Full stack: relay chain + contracts + frontend

On `polkadot-sdk stable2512-3`, the solo-node dev path does not expose Statement Store RPCs. Use the relay-backed scripts when you need Statement Store locally.
