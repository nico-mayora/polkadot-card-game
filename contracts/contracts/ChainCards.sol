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
    uint8  public constant MANA_PER_TURN   = 3;
    uint8  public constant PACK_SIZE       = 3;
    uint8  public constant NUM_LEVELS      = 3;
    uint8  public constant PLAYER_MAX_HP   = 40;
    uint256 public constant TRADE_DURATION = 14 days;
    uint256 public constant PACK_PRICE = 1 * 10**10; // 1 DOT

    // =====================================================================
    //  Types
    // =====================================================================

    /// @dev Card effect types (Slay-the-Spire style actions).
    enum CardType {
        Attack,  // 0 — deal value damage (reduced by enemy block)
        Block,   // 1 — gain value block this turn
        Heal,    // 2 — restore value HP
        Smite,   // 3 — deal value damage ignoring enemy block
        Drain    // 4 — deal value damage + heal value/2 HP
    }

    struct CardDef {
        CardType cardType;
        uint8    value;
        uint8    cost;   // mana cost: 1, 2, or 3
    }

    /// @dev Enemy action types.
    enum EnemyActionType {
        Attack,  // 0 — deal value damage to the player
        Shield,  // 1 — gain value block (reduces player damage next turns)
        Buff,    // 2 — next Attack deals double damage
        Regen    // 3 — restore value HP (up to max)
    }

    struct EnemyAction {
        EnemyActionType actionType;
        uint8           value;
    }

    /// @dev Per-level definition stored at deploy time.
    struct LevelDef {
        uint8 enemyHp;
        uint8 numActions;
    }

    enum Phase { None, Committed, Dealt }

    struct Game {
        uint8   levelId;
        Phase   phase;
        uint8   playerHp;
        uint8   enemyHp;
        uint8   turn;
        uint256 commitBlock;
        uint8   deckSize;
        uint8[15] deck;
        uint8[5]  hand;
        uint8   handSize;
        uint8   enemyBlock;   // persists until attacked through
        bool    enemyBuffed;  // next enemy Attack deals double damage
    }

    struct TradeOffer {
        address seller;
        uint8   offeredCardId;
        bool    wantsCard;
        uint8   wantedCardId;
        uint256 tokenPrice;
        uint256 expiresAt;
        bool    active;
    }

    // =====================================================================
    //  State
    // =====================================================================

    address public owner;

    CardDef[20] public cards;
    LevelDef[3] public levels;

    /// @dev enemyActions[levelId][actionIndex]
    mapping(uint8 => mapping(uint8 => EnemyAction)) public enemyActions;

    mapping(address => mapping(uint8 => uint256)) public cardBalance;
    mapping(address => Game) private games;
    mapping(address => bool) public starterClaimed;
    TradeOffer[] public trades;
    mapping(address => uint256) private packCommitBlock;
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
        uint8 dmgDealt,
        uint8 healAmount,
        uint8 blockGained,
        uint8 enemyActionType,
        uint8 enemyActionValue,
        uint8 dmgTaken,
        uint8 playerHp,
        uint8 enemyHp,
        uint8 newEnemyBlock,
        uint8 turn,
        bool  newEnemyBuffed
    );
    event GameEnded(address indexed player, bool won);
    event TradeCreated(uint256 indexed tradeId, address indexed seller, uint8 offeredCardId);
    event TradeFulfilled(uint256 indexed tradeId, address indexed buyer);
    event TradeCancelled(uint256 indexed tradeId);

    // =====================================================================
    //  Constructor — initialise card & level catalogues
    // =====================================================================

    constructor() {
        owner = msg.sender;

        // ---- 20 cards: (type, value, mana cost) --------------------------------
        // Attack — deal damage, reduced by enemy block
        cards[ 0] = CardDef(CardType.Attack,  6, 1);  // Quick Strike
        cards[10] = CardDef(CardType.Attack,  7, 1);  // Stab
        cards[ 2] = CardDef(CardType.Attack, 10, 2);  // Power Swing
        cards[16] = CardDef(CardType.Attack, 11, 2);  // Battle Cry
        cards[ 4] = CardDef(CardType.Attack, 12, 2);  // Heavy Blow
        cards[ 6] = CardDef(CardType.Attack, 14, 3);  // Shatter
        cards[18] = CardDef(CardType.Attack, 18, 3);  // Annihilate

        // Block — gain block to absorb enemy attack this turn
        cards[ 5] = CardDef(CardType.Block,  5, 1);   // Guard
        cards[ 1] = CardDef(CardType.Block,  7, 2);   // Fortify
        cards[ 7] = CardDef(CardType.Block,  9, 2);   // Steel Wall
        cards[ 3] = CardDef(CardType.Block, 11, 3);   // Bulwark
        cards[15] = CardDef(CardType.Block, 14, 3);   // Unbreakable

        // Heal — restore HP
        cards[ 8] = CardDef(CardType.Heal,  5, 1);    // Bandage
        cards[11] = CardDef(CardType.Heal,  7, 1);    // Mend
        cards[13] = CardDef(CardType.Heal, 10, 2);    // Recover
        cards[17] = CardDef(CardType.Heal, 13, 3);    // Restoration
        cards[19] = CardDef(CardType.Heal, 16, 3);    // Divine Blessing

        // Smite — deal damage ignoring enemy block
        cards[12] = CardDef(CardType.Smite, 10, 2);   // Assassinate

        // Drain — deal damage + heal value/2 HP
        cards[ 9] = CardDef(CardType.Drain,  7, 2);   // Life Tap    (7 dmg + 3 heal)
        cards[14] = CardDef(CardType.Drain, 10, 3);   // Soul Rend   (10 dmg + 5 heal)

        // ---- Level 0: Goblin Camp (HP 40) ------------------------------------
        levels[0] = LevelDef(40, 4);
        enemyActions[0][0] = EnemyAction(EnemyActionType.Attack,  8);
        enemyActions[0][1] = EnemyAction(EnemyActionType.Shield,  7);
        enemyActions[0][2] = EnemyAction(EnemyActionType.Attack, 10);
        enemyActions[0][3] = EnemyAction(EnemyActionType.Regen,   6);

        // ---- Level 1: Dark Forest (HP 60) ------------------------------------
        levels[1] = LevelDef(60, 5);
        enemyActions[1][0] = EnemyAction(EnemyActionType.Attack, 10);
        enemyActions[1][1] = EnemyAction(EnemyActionType.Shield,  9);
        enemyActions[1][2] = EnemyAction(EnemyActionType.Buff,    0);
        enemyActions[1][3] = EnemyAction(EnemyActionType.Attack, 14);
        enemyActions[1][4] = EnemyAction(EnemyActionType.Regen,  10);

        // ---- Level 2: Dragon's Lair (HP 90) ----------------------------------
        levels[2] = LevelDef(90, 6);
        enemyActions[2][0] = EnemyAction(EnemyActionType.Attack, 13);
        enemyActions[2][1] = EnemyAction(EnemyActionType.Shield, 14);
        enemyActions[2][2] = EnemyAction(EnemyActionType.Buff,    0);
        enemyActions[2][3] = EnemyAction(EnemyActionType.Attack, 18);
        enemyActions[2][4] = EnemyAction(EnemyActionType.Regen,  15);
        enemyActions[2][5] = EnemyAction(EnemyActionType.Attack, 11);
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

    function claimStarterPack() external noActiveGame {
        require(!starterClaimed[msg.sender], "Already claimed");
        starterClaimed[msg.sender] = true;
        for (uint8 i = 0; i < 5; i++) {
            cardBalance[msg.sender][i] += 1;
        }
        emit StarterClaimed(msg.sender);
    }

    // =====================================================================
    //  Booster Packs (two-step commit / reveal)
    // =====================================================================

    function commitPack() external payable noActiveGame {
        require(msg.value == PACK_PRICE, "Send exactly the pack price");
        require(packCommitBlock[msg.sender] == 0, "Pack already committed");
        (bool ok, ) = owner.call{value: msg.value}("");
        require(ok, "Payment failed");
        packCommitBlock[msg.sender] = block.number;
        emit PackCommitted(msg.sender);
    }

    function openPack() external {
        uint256 cb = packCommitBlock[msg.sender];
        require(cb != 0, "No pack committed");
        require(block.number > cb, "Wait for next block");
        require(block.number <= cb + 256, "Commit expired, call commitPack again");

        uint256 seed = uint256(keccak256(abi.encodePacked(
            blockhash(cb), msg.sender, _nonce++
        )));
        uint8[PACK_SIZE] memory drawn;
        for (uint8 i = 0; i < PACK_SIZE; i++) {
            if (i > 0) seed = uint256(keccak256(abi.encodePacked(seed)));
            drawn[i] = uint8(seed % NUM_CARDS);
            cardBalance[msg.sender][drawn[i]] += 1;
        }
        packCommitBlock[msg.sender] = 0;

        emit PackOpened(msg.sender, drawn[0], drawn[1], drawn[2]);
    }

    // =====================================================================
    //  Game — Commit Deck
    // =====================================================================

    /// @notice Commit a deck and wait for `dealHand()` in a later block.
    ///         Prefer `commitDeckAndDeal()` to avoid the extra round-trip.
    function commitDeck(uint8 levelId, uint8[15] calldata deck) external noActiveGame {
        _initGame(levelId, deck);
    }

    /// @notice Commit a deck AND deal the first hand in one transaction.
    ///         Uses blockhash(block.number - 1) for randomness — slightly
    ///         weaker than the two-step approach but fine for a card game.
    function commitDeckAndDeal(uint8 levelId, uint8[15] calldata deck) external noActiveGame {
        _initGame(levelId, deck);
        _dealHand(uint256(keccak256(abi.encodePacked(
            blockhash(block.number - 1), msg.sender, _nonce++
        ))));
    }

    // =====================================================================
    //  Game — Deal Hand
    // =====================================================================

    /// @notice Deal a hand from the committed deck. Must be called in a later
    ///         block than `commitDeck`. Prefer `commitDeckAndDeal()` instead.
    function dealHand() external {
        Game storage g = games[msg.sender];
        require(g.phase == Phase.Committed, "Not in committed phase");
        require(block.number > g.commitBlock, "Wait for next block");
        require(block.number <= g.commitBlock + 256, "Commit expired, forfeit");
        _dealHand(uint256(keccak256(abi.encodePacked(
            blockhash(g.commitBlock), msg.sender, _nonce++
        ))));
    }

    // =====================================================================
    //  Game — Play Cards & Resolve Turn
    // =====================================================================

    /// @notice Play cards and wait for `dealHand()` in a later block.
    ///         Prefer `playAndDeal()` to avoid the extra round-trip.
    function playCards(uint8[] calldata handIndices) external {
        _resolveCombat(handIndices);
    }

    /// @notice Play cards AND immediately deal the next hand in one transaction.
    ///         If the game ends this turn, no hand is dealt.
    function playAndDeal(uint8[] calldata handIndices) external {
        _resolveCombat(handIndices);
        // Phase.Committed means the game continues; deal immediately.
        if (games[msg.sender].phase == Phase.Committed) {
            _dealHand(uint256(keccak256(abi.encodePacked(
                blockhash(block.number - 1), msg.sender, _nonce++
            ))));
        }
    }

    function _resolveCombat(uint8[] calldata handIndices) private {
        Game storage g = games[msg.sender];
        require(g.phase == Phase.Dealt, "No hand dealt");
        require(handIndices.length >= 1 && handIndices.length <= g.handSize, "Invalid card count");

        bool[HAND_SIZE] memory used;

        // Working copies
        uint8 pHp      = g.playerHp;
        uint8 eHp      = g.enemyHp;
        uint8 eBlock   = g.enemyBlock;
        uint8 pBlock   = 0;   // generated this turn, used against enemy attack
        uint8 manaUsed = 0;

        // --- Process player cards -------------------------------------------
        for (uint8 i = 0; i < handIndices.length; i++) {
            uint8 idx = handIndices[i];
            require(idx < g.handSize, "Index out of hand range");
            require(!used[idx], "Duplicate index");
            used[idx] = true;

            CardDef memory c = cards[g.hand[idx]];
            require(manaUsed + c.cost <= MANA_PER_TURN, "Not enough mana");
            manaUsed += c.cost;

            if (c.cardType == CardType.Attack) {
                (uint8 dmg, uint8 rem) = _blockDamage(eBlock, c.value);
                eBlock = rem;
                eHp    = eHp > dmg ? eHp - dmg : 0;
            } else if (c.cardType == CardType.Smite) {
                eHp = eHp > c.value ? eHp - c.value : 0;
            } else if (c.cardType == CardType.Block) {
                pBlock += c.value;
            } else if (c.cardType == CardType.Heal) {
                uint8 space = PLAYER_MAX_HP - pHp;
                pHp += space < c.value ? space : c.value;
            } else if (c.cardType == CardType.Drain) {
                (uint8 dmg, uint8 rem) = _blockDamage(eBlock, c.value);
                eBlock = rem;
                eHp    = eHp > dmg ? eHp - dmg : 0;
                uint8 heal  = c.value / 2;
                uint8 space = PLAYER_MAX_HP - pHp;
                pHp += space < heal ? space : heal;
            }

            if (eHp == 0) break;
        }

        // Save updated enemy block (persists to next turn if not fully depleted)
        g.enemyBlock = eBlock;

        // Compute deltas for the event (computed before enemy action reduces pHp)
        uint8 dmgDealt  = g.enemyHp - eHp;
        uint8 healAmt   = pHp - g.playerHp;

        // --- Check win -------------------------------------------------------
        LevelDef  memory lvl = levels[g.levelId];
        EnemyAction memory ea = enemyActions[g.levelId][g.turn % lvl.numActions];

        if (eHp == 0) {
            emit TurnResolved(msg.sender, dmgDealt, healAmt, pBlock,
                uint8(ea.actionType), ea.value, 0, pHp, 0, 0, g.turn, g.enemyBuffed);
            emit GameEnded(msg.sender, true);
            _clearGame(msg.sender);
            return;
        }

        // --- Resolve enemy action --------------------------------------------
        uint8 dmgTaken = 0;

        if (ea.actionType == EnemyActionType.Attack) {
            uint8 atkVal   = g.enemyBuffed ? ea.value * 2 : ea.value;
            uint8 absorbed = pBlock < atkVal ? pBlock : atkVal;
            uint8 netDmg   = atkVal - absorbed;
            pHp            = pHp > netDmg ? pHp - netDmg : 0;
            dmgTaken       = netDmg;
            g.enemyBuffed  = false;
        } else if (ea.actionType == EnemyActionType.Shield) {
            g.enemyBlock += ea.value;
        } else if (ea.actionType == EnemyActionType.Buff) {
            g.enemyBuffed = true;
        } else {
            // Regen — restore HP up to the level's starting max
            uint8 maxHp = levels[g.levelId].enemyHp;
            uint16 newHp = uint16(eHp) + uint16(ea.value);
            eHp = newHp > uint16(maxHp) ? maxHp : uint8(newHp);
        }

        emit TurnResolved(msg.sender, dmgDealt, healAmt, pBlock,
            uint8(ea.actionType), ea.value, dmgTaken, pHp, eHp, g.enemyBlock, g.turn, g.enemyBuffed);

        g.playerHp = pHp;
        g.enemyHp  = eHp;

        if (pHp == 0) {
            emit GameEnded(msg.sender, false);
            _clearGame(msg.sender);
            return;
        }

        // --- Prepare next turn -----------------------------------------------
        for (uint8 i = 0; i < g.handSize; i++) {
            g.deck[g.deckSize] = g.hand[i];
            g.deckSize++;
        }

        g.handSize    = 0;
        g.turn       += 1;
        g.commitBlock = block.number;
        g.phase       = Phase.Committed;
    }

    function forfeitGame() external {
        require(games[msg.sender].phase != Phase.None, "No active game");
        emit GameEnded(msg.sender, false);
        _clearGame(msg.sender);
    }

    // =====================================================================
    //  Trading
    // =====================================================================

    function createTrade(
        uint8   cardId,
        bool    wantsCard,
        uint8   wantedCardId,
        uint256 tokenPrice
    ) external noActiveGame {
        require(cardId < NUM_CARDS, "Invalid card");
        require(cardBalance[msg.sender][cardId] >= 1, "You don't own this card");
        if (wantsCard) require(wantedCardId < NUM_CARDS, "Invalid wanted card");

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

    function acceptTrade(uint256 tradeId) external payable noActiveGame {
        TradeOffer storage t = trades[tradeId];
        require(t.active, "Trade not active");

        if (t.wantsCard) {
            require(msg.value == 0, "No payment needed for card swap");
            cardBalance[msg.sender][t.wantedCardId] -= 1;
            cardBalance[t.seller][t.wantedCardId]   += 1;
        } else {
            require(msg.value == t.tokenPrice, "Wrong payment amount");
            (bool ok, ) = t.seller.call{value: msg.value}("");
            require(ok, "Payment failed");
        }

        cardBalance[msg.sender][t.offeredCardId] += 1;
        t.active = false;
        emit TradeFulfilled(tradeId, msg.sender);
    }

    function cancelTrade(uint256 tradeId) external {
        require(tradeId < trades.length, "Invalid trade id");
        TradeOffer storage t = trades[tradeId];
        require(t.active, "Trade not active");
        require(t.seller == msg.sender, "Not your trade");

        cardBalance[msg.sender][t.offeredCardId] += 1;
        t.active = false;
        emit TradeCancelled(tradeId);
    }

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

    function mintCard(address to, uint8 cardId, uint256 amount) external onlyOwner {
        require(cardId < NUM_CARDS, "Invalid card");
        cardBalance[to][cardId] += amount;
    }

    // =====================================================================
    //  View helpers
    // =====================================================================

    function getCollection(address player) external view returns (uint256[20] memory counts) {
        for (uint8 i = 0; i < NUM_CARDS; i++) {
            counts[i] = cardBalance[player][i];
        }
    }

    function getGame(address player) external view returns (
        uint8   levelId,
        uint8   phase,
        uint8   playerHp,
        uint8   enemyHp,
        uint8   turn,
        uint8   deckSize,
        uint8[5] memory hand,
        uint8   handSize,
        uint8   enemyBlock,
        bool    enemyBuffed
    ) {
        Game storage g = games[player];
        return (
            g.levelId, uint8(g.phase), g.playerHp, g.enemyHp,
            g.turn, g.deckSize, g.hand, g.handSize,
            g.enemyBlock, g.enemyBuffed
        );
    }

    function getTradeCount() external view returns (uint256) {
        return trades.length;
    }

    function getActiveTrades(uint256 offset, uint256 limit)
        external view returns (uint256[] memory ids, uint256 total)
    {
        uint256 count;
        for (uint256 i = 0; i < trades.length; i++) {
            if (trades[i].active && block.timestamp <= trades[i].expiresAt) count++;
        }
        total = count;

        if (offset >= count) { ids = new uint256[](0); return (ids, total); }
        uint256 end = offset + limit;
        if (end > count) end = count;
        ids = new uint256[](end - offset);

        uint256 found; uint256 written;
        for (uint256 i = 0; i < trades.length && written < ids.length; i++) {
            if (trades[i].active && block.timestamp <= trades[i].expiresAt) {
                if (found >= offset) ids[written++] = i;
                found++;
            }
        }
    }

    /// @notice Returns the card type (0-4), value, and mana cost for a given card ID.
    function getCardDef(uint8 cardId) external view returns (uint8 cardType, uint8 value, uint8 cost) {
        require(cardId < NUM_CARDS, "Invalid card");
        return (uint8(cards[cardId].cardType), cards[cardId].value, cards[cardId].cost);
    }

    /// @notice Returns the enemy action type (0-2) and value for a given level/turn.
    function getEnemyAction(uint8 levelId, uint8 turn) external view returns (uint8 actionType, uint8 value) {
        require(levelId < NUM_LEVELS, "Invalid level");
        LevelDef memory lvl = levels[levelId];
        EnemyAction memory ea = enemyActions[levelId][turn % lvl.numActions];
        return (uint8(ea.actionType), ea.value);
    }

    // =====================================================================
    //  Internal helpers
    // =====================================================================

    function _initGame(uint8 levelId, uint8[15] calldata deck) private {
        require(levelId < NUM_LEVELS, "Invalid level");

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
        g.enemyBlock  = 0;
        g.enemyBuffed = false;

        for (uint8 i = 0; i < DECK_SIZE; i++) {
            g.deck[i] = deck[i];
        }

        emit GameStarted(msg.sender, levelId);
    }

    function _dealHand(uint256 seed) private {
        Game storage g = games[msg.sender];
        uint8 toDeal = g.deckSize < HAND_SIZE ? g.deckSize : HAND_SIZE;

        for (uint8 i = 0; i < toDeal; i++) {
            uint8 remaining = g.deckSize - i;
            uint8 j = i + uint8(seed % remaining);
            seed = uint256(keccak256(abi.encodePacked(seed)));
            uint8 tmp  = g.deck[i];
            g.deck[i]  = g.deck[j];
            g.deck[j]  = tmp;
        }

        for (uint8 i = 0; i < toDeal; i++) {
            g.hand[i] = g.deck[i];
        }
        g.handSize = toDeal;

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

    function _blockDamage(uint8 block_, uint8 value) private pure returns (uint8 dmg, uint8 remainingBlock) {
        uint8 absorbed = block_ < value ? block_ : value;
        dmg            = value - absorbed;
        remainingBlock = block_ > value ? block_ - value : 0;
    }

    function _clearGame(address player) private {
        delete games[player];
    }
}
