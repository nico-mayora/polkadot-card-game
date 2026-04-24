# <span style="color: #ff6677">Chain Cards</span>

### A trading card game on Polkadot AssetHub

Nicolás Mayora — PBP Lisbon

---

## <span style="color: #ff6677">What was built</span>

- Single-player <span style="color: #ff6baa">**deck-builder**</span> in the spirit of *Slay the Spire*
  - 20 cards · 3 levels · 15-card decks · 5-card hands · 5-card packs
- <span style="color: #ff6baa">**Ownership, shuffling and hand validation live on-chain**</span>; battle UI runs in the browser
- Players **trade cards** for tokens or for other cards
- Pack sales feed back into new content

---

## <span style="color: #ff6677">Why blockchain?</span>

### The TCG economy is broken

- On traditional on-line TCG's you may spend money on cards, but <span style="color: #ff6baa">**you don't own them**</span>.
- Servers might get shut down at any time, and you'd lose access to your cards.
- On blockchain, <span style="color: #ff6baa">**the cards are yours to keep**</span>.
- Trading is completely open, the market organically finds its own equilibrium.

---

### <span style="color: #ff6677">What's actually unique here</span>

- <span style="color: #ffaabb">**True ownership**</span> → cards are portable assets, not DB rows
- <span style="color: #ffaabb">**Permissionless P2P trading**</span> → card↔card or card↔token, no house
- <span style="color: #ffaabb">**Provably fair play**</span> → deck shuffle and hand dealing happen *on-chain*, not just ownership
- <span style="color: #ffaabb">**Transparent drops**</span> → booster randomness seeded from a future `blockhash`

---

## <span style="color: #ff6677">Architecture</span>

<img src="diagrams/arch.svg" alt="Architecture diagram" style="max-height: 65vh; width: auto;">

---

## <span style="color: #ff6677">Gameplay flow</span>

<div style="display: flex; align-items: center; gap: 2em;"><div style="flex: 0 0 55%;"><img src="diagrams/flow.svg" alt="Gameplay flow" style="width: 100%; max-height: 55.5vh; object-fit: contain;"></div><div style="flex: 1; text-align: left; font-size: 0.8em;">The player <strong>can never play a card that wasn't dealt</strong> — the contract rejects the call, so there is nothing to "hack" client-side.</div></div>

---

# <span style="color: #ff6677">Next steps</span>

- The obvious: More cards, more levels.
- Improve UX, so user doesn't have to individually sign each transaction.
- Make the trading system smarter and more flexible.
- Make the UI prettier :^)

---

## <span style="color: #ff6677">Try it!</span>
##### `github.com/nico-mayora/polkadot-card-game`
