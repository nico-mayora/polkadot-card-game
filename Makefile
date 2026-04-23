SHELL := /bin/bash

ROOT_DIR := $(shell pwd)
EVM_DIR  := $(ROOT_DIR)/contracts

# Read DEPLOYER_KEY from hardhat vars file if not set in environment.
# Hardhat stores vars under an OS-dependent path; allow override via HARDHAT_VARS_FILE.
HARDHAT_VARS_FILE ?= $(shell node -e "const fs=require('fs');const os=require('os');const path=require('path');const home=os.homedir();const cand=[process.env.HARDHAT_VARS_FILE,path.join(home,'Library/Preferences/hardhat-nodejs/vars.json'),path.join(home,'.config/hardhat-nodejs/vars.json')].filter(Boolean);for(const p of cand){try{fs.accessSync(p,fs.constants.R_OK);process.stdout.write(p);process.exit(0);}catch{}}")
ifndef DEPLOYER_KEY
  DEPLOYER_KEY := $(shell node -e "try{const v=require('$(HARDHAT_VARS_FILE)');process.stdout.write(v.vars.DEPLOYER_KEY??'')}catch(e){}" 2>/dev/null)
endif

export DEPLOYER_KEY

# ─── Paseo deploy ─────────────────────────────────────────────────────────────

.PHONY: deploy-paseo
deploy-paseo: check-key
	@cd $(EVM_DIR) && npm install --silent && npx hardhat compile --quiet && RPC_URL=https://services.polkadothub-rpc.com/testnet npx hardhat run scripts/deploy.ts --network paseo
	@echo ""
	@echo "=== Deployment complete ==="
	@cat $(ROOT_DIR)/web/src/config/deployments.json

# ─── Guards ───────────────────────────────────────────────────────────────────

.PHONY: check-key
check-key:
	@if [ -z "$(DEPLOYER_KEY)" ]; then \
		echo "ERROR: DEPLOYER_KEY not set."; \
		echo "Run: cd contracts && npx hardhat vars set DEPLOYER_KEY 0x..."; \
		echo "Or:  export DEPLOYER_KEY=0x..."; \
		exit 1; \
	fi
	@echo "Deployer key loaded."
