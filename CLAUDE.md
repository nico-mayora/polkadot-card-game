# Objective
Use Polkadot's EVM to build a single-player card game where players can trade cards, buy and sell them using tokens, and open booster packs. Card ownership and deck shuffling is handled on-chain when playing the game to prevent cheating. New cards are randomly minted when a player opens a new pack bought with tokens. The tokens gathered from this source are used to further develop the game with updates (new levels, cards, etc.).

# Scope
- 20 cards
- 3 levels
- 3 cards per booster
- Battling AI enemies is handled **off-chain**
- Card ownership is handled **on-chain**
- Deck order is handled on-chain
- The game validates played card were on the dealt hand.

# Gameplay
## Playing
The player selects a level (with a predefined enemy) and a 15-card deck. They tell the blockchain what deck they are using and 5 card hand is randomly generated on-chain. The player can choose up to 3 of those cards to be played in order. The chain validates the played cards are on the dealt hand and are then played in the selected order. If the enemy dies, the player wins. If the enemy is still alive, they take they turn (from a sequence of pre-defined actions) and if the player's health reaches zero, they lose. If they are still alive, their remaining hand is shuffled back into the deck and another hand is dealt. The process repeats until they win or lose.
## Trading
Players can put up their cards for trade on the blockchain, for either another card, or some amount of tokens. Other players can take them up on the offer and ownership is transferred accordingly. The offers are persisted on the bulletin chain for 14 days with no option for extension/renewal.

#  High-level Implementation plan
- Create a single smart contract with all on-chain logic using Solidity.
- Code the game as a static javascript file hosted on `dot.li`.
- Call the smart contract from JS using PAPI.
- Store trade offers on the bulletin chain. They are lost if not fulfilled within 14 days or when completed.
- Create scenarios that show the smart contract blocks "cheating" attempts.

# Other remarks
- Use this template for best practices and unnanounced tool usage: https://github.com/shawntabrizi/polkadot-stack-template

- Usage of tools like Claude Code is encouraged.

## Not sure
How do I generate random numbers on a smart contract? (for opening packs, shuffling deck...)
	use {block hash} ++ {user key} ++ {block nonce} as a seed? Yes, thats good enough
Log in? How do I sign transactions?

# TODO
- Test on Polkadot Ecosystem
    - Deploy locally *exactly* as in the Polkadot template above. Check the `scripts/` directory.
    - Polkadot SDK binaries (stable2512-3): polkadot, polkadot-prepare-worker, polkadot-execute-worker (relay), polkadot-omni-node, eth-rpc, chain-spec-builder, and zombienet (template has a script to download them)
- Instead of hard-coding cards, persist them in the bulletin chain. Don't worry yet about renewing, but make a script that pushes all cards *not already on that chain* to it, so I can add new cards easily and re-add expired ones.
- Every little action needs Approving. Can the user experience be improved?
- ~The trade page is not working properly.~
- ~How can I test the trade page?~
- Page should remember deck for future duels.
- The game is currently not that fun. Gameplay should have a bit more substance:
    - Make cards more like actions instead of creatures and enemies more challenging. (Think "Slay The Spire")
    - Make the AI more complex.
    - Keep the scope limited. I don't want this to blow up into the next MTG or anything.
- ~BUG: Forefeit game but cancel transaction: stuck on game one can't exit.~
- Once bulletin is used, verify escrowed cards are returned to its owner once the offer expires.

## Meat of the Issue
These are goals we must hit, our 'North Star'
- Deploy on Paseo AssetHub chain
- Use the new Polkadot Triangle UX
    - Sign transactions with PWallet (https://app.dotsamalabs.com, replaces Talisman)
    - Dotli NS
    - Bulletin chain

## Session:
claude --resume 563af36c-a147-496a-bc1e-82ad47356895

