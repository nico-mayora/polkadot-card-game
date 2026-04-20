// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ChainCards
/// @notice A single-player card game on Polkadot EVM. Card ownership, deck
///         shuffling, and hand validation are enforced on-chain to prevent
///         cheating. Battle resolution against AI enemies is handled off-chain
///         but the contract fully determines what cards a player can play.
///         Compiles to both EVM (solc) and PVM (resolc) bytecode.
contract ChainCards {

    // =====================================================================
    //  Constants
    // =====================================================================

    uint8  public constant NUM_CARDS       = 20;
    uint8  public constant DECK_SIZE       = 15;
    uint8  public constant HAND_SIZE       = 5;
    uint8  public constant MAX_PLAY        = 3;
    uint8  public constant PACK_SIZE       = 3;
    uint8  public constant NUM_LEVELS      = 3;
    uint8  public constant PLAYER_MAX_HP   = 30;
    uint256 public constant TRADE_DURATION = 14 days;
    uint256 public constant PACK_PRICE = 1 * 10**10; // 1 DOT

    // =====================================================================
    //  Types
    // =====================================================================

    struct CardDef {
        uint8 attack;
        uint8 defense;
    }

    /// @dev A single action in an enemy's turn sequence (cycles).
    struct EnemyAction {
        uint8 attack;
        uint8 defense;
    }

    /// @dev Per-level definition stored at deploy time.
    struct LevelDef {
        uint8  enemyHp;
        uint8  numActions;           // length of the action cycle
    }

    enum Phase { None, Committed, Dealt }

    struct Game {
        uint8   levelId;
        Phase   phase;
        uint8   playerHp;
        uint8   enemyHp;
        uint8   turn;                // current turn (0-indexed)
        uint256 commitBlock;         // block at which deck/hand was committed
        uint8   deckSize;            // cards remaining in deck (indices 0..deckSize-1)
        uint8[15] deck;              // card IDs — first `deckSize` are live
        uint8[5]  hand;              // current hand (valid entries: 0..handSize-1)
        uint8   handSize;
    }

    struct TradeOffer {
        address seller;
        uint8   offeredCardId;
        bool    wantsCard;           // true  → swap for wantedCardId
        uint8   wantedCardId;        // only meaningful when wantsCard == true
        uint256 tokenPrice;          // only meaningful when wantsCard == false
        uint256 expiresAt;
        bool    active;
    }

    // =====================================================================
    //  State
    // =====================================================================

    address public owner;

    /// @dev Card catalogue (set once in constructor).
    CardDef[20] public cards;

    /// @dev Level catalogue.
    LevelDef[3] public levels;

    /// @dev Enemy action sequences — enemyActions[level][turn % numActions].
    mapping(uint8 => mapping(uint8 => EnemyAction)) public enemyActions;

    /// @dev Card balances — cardBalance[player][cardId] = count.
    mapping(address => mapping(uint8 => uint256)) public cardBalance;

    /// @dev Active game session per player (one at a time).
    mapping(address => Game) private games;

    /// @dev Whether a player has already claimed the free starter pack.
    mapping(address => bool) public starterClaimed;

    /// @dev Marketplace of trade offers.
    TradeOffer[] public trades;

    /// @dev Booster-pack commit block (two-step randomness).
    mapping(address => uint256) private packCommitBlock;

    /// @dev Incrementing nonce mixed into randomness.
    uint256 private _nonce;

    // =====================================================================
    //  Events
    // =====================================================================

    event StarterClaimed(address indexed player);
    event PackCommitted(address indexed player);
    event PackOpened(address indexed player, uint8 card0, uint8 card1, uint8 card2);
    event GameStarted(address indexed player, uint8 levelId);
    event HandDealt(address indexed player, uint8 h0, uint8 h1, uint8 h2, uint8 h3, uint8 h4, uint8 handSize);
    event TurnResolved(
        address indexed player,
        uint8   playerAtk,
        uint8   playerDef,
        uint8   enemyAtk,
        uint8   enemyDef,
        uint8   playerHp,
        uint8   enemyHp
    );
    event GameEnded(address indexed player, bool won);
    event TradeCreated(uint256 indexed tradeId, address indexed seller, uint8 offeredCardId);
    event TradeFulfilled(uint256 indexed tradeId, address indexed buyer);
    event TradeCancelled(uint256 indexed tradeId);

    // =====================================================================
    //  Constructor — initialise the card & level catalogues
    // =====================================================================

    constructor() {
        owner = msg.sender;

        // ---- 20 cards (attack, defense) --------------------------------
        cards[ 0] = CardDef(6, 2);   // Ember Sprite
        cards[ 1] = CardDef(2, 7);   // Stone Golem
        cards[ 2] = CardDef(7, 1);   // Shadow Blade
        cards[ 3] = CardDef(1, 8);   // Iron Shield
        cards[ 4] = CardDef(8, 3);   // Fire Drake
        cards[ 5] = CardDef(3, 6);   // Frost Warden
        cards[ 6] = CardDef(9, 1);   // Thunder Strike
        cards[ 7] = CardDef(2, 8);   // Earth Guardian
        cards[ 8] = CardDef(5, 4);   // Wind Runner
        cards[ 9] = CardDef(6, 5);   // Crystal Mage
        cards[10] = CardDef(7, 3);   // Void Walker
        cards[11] = CardDef(4, 7);   // Light Paladin
        cards[12] = CardDef(8, 2);   // Dark Assassin
        cards[13] = CardDef(5, 5);   // Water Elemental
        cards[14] = CardDef(9, 2);   // Flame Phoenix
        cards[15] = CardDef(1, 9);   // Ancient Turtle
        cards[16] = CardDef(7, 4);   // Storm Giant
        cards[17] = CardDef(3, 7);   // Mystic Healer
        cards[18] = CardDef(10, 1);  // Chaos Dragon
        cards[19] = CardDef(5, 6);   // Divine Angel

        // ---- Level 0: Goblin Camp ------------------------------------
        levels[0] = LevelDef(20, 3);
        enemyActions[0][0] = EnemyAction(4, 1);
        enemyActions[0][1] = EnemyAction(3, 2);
        enemyActions[0][2] = EnemyAction(5, 0);

        // ---- Level 1: Dark Forest ------------------------------------
        levels[1] = LevelDef(35, 4);
        enemyActions[1][0] = EnemyAction(6, 3);
        enemyActions[1][1] = EnemyAction(5, 4);
        enemyActions[1][2] = EnemyAction(8, 2);
        enemyActions[1][3] = EnemyAction(4, 5);

        // ---- Level 2: Dragon's Lair ----------------------------------
        levels[2] = LevelDef(50, 5);
        enemyActions[2][0] = EnemyAction( 8, 4);
        enemyActions[2][1] = EnemyAction(10, 2);
        enemyActions[2][2] = EnemyAction( 6, 6);
        enemyActions[2][3] = EnemyAction(12, 3);
        enemyActions[2][4] = EnemyAction( 7, 5);
    }

    // =====================================================================
    //  Modifiers
    // =====================================================================

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier noActiveGame() {
        require(games[msg.sender].phase == Phase.None, "Finish current game first");
        _;
    }

    // =====================================================================
    //  Starter Pack
    // =====================================================================

    /// @notice Claim a one-time starter pack: one copy of cards 0-4 and 200 tokens.
    function claimStarterPack() external noActiveGame {
        require(!starterClaimed[msg.sender], "Already claimed");
        starterClaimed[msg.sender] = true;

        for (uint8 i = 0; i < 5; i++) {
            cardBalance[msg.sender][i] += 1;
        }

        emit StarterClaimed(msg.sender);
    }

    // =====================================================================
    //  Booster Packs (two-step commit / reveal for randomness)
    // =====================================================================

    /// @notice Step 1 — pay for a booster pack and commit to a future block
    ///         for randomness. Call `openPack()` in a later block.
    function commitPack() external payable noActiveGame {
        require(msg.value == PACK_PRICE, "Send exactly the pack price");
        require(packCommitBlock[msg.sender] == 0, "Pack already committed");

        (bool ok, ) = owner.call{value: msg.value}("");
        require(ok, "Payment failed");

        packCommitBlock[msg.sender] = block.number;
        emit PackCommitted(msg.sender);
    }

    /// @notice Step 2 — reveal the booster pack contents. Must be called in a
    ///         block after `commitPack()` but within 256 blocks (EVM limit for
    ///         `blockhash`).
    function openPack() external {
        uint256 cb = packCommitBlock[msg.sender];
        require(cb != 0, "No pack committed");
        require(block.number > cb, "Wait for next block");
        require(block.number <= cb + 256, "Commit expired, call commitPack again");

        // Use the blockhash of the commit block as entropy — unknown to the
        // player at the time they committed.
        uint256 seed = uint256(keccak256(abi.encodePacked(
            blockhash(cb), msg.sender, _nonce++
        )));

        uint8 c0 = uint8(seed % NUM_CARDS);
        seed = uint256(keccak256(abi.encodePacked(seed)));
        uint8 c1 = uint8(seed % NUM_CARDS);
        seed = uint256(keccak256(abi.encodePacked(seed)));
        uint8 c2 = uint8(seed % NUM_CARDS);

        cardBalance[msg.sender][c0] += 1;
        cardBalance[msg.sender][c1] += 1;
        cardBalance[msg.sender][c2] += 1;

        packCommitBlock[msg.sender] = 0;

        emit PackOpened(msg.sender, c0, c1, c2);
    }

    // =====================================================================
    //  Game — Commit Deck
    // =====================================================================

    /// @notice Start a game by selecting a level and committing a 15-card deck.
    ///         The hand will be dealt in a later block via `dealHand()`.
    /// @param levelId 0, 1, or 2.
    /// @param deck    Array of 15 card IDs from the player's collection.
    function commitDeck(uint8 levelId, uint8[15] calldata deck) external noActiveGame {
        require(levelId < NUM_LEVELS, "Invalid level");

        // Verify the player owns every card they want to use.
        // Count occurrences of each card ID in the submitted deck and compare
        // against the player's balance.
        uint8[20] memory counts;
        for (uint8 i = 0; i < DECK_SIZE; i++) {
            require(deck[i] < NUM_CARDS, "Invalid card id");
            counts[deck[i]]++;
            require(
                counts[deck[i]] <= cardBalance[msg.sender][deck[i]],
                "You don't own enough copies of this card"
            );
        }

        Game storage g = games[msg.sender];
        g.levelId     = levelId;
        g.phase       = Phase.Committed;
        g.playerHp    = PLAYER_MAX_HP;
        g.enemyHp     = levels[levelId].enemyHp;
        g.turn        = 0;
        g.commitBlock = block.number;
        g.deckSize    = DECK_SIZE;
        g.handSize    = 0;

        for (uint8 i = 0; i < DECK_SIZE; i++) {
            g.deck[i] = deck[i];
        }

        emit GameStarted(msg.sender, levelId);
    }

    // =====================================================================
    //  Game — Deal Hand
    // =====================================================================

    /// @notice Deal a hand from the committed deck. Must be called in a later
    ///         block than `commitDeck` (or the previous `playCards`).
    function dealHand() external {
        Game storage g = games[msg.sender];
        require(g.phase == Phase.Committed, "Not in committed phase");
        require(block.number > g.commitBlock, "Wait for next block");
        require(block.number <= g.commitBlock + 256, "Commit expired, forfeit");

        uint256 seed = uint256(keccak256(abi.encodePacked(
            blockhash(g.commitBlock), msg.sender, _nonce++
        )));

        // Determine how many cards to deal (min of HAND_SIZE and remaining deck).
        uint8 toDeal = g.deckSize < HAND_SIZE ? g.deckSize : HAND_SIZE;

        // Fisher-Yates partial shuffle: select `toDeal` random cards from the
        // front of the deck array.
        for (uint8 i = 0; i < toDeal; i++) {
            uint8 remaining = g.deckSize - i;
            uint8 j = i + uint8(seed % remaining);
            seed = uint256(keccak256(abi.encodePacked(seed)));

            // Swap deck[i] and deck[j]
            uint8 tmp  = g.deck[i];
            g.deck[i]  = g.deck[j];
            g.deck[j]  = tmp;
        }

        // The first `toDeal` slots of g.deck are now the hand.
        for (uint8 i = 0; i < toDeal; i++) {
            g.hand[i] = g.deck[i];
        }
        g.handSize = toDeal;

        // Shrink the live deck: the remaining cards start at index `toDeal`.
        // Compact them to the front.
        uint8 newDeckSize = g.deckSize - toDeal;
        for (uint8 i = 0; i < newDeckSize; i++) {
            g.deck[i] = g.deck[i + toDeal];
        }
        g.deckSize = newDeckSize;

        g.phase = Phase.Dealt;

        emit HandDealt(
            msg.sender,
            toDeal > 0 ? g.hand[0] : 0,
            toDeal > 1 ? g.hand[1] : 0,
            toDeal > 2 ? g.hand[2] : 0,
            toDeal > 3 ? g.hand[3] : 0,
            toDeal > 4 ? g.hand[4] : 0,
            toDeal
        );
    }

    // =====================================================================
    //  Game — Play Cards & Resolve Turn
    // =====================================================================

    /// @notice Play up to 3 cards from the current hand. The contract validates
    ///         that the chosen cards exist in the hand, resolves combat, and
    ///         either ends the game or prepares for the next turn.
    /// @param handIndices Indices (0-4) into the hand array, played in order.
    ///                    Length must be 1–3.
    function playCards(uint8[] calldata handIndices) external {
        Game storage g = games[msg.sender];
        require(g.phase == Phase.Dealt, "No hand dealt");
        require(handIndices.length >= 1 && handIndices.length <= MAX_PLAY, "Play 1-3 cards");

        // --- Validate chosen cards are in the hand ----------------------
        bool[5] memory used;
        uint16 totalAtk;
        uint16 totalDef;

        for (uint8 i = 0; i < handIndices.length; i++) {
            uint8 idx = handIndices[i];
            require(idx < g.handSize, "Index out of hand range");
            require(!used[idx], "Duplicate index");
            used[idx] = true;

            CardDef memory c = cards[g.hand[idx]];
            totalAtk += c.attack;
            totalDef += c.defense;
        }

        // --- Resolve combat ---------------------------------------------
        LevelDef  memory lvl = levels[g.levelId];
        EnemyAction memory ea = enemyActions[g.levelId][g.turn % lvl.numActions];

        // Player attacks enemy
        uint16 dmgToEnemy = totalAtk > ea.defense ? totalAtk - ea.defense : 0;
        if (dmgToEnemy >= g.enemyHp) {
            g.enemyHp = 0;
        } else {
            g.enemyHp -= uint8(dmgToEnemy);
        }

        // Check win
        if (g.enemyHp == 0) {
            emit TurnResolved(msg.sender, uint8(totalAtk), uint8(totalDef),
                ea.attack, ea.defense, g.playerHp, 0);
            emit GameEnded(msg.sender, true);
            _clearGame(msg.sender);
            return;
        }

        // Enemy attacks player
        uint16 dmgToPlayer = ea.attack > totalDef ? ea.attack - uint16(totalDef) : 0;
        if (dmgToPlayer >= g.playerHp) {
            g.playerHp = 0;
        } else {
            g.playerHp -= uint8(dmgToPlayer);
        }

        emit TurnResolved(
            msg.sender,
            uint8(totalAtk), uint8(totalDef),
            ea.attack, ea.defense,
            g.playerHp, g.enemyHp
        );

        // Check loss
        if (g.playerHp == 0) {
            emit GameEnded(msg.sender, false);
            _clearGame(msg.sender);
            return;
        }

        // --- Prepare next turn ------------------------------------------
        // Return unplayed hand cards to the deck.
        for (uint8 i = 0; i < g.handSize; i++) {
            if (!used[i]) {
                g.deck[g.deckSize] = g.hand[i];
                g.deckSize++;
            }
        }

        g.handSize    = 0;
        g.turn       += 1;
        g.commitBlock = block.number;   // new entropy anchor for next deal
        g.phase       = Phase.Committed;
    }

    /// @notice Forfeit the current game.
    function forfeitGame() external {
        require(games[msg.sender].phase != Phase.None, "No active game");
        emit GameEnded(msg.sender, false);
        _clearGame(msg.sender);
    }

    // =====================================================================
    //  Trading
    // =====================================================================

    /// @notice Create a trade offer: sell a card for either another card or tokens.
    /// @param cardId      The card to offer.
    /// @param wantsCard   True if you want a card in return, false for tokens.
    /// @param wantedCardId The card you want (ignored if wantsCard is false).
    /// @param tokenPrice  The token price (ignored if wantsCard is true).
    function createTrade(
        uint8   cardId,
        bool    wantsCard,
        uint8   wantedCardId,
        uint256 tokenPrice
    ) external noActiveGame {
        require(cardId < NUM_CARDS, "Invalid card");
        require(cardBalance[msg.sender][cardId] >= 1, "You don't own this card");
        if (wantsCard) require(wantedCardId < NUM_CARDS, "Invalid wanted card");

        // Escrow: take the card from the seller so it can't be double-spent.
        cardBalance[msg.sender][cardId] -= 1;

        uint256 tradeId = trades.length;
        trades.push(TradeOffer({
            seller:        msg.sender,
            offeredCardId: cardId,
            wantsCard:     wantsCard,
            wantedCardId:  wantedCardId,
            tokenPrice:    tokenPrice,
            expiresAt:     block.timestamp + TRADE_DURATION,
            active:        true
        }));

        emit TradeCreated(tradeId, msg.sender, cardId);
    }

    /// @notice Accept an active trade offer.
    function acceptTrade(uint256 tradeId) external payable noActiveGame {
        TradeOffer storage t = trades[tradeId];
        require(t.active, "Trade not active");

        if (t.wantsCard) {
            // Card-for-card swap, no payment needed
            require(msg.value == 0, "No payment needed for card swap");
            cardBalance[msg.sender][t.wantedCardId] -= 1;
            cardBalance[t.seller][t.wantedCardId]   += 1;
        } else {
            // Token payment goes directly to the seller
            require(msg.value == t.tokenPrice, "Wrong payment amount");
            (bool ok, ) = t.seller.call{value: msg.value}("");
            require(ok, "Payment failed");
        }

        cardBalance[msg.sender][t.offeredCardId] += 1;
        t.active = false;
        emit TradeFulfilled(tradeId, msg.sender);
    }

    /// @notice Cancel your own trade offer and reclaim the escrowed card.
    function cancelTrade(uint256 tradeId) external {
        require(tradeId < trades.length, "Invalid trade id");
        TradeOffer storage t = trades[tradeId];
        require(t.active, "Trade not active");
        require(t.seller == msg.sender, "Not your trade");

        cardBalance[msg.sender][t.offeredCardId] += 1;
        t.active = false;

        emit TradeCancelled(tradeId);
    }

    /// @notice Reclaim a card from an expired trade. Anyone can call this to
    ///         clean up stale offers.
    function reclaimExpiredTrade(uint256 tradeId) external {
        require(tradeId < trades.length, "Invalid trade id");
        TradeOffer storage t = trades[tradeId];
        require(t.active, "Trade not active");
        require(block.timestamp > t.expiresAt, "Not expired yet");

        cardBalance[t.seller][t.offeredCardId] += 1;
        t.active = false;

        emit TradeCancelled(tradeId);
    }

    // =====================================================================
    //  Admin
    // =====================================================================

    /// @notice Mint a specific card to a player (for promotional events).
    function mintCard(address to, uint8 cardId, uint256 amount) external onlyOwner {
        require(cardId < NUM_CARDS, "Invalid card");
        cardBalance[to][cardId] += amount;
    }

    // =====================================================================
    //  View helpers
    // =====================================================================

    /// @notice Get all card balances for a player (array of 20 counts).
    function getCollection(address player) external view returns (uint256[20] memory counts) {
        for (uint8 i = 0; i < NUM_CARDS; i++) {
            counts[i] = cardBalance[player][i];
        }
    }

    /// @notice Get full game state for a player.
    function getGame(address player) external view returns (
        uint8   levelId,
        uint8   phase,       // 0=None, 1=Committed, 2=Dealt
        uint8   playerHp,
        uint8   enemyHp,
        uint8   turn,
        uint8   deckSize,
        uint8[5] memory hand,
        uint8   handSize
    ) {
        Game storage g = games[player];
        return (
            g.levelId,
            uint8(g.phase),
            g.playerHp,
            g.enemyHp,
            g.turn,
            g.deckSize,
            g.hand,
            g.handSize
        );
    }

    /// @notice Get the number of trade offers (including inactive).
    function getTradeCount() external view returns (uint256) {
        return trades.length;
    }

    /// @notice Enumerate active trades (paginated). Returns up to `limit`
    ///         active trade IDs starting from `offset`.
    function getActiveTrades(uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, uint256 total)
    {
        // First pass: count active trades
        uint256 count;
        for (uint256 i = 0; i < trades.length; i++) {
            if (trades[i].active && block.timestamp <= trades[i].expiresAt) {
                count++;
            }
        }
        total = count;

        // Second pass: collect the requested page
        if (offset >= count) {
            ids = new uint256[](0);
            return (ids, total);
        }
        uint256 end = offset + limit;
        if (end > count) end = count;
        ids = new uint256[](end - offset);

        uint256 found;
        uint256 written;
        for (uint256 i = 0; i < trades.length && written < ids.length; i++) {
            if (trades[i].active && block.timestamp <= trades[i].expiresAt) {
                if (found >= offset) {
                    ids[written++] = i;
                }
                found++;
            }
        }
    }

    /// @notice Get card definition (useful for frontends).
    function getCardDef(uint8 cardId) external view returns (uint8 attack, uint8 defense) {
        require(cardId < NUM_CARDS, "Invalid card");
        return (cards[cardId].attack, cards[cardId].defense);
    }

    /// @notice Get enemy action for a given level and turn.
    function getEnemyAction(uint8 levelId, uint8 turn) external view returns (uint8 attack, uint8 defense) {
        require(levelId < NUM_LEVELS, "Invalid level");
        LevelDef memory lvl = levels[levelId];
        EnemyAction memory ea = enemyActions[levelId][turn % lvl.numActions];
        return (ea.attack, ea.defense);
    }

    // =====================================================================
    //  Internal helpers
    // =====================================================================

    function _clearGame(address player) private {
        delete games[player];
    }
}
