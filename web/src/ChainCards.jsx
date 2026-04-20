import { useState, useCallback, useEffect, useRef } from "react";

import {
  getCollection,
  claimStarterPack,
  commitPack as contractCommitPack,
  openPack as contractOpenPack,
  watchPackOpened,
  commitDeck as contractCommitDeck,
  dealHand as contractDealHand,
  playCards as contractPlayCards,
  forfeitGame as contractForfeitGame,
  createTrade as contractCreateTrade,
  cancelTrade as contractCancelTrade,
  acceptTrade as contractAcceptTrade,
  getActiveTrades as contractGetActiveTrades,
  getTradeDetails as contractGetTradeDetails,
  getGame as contractGetGame,
  getStarterClaimed,
  getWalletBalance,
  parseReceiptLogs,
} from "./hooks/useContract";

// ─── Card & Level Data (mirrors the Solidity contract) ───────────────
const CARD_DEFS = [
  { id: 0,  name: "Ember Sprite",    atk: 6,  def: 2,  color: "#e85d3a" },
  { id: 1,  name: "Stone Golem",     atk: 2,  def: 7,  color: "#8b8b7a" },
  { id: 2,  name: "Shadow Blade",    atk: 7,  def: 1,  color: "#6b3fa0" },
  { id: 3,  name: "Iron Shield",     atk: 1,  def: 8,  color: "#7a8e9e" },
  { id: 4,  name: "Fire Drake",      atk: 8,  def: 3,  color: "#d44a1a" },
  { id: 5,  name: "Frost Warden",    atk: 3,  def: 6,  color: "#4a9ad4" },
  { id: 6,  name: "Thunder Strike",  atk: 9,  def: 1,  color: "#d4c74a" },
  { id: 7,  name: "Earth Guardian",  atk: 2,  def: 8,  color: "#5a7a3a" },
  { id: 8,  name: "Wind Runner",     atk: 5,  def: 4,  color: "#7acaaa" },
  { id: 9,  name: "Crystal Mage",    atk: 6,  def: 5,  color: "#aa5ad4" },
  { id: 10, name: "Void Walker",     atk: 7,  def: 3,  color: "#3a1a5a" },
  { id: 11, name: "Light Paladin",   atk: 4,  def: 7,  color: "#dac060" },
  { id: 12, name: "Dark Assassin",   atk: 8,  def: 2,  color: "#2a2a3a" },
  { id: 13, name: "Water Elemental", atk: 5,  def: 5,  color: "#2a7aba" },
  { id: 14, name: "Flame Phoenix",   atk: 9,  def: 2,  color: "#ea6a0a" },
  { id: 15, name: "Ancient Turtle",  atk: 1,  def: 9,  color: "#3a6a4a" },
  { id: 16, name: "Storm Giant",     atk: 7,  def: 4,  color: "#5a6a9a" },
  { id: 17, name: "Mystic Healer",   atk: 3,  def: 7,  color: "#ba7aea" },
  { id: 18, name: "Chaos Dragon",    atk: 10, def: 1,  color: "#1a0a2a" },
  { id: 19, name: "Divine Angel",    atk: 5,  def: 6,  color: "#eaeaca" },
];

const LEVELS = [
  { id: 0, name: "Goblin Camp",   emoji: "👺", hp: 20, actions: [{a:4,d:1},{a:3,d:2},{a:5,d:0}] },
  { id: 1, name: "Dark Forest",   emoji: "🌲", hp: 35, actions: [{a:6,d:3},{a:5,d:4},{a:8,d:2},{a:4,d:5}] },
  { id: 2, name: "Dragon's Lair", emoji: "🐉", hp: 50, actions: [{a:8,d:4},{a:10,d:2},{a:6,d:6},{a:12,d:3},{a:7,d:5}] },
];

const DECK_SIZE = 15, HAND_SIZE = 5, MAX_PLAY = 3, PLAYER_MAX_HP = 30;

// ─── Parse HandDealt event from a tx receipt ─────────────────────────────────
function parseHandFromReceipt(receipt, account) {
  const logs = parseReceiptLogs(receipt);
  const ev = logs.find(
    (l) =>
      l.eventName === "HandDealt" &&
      l.args?.player?.toLowerCase() === account?.toLowerCase()
  );
  if (!ev) throw new Error("HandDealt event not found in receipt");
  const { h0, h1, h2, h3, h4, handSize } = ev.args;
  const size = Number(handSize);
  return [h0, h1, h2, h3, h4].slice(0, size).map(Number);
}

// ─── Card Component ──────────────────────────────────────────────────
function Card({ cardId, selected, onClick, small, played, count, dimmed }) {
  const c = CARD_DEFS[cardId];
  const isLight = c.color === "#eaeaca" || c.color === "#dac060" || c.color === "#d4c74a";
  return (
    <div onClick={onClick} style={{
      width: small ? 90 : 120, minHeight: small ? 130 : 170,
      background: `linear-gradient(145deg, ${c.color}, ${c.color}dd, #0a0a14)`,
      border: selected ? "2px solid #ffd700" : "2px solid #333",
      borderRadius: 10, padding: "10px 8px", cursor: onClick ? "pointer" : "default",
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      position: "relative", transition: "all 0.2s",
      transform: selected ? "translateY(-6px)" : played ? "scale(0.9)" : "none",
      opacity: dimmed ? 0.35 : played ? 0.5 : 1,
      boxShadow: selected ? "0 0 20px #ffd70066" : "0 2px 8px #0005",
      fontFamily: "'Courier New', monospace",
    }}>
      {count > 1 && <div style={{
        position:"absolute", top:-8, right:-8, background:"#ffd700", color:"#000",
        borderRadius:"50%", width:22, height:22, display:"flex", alignItems:"center",
        justifyContent:"center", fontSize:12, fontWeight:700
      }}>{count}</div>}
      <div style={{ fontSize: small ? 10 : 12, fontWeight: 700, color: isLight ? "#111" : "#fff",
        lineHeight: 1.2, letterSpacing: 0.5 }}>{c.name}</div>
      <div style={{ fontSize: small ? 28 : 36, textAlign: "center", margin: "4px 0",
        filter: "drop-shadow(0 0 6px #0008)" }}>
        {["🔥","🪨","🗡️","🛡️","🐲","❄️","⚡","🌿","💨","🔮",
          "🌀","☀️","🌑","🌊","🦅","🐢","🌩️","✨","💀","👼"][cardId]}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: small ? 11 : 13, fontWeight: 700 }}>
        <span style={{ color: "#ff6b6b" }}>⚔{c.atk}</span>
        <span style={{ color: "#6bafff" }}>🛡{c.def}</span>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────
export default function ChainCardsGame() {
  const [collection, setCollection] = useState(() => Array(20).fill(0));
  const [account, setAccount] = useState(null);
  const [starterClaimed, setStarterClaimed] = useState(false);
  const [walletBalance, setWalletBalance] = useState("0");
  const [screen, setScreen] = useState("home");
  const [log, setLog] = useState([]);
  const logRef = useRef(null);

  // Connect wallet
  useEffect(() => {
    window.ethereum?.request({ method: "eth_requestAccounts" })
      .then(([addr]) => setAccount(addr));
  }, []);

  // Load on-chain state when account is available
  useEffect(() => {
    if (!account) return;
    getCollection(account).then((counts) => setCollection(counts.map(Number)));
    getStarterClaimed(account).then(setStarterClaimed);
    getWalletBalance(account).then((bal) =>
      setWalletBalance((Number(bal) / 1e10).toFixed(2))
    );
  }, [account]);

  // Resume active game on load
  useEffect(() => {
    if (!account) return;
    contractGetGame(account)
      .then((result) => {
        const [levelId, phase, playerHp, enemyHp, turn, deckSize, hand, handSize] = result;
        const phaseNum = Number(phase);
        if (phaseNum === 0) return;
        const lvl = LEVELS[Number(levelId)];
        const size = Number(handSize);
        const handCards = Array.from(hand).slice(0, size).map(Number);
        const isDealt = phaseNum === 2;
        setBattle({
          level: Number(levelId), playerHp: Number(playerHp), enemyHp: Number(enemyHp),
          turn: Number(turn), deckSize: Number(deckSize),
          hand: handCards, handSize: size,
          selectedCards: [], phase: isDealt ? "play" : "dealing",
          battleLog: [`Resumed vs ${lvl.name} — Turn ${Number(turn) + 1}`],
        });
        setScreen("battle");
        if (!isDealt) {
          contractDealHand()
            .then((receipt) => {
              const newHand = parseHandFromReceipt(receipt, account);
              setBattle((prev) => ({
                ...prev, phase: "play",
                hand: newHand, handSize: newHand.length,
                deckSize: prev.deckSize - newHand.length,
                selectedCards: [],
              }));
            })
            .catch((e) =>
              setBattle((prev) => ({
                ...prev, phase: "play",
                battleLog: [...prev.battleLog, `Deal failed: ${e.message}`],
              }))
            );
        }
      })
      .catch(() => {});
  }, [account]);

  // Watch pack-opened events to refresh collection and balance
  useEffect(() => {
    if (!account) return;
    const unwatch = watchPackOpened((player) => {
      if (player.toLowerCase() === account.toLowerCase()) {
        getCollection(account).then((c) => setCollection(c.map(Number)));
        getWalletBalance(account).then((bal) =>
          setWalletBalance((Number(bal) / 1e10).toFixed(2))
        );
      }
    });
    return unwatch;
  }, [account]);

  const refreshBalance = useCallback(() => {
    if (!account) return;
    getWalletBalance(account)
      .then((bal) => setWalletBalance((Number(bal) / 1e10).toFixed(2)))
      .catch(() => {});
  }, [account]);

  // Deck builder
  const [selectedLevel, setSelectedLevel] = useState(null);
  const [deck, setDeck] = useState(() => {
    try { return JSON.parse(localStorage.getItem("deck") ?? "[]"); } catch { return []; }
  });

  useEffect(() => {
    if (account) localStorage.setItem(`deck:${account}`, JSON.stringify(deck));
  }, [deck, account]);

  // Reload deck when account switches
  useEffect(() => {
    if (!account) return;
    try { setDeck(JSON.parse(localStorage.getItem(`deck:${account}`) ?? "[]")); } catch { setDeck([]); }
  }, [account]);

  // Battle state — phase: "committing"|"dealing"|"play"|"resolving"|"forfeiting"|"won"|"lost"
  const [battle, setBattle] = useState(null);

  // Shop — packState: "idle"|"committing"|"committed"|"opening"
  const [packState, setPackState] = useState("idle");
  const [packResult, setPackResult] = useState(null);

  // Trade
  const [trades, setTrades] = useState([]);
  const [tradeForm, setTradeForm] = useState({ cardId: 0, wantsCard: false, wantedCardId: 0, price: 50 });
  const [tradePending, setTradePending] = useState(false);

  const addLog = useCallback((msg) => {
    setLog((prev) => [...prev.slice(-50), { msg, t: Date.now() }]);
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  // ─── Starter Pack ────────────────────────────────────────────────
  const handleClaimStarter = async () => {
    try {
      await claimStarterPack();
      setStarterClaimed(true);
      const updated = await getCollection(account);
      setCollection(updated.map(Number));
      addLog("🎁 Starter pack claimed!");
    } catch (e) {
      addLog(`❌ ${e.message}`);
    }
  };

  // ─── Shop ────────────────────────────────────────────────────────
  const handleCommitPack = async () => {
    try {
      setPackState("committing");
      await contractCommitPack();
      setPackState("committed");
      refreshBalance();
      addLog("📦 Pack committed — ready to open!");
    } catch (e) {
      setPackState("idle");
      addLog(`❌ Pack commit failed: ${e.message}`);
    }
  };

  const handleOpenPack = async () => {
    try {
      setPackState("opening");
      const receipt = await contractOpenPack();
      const logs = parseReceiptLogs(receipt);
      const ev = logs.find((l) => l.eventName === "PackOpened");
      if (ev) {
        const { card0, card1, card2 } = ev.args;
        const results = [Number(card0), Number(card1), Number(card2)];
        setPackResult(results);
        addLog(`🎉 Got: ${CARD_DEFS[results[0]].name}, ${CARD_DEFS[results[1]].name}, ${CARD_DEFS[results[2]].name}`);
        getCollection(account).then((c) => setCollection(c.map(Number)));
      }
      setPackState("idle");
    } catch (e) {
      setPackState("committed");
      addLog(`❌ Pack open failed: ${e.message}`);
    }
  };

  // ─── Deck Builder ────────────────────────────────────────────────
  const toggleDeckCard = (cardId) => {
    const inDeck = deck.filter((d) => d === cardId).length;
    const owned = collection[cardId];
    if (inDeck === 0 && deck.length < DECK_SIZE) {
      setDeck([...deck, cardId]);
    } else if (inDeck === owned) {
      setDeck(deck.filter((d) => d !== cardId));
    } else if (deck.length < DECK_SIZE) {
      setDeck([...deck, cardId]);
    } else {
      const idx = deck.lastIndexOf(cardId);
      setDeck(deck.filter((_, i) => i !== idx));
    }
  };

  // Cards in deck that exceed current collection (e.g. traded away)
  const deckInvalid = (() => {
    const counts = {};
    for (const id of deck) counts[id] = (counts[id] ?? 0) + 1;
    return Object.entries(counts)
      .filter(([id, n]) => collection[id] < n)
      .map(([id]) => Number(id));
  })();

  // ─── Battle ──────────────────────────────────────────────────────
  const startGame = async () => {
    if (deck.length !== DECK_SIZE || selectedLevel === null) return;
    if (deckInvalid.length > 0) {
      addLog(`❌ Deck invalid: you no longer own enough ${deckInvalid.map(id => CARD_DEFS[id].name).join(", ")}.`);
      return;
    }
    const lvl = LEVELS[selectedLevel];
    setBattle({
      level: selectedLevel, playerHp: PLAYER_MAX_HP, enemyHp: lvl.hp,
      turn: 0, deckSize: DECK_SIZE, hand: [], handSize: 0,
      selectedCards: [], phase: "committing",
      battleLog: [`⚔️ Starting vs ${lvl.name} — committing deck...`],
    });
    setScreen("battle");
    try {
      await contractCommitDeck(selectedLevel, deck);
      setBattle((prev) => ({
        ...prev, phase: "dealing",
        battleLog: [...prev.battleLog, "Dealing hand on-chain..."],
      }));
      const receipt = await contractDealHand();
      const hand = parseHandFromReceipt(receipt, account);
      setBattle((prev) => ({
        ...prev, phase: "play",
        hand, handSize: hand.length,
        deckSize: DECK_SIZE - hand.length,
        selectedCards: [],
        battleLog: [...prev.battleLog, `--- Turn 1 vs ${lvl.name} (HP ${lvl.hp}) ---`],
      }));
      addLog(`⚔️ Game started: ${lvl.name}`);
    } catch (e) {
      addLog(`❌ Failed to start: ${e.message}`);
      setBattle(null);
      setScreen("deckbuild");
    }
  };

  const toggleBattleCard = (idx) => {
    if (!battle || battle.phase !== "play") return;
    setBattle((prev) => {
      const sel = prev.selectedCards.includes(idx)
        ? prev.selectedCards.filter((i) => i !== idx)
        : prev.selectedCards.length < MAX_PLAY
          ? [...prev.selectedCards, idx]
          : prev.selectedCards;
      return { ...prev, selectedCards: sel };
    });
  };

  const playTurn = async () => {
    if (!battle || battle.selectedCards.length === 0) return;
    const indices = [...battle.selectedCards];
    setBattle((prev) => ({ ...prev, phase: "resolving", selectedCards: [] }));
    try {
      const receipt = await contractPlayCards(indices);
      const logs = parseReceiptLogs(receipt);
      const turnEv = logs.find((l) => l.eventName === "TurnResolved");
      const endEv = logs.find((l) => l.eventName === "GameEnded");
      const lvl = LEVELS[battle.level];
      const bLog = [...battle.battleLog];

      if (turnEv) {
        const { playerAtk, playerDef, enemyAtk, enemyDef, playerHp, enemyHp } = turnEv.args;
        const dmgToEnemy = Math.max(0, Number(playerAtk) - Number(enemyDef));
        const dmgToPlayer = Math.max(0, Number(enemyAtk) - Number(playerDef));
        bLog.push(`Played ${indices.length} card(s): ⚔${playerAtk} 🛡${playerDef}`);
        bLog.push(`→ Deal ${dmgToEnemy} dmg to enemy. Enemy HP: ${enemyHp}`);
        if (!endEv) {
          bLog.push(`← Enemy attacks for ${enemyAtk} (blocked ${Math.min(Number(playerDef), Number(enemyAtk))}). You take ${dmgToPlayer}. HP: ${playerHp}`);
        }

        if (endEv) {
          const won = endEv.args.won;
          bLog.push(won ? "🏆 VICTORY!" : "💀 DEFEAT.");
          setBattle((prev) => ({
            ...prev, phase: won ? "won" : "lost",
            playerHp: Number(playerHp), enemyHp: Number(enemyHp), battleLog: bLog,
          }));
          addLog(won ? `🏆 Won at ${lvl.name}!` : `💀 Lost at ${lvl.name}`);
          getCollection(account).then((c) => setCollection(c.map(Number)));
        } else {
          // Unplayed cards return to deck — track rough deck size
          const unplayed = battle.handSize - indices.length;
          bLog.push(`--- Turn ${battle.turn + 2} ---`);
          setBattle((prev) => ({
            ...prev, phase: "dealing",
            playerHp: Number(playerHp), enemyHp: Number(enemyHp),
            turn: prev.turn + 1, deckSize: prev.deckSize + unplayed,
            battleLog: bLog,
          }));
          const dealReceipt = await contractDealHand();
          const hand = parseHandFromReceipt(dealReceipt, account);
          setBattle((prev) => ({
            ...prev, phase: "play",
            hand, handSize: hand.length,
            deckSize: prev.deckSize - hand.length,
            selectedCards: [],
          }));
        }
      }
    } catch (e) {
      addLog(`❌ Play failed: ${e.message}`);
      setBattle((prev) => ({ ...prev, phase: "play" }));
    }
  };

  const handleForfeit = async () => {
    if (!battle) return;
    setBattle((prev) => ({ ...prev, phase: "forfeiting" }));
    try {
      await contractForfeitGame();
    } catch (e) {
      addLog(`❌ Forfeit failed: ${e.message}`);
    }
    setBattle(null);
    setScreen("deckbuild");
    addLog("🏳️ Forfeited game.");
  };

  // ─── Trades ──────────────────────────────────────────────────────
  const loadTrades = useCallback(async () => {
    if (!account) return;
    try {
      const [ids] = await contractGetActiveTrades(0n, 50n);
      const details = await Promise.all(
        ids.map(async (id) => {
          const t = await contractGetTradeDetails(id);
          const seller        = t.seller       ?? t[0] ?? "0x";
          const offeredCardId = Number(t.offeredCardId ?? t[1] ?? 0);
          const wantsCard     = t.wantsCard    ?? t[2] ?? false;
          const wantedCardId  = Number(t.wantedCardId  ?? t[3] ?? 0);
          const tokenPrice    = BigInt(t.tokenPrice    ?? t[4] ?? 0);
          const active        = t.active       ?? t[6] ?? false;
          console.debug("trade", String(id), { seller, offeredCardId, wantsCard, wantedCardId, tokenPrice: tokenPrice.toString(), active });
          return { id, seller, offeredCardId, wantsCard, wantedCardId, tokenPrice, active };
        })
      );
      setTrades(details);
    } catch (e) {
      addLog(`❌ Failed to load trades: ${e.message}`);
    }
  }, [account, addLog]);

  useEffect(() => {
    if (screen === "trade" && account) loadTrades();
  }, [screen, account, loadTrades]);

  const handleCreateTrade = async () => {
    const { cardId, wantsCard, wantedCardId, price } = tradeForm;
    if (collection[cardId] < 1) { addLog("❌ You don't own that card."); return; }
    setTradePending(true);
    try {
      const gameState = await contractGetGame(account);
      if (Number(gameState[1] !== 0)) { addLog("❌ Finish your current game before trading."); return; }
      const priceWei = BigInt(Math.round(price * 1e10));
      await contractCreateTrade(cardId, wantsCard, wantedCardId, priceWei);
      addLog(`📝 Listed ${CARD_DEFS[cardId].name}.`);
      getCollection(account).then((c) => setCollection(c.map(Number)));
      await loadTrades();
    } catch (e) {
      addLog(`❌ Trade failed: ${e.message}`);
    }
    setTradePending(false);
  };

  const handleCancelTrade = async (tradeId) => {
    setTradePending(true);
    try {
      await contractCancelTrade(tradeId);
      addLog("🔙 Trade cancelled.");
      getCollection(account).then((c) => setCollection(c.map(Number)));
      await loadTrades();
    } catch (e) {
      addLog(`❌ Cancel failed: ${e.message}`);
    }
    setTradePending(false);
  };

  const handleAcceptTrade = async (trade) => {
    setTradePending(true);
    try {
      const value = trade.wantsCard ? 0n : trade.tokenPrice;
      await contractAcceptTrade(trade.id, value);
      addLog("✅ Trade accepted!");
      getCollection(account).then((c) => setCollection(c.map(Number)));
      await loadTrades();
    } catch (e) {
      addLog(`❌ Accept failed: ${e.message}`);
    }
    setTradePending(false);
  };

  // ─── Render ──────────────────────────────────────────────────────
  const totalCards = collection.reduce((a, b) => a + b, 0);
  const owned = collection.filter((c) => c > 0).length;

  const sty = {
    page: { minHeight: "100vh", background: "linear-gradient(170deg, #080810 0%, #0d1117 40%, #0a0e1a 100%)", color: "#e0dcd0", fontFamily: "'Georgia', serif" },
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #222", background: "#0004" },
    title: { fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "#ffd700", textTransform: "uppercase" },
    stats: { display: "flex", gap: 20, fontSize: 14, color: "#aaa" },
    nav: { display: "flex", gap: 6, padding: "12px 24px", flexWrap: "wrap" },
    navBtn: (active) => ({
      padding: "8px 18px", borderRadius: 6, border: active ? "1px solid #ffd700" : "1px solid #333",
      background: active ? "#ffd70018" : "#111", color: active ? "#ffd700" : "#aaa",
      cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.2s"
    }),
    section: { padding: "16px 24px" },
    grid: { display: "flex", flexWrap: "wrap", gap: 10 },
    btn: (disabled) => ({
      padding: "10px 24px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 14,
      cursor: disabled ? "not-allowed" : "pointer", transition: "all 0.2s",
      background: disabled ? "#333" : "linear-gradient(135deg, #ffd700, #e8a800)",
      color: disabled ? "#666" : "#000", opacity: disabled ? 0.5 : 1
    }),
    btnDanger: { padding: "8px 18px", borderRadius: 8, border: "1px solid #ff4444", background: "transparent", color: "#ff4444", cursor: "pointer", fontSize: 13 },
    log: { maxHeight: 160, overflowY: "auto", background: "#0a0a14", border: "1px solid #222", borderRadius: 8, padding: 10, fontSize: 12, color: "#8a8a7a", lineHeight: 1.6 },
    pending: { color: "#888", fontSize: 14, padding: "20px 0", textAlign: "center" },
  };

  const PENDING_PHASES = ["committing", "dealing", "resolving", "forfeiting"];
  const PENDING_LABELS = {
    committing: "Committing deck to blockchain...",
    dealing: "Dealing hand on-chain...",
    resolving: "Resolving turn on-chain...",
    forfeiting: "Forfeiting game...",
  };

  return (
    <div style={sty.page}>
      {/* Header */}
      <div style={sty.header}>
        <div style={sty.title}>Chain Cards</div>
        <div style={sty.stats}>
          <span>🃏 {totalCards} cards ({owned}/20 unique)</span>
          <span>🪙 {walletBalance} DOT</span>
        </div>
      </div>

      {/* Active game banner */}
      {battle && screen !== "battle" && !["won","lost"].includes(battle.phase) && (
        <div style={{
          background: "linear-gradient(90deg, #1a0a00, #2a1400, #1a0a00)",
          borderBottom: "1px solid #ff6a00", padding: "8px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ color: "#ff9a00", fontSize: 13 }}>
            ⚔️ Game in progress — {LEVELS[battle.level].name} | Turn {battle.turn + 1} | HP {battle.playerHp}/{PLAYER_MAX_HP}
          </span>
          <button
            onClick={() => setScreen("battle")}
            style={{ padding: "5px 16px", borderRadius: 6, border: "1px solid #ff6a00",
              background: "#ff6a0022", color: "#ff9a00", cursor: "pointer", fontSize: 13, fontWeight: 700 }}
          >
            Return to Battle
          </button>
        </div>
      )}

      {/* Nav */}
      <div style={sty.nav}>
        {!starterClaimed && (
          <button
            onClick={handleClaimStarter}
            style={{ ...sty.btn(false), background: "linear-gradient(135deg, #4af, #27d)", color: "#fff" }}
          >
            Claim Starter Pack
          </button>
        )}
        {battle && !["won","lost"].includes(battle.phase) && (
          <button
            onClick={() => setScreen("battle")}
            style={{ ...sty.navBtn(screen === "battle"), borderColor: "#ff6a00", color: screen === "battle" ? "#ff9a00" : "#cc5500" }}
          >
            ⚔️ Battle
          </button>
        )}
        {[["home","Home"],["collection","Collection"],["deckbuild","Play"],["shop","Shop"],["trade","Trade"]].map(([k,l]) => (
          <button key={k} style={sty.navBtn(screen===k)} onClick={() => setScreen(k)}>{l}</button>
        ))}
      </div>

      {/* Home */}
      {screen === "home" && (
        <div style={sty.section}>
          <h2 style={{ color: "#ffd700", margin: "0 0 12px" }}>Welcome to Chain Cards</h2>
          <p style={{ color: "#888", lineHeight: 1.7, maxWidth: 640 }}>
            Collect 20 unique cards, build decks, and battle AI enemies across 3 levels.
            Card ownership and deck shuffling are handled on-chain — no cheating possible.
            Buy booster packs with tokens, trade cards with other players, and earn rewards for victories.
          </p>
          {!starterClaimed && <p style={{ color: "#ffd700", marginTop: 16 }}>👆 Claim your starter pack to begin!</p>}
          <div style={{ marginTop: 20 }}>
            <div style={{ color: "#666", fontSize: 13, marginBottom: 8 }}>Activity Log</div>
            <div ref={logRef} style={sty.log}>
              {log.length === 0 && <div style={{ color: "#444" }}>No activity yet...</div>}
              {log.map((l, i) => <div key={i}>{l.msg}</div>)}
            </div>
          </div>
        </div>
      )}

      {/* Collection */}
      {screen === "collection" && (
        <div style={sty.section}>
          <h2 style={{ color: "#ffd700", margin: "0 0 16px" }}>Your Collection</h2>
          <div style={sty.grid}>
            {CARD_DEFS.map((c) => (
              <Card key={c.id} cardId={c.id} count={collection[c.id]} dimmed={collection[c.id] === 0} />
            ))}
          </div>
        </div>
      )}

      {/* Deck Builder & Level Select */}
      {screen === "deckbuild" && !battle && (
        <div style={sty.section}>
          <h2 style={{ color: "#ffd700", margin: "0 0 12px" }}>Select Level</h2>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {LEVELS.map((l) => (
              <div key={l.id} onClick={() => setSelectedLevel(l.id)} style={{
                padding: "14px 20px", borderRadius: 10, cursor: "pointer", flex: 1, maxWidth: 200,
                border: selectedLevel === l.id ? "2px solid #ffd700" : "2px solid #333",
                background: selectedLevel === l.id ? "#ffd70012" : "#111", transition: "all 0.2s"
              }}>
                <div style={{ fontSize: 28 }}>{l.emoji}</div>
                <div style={{ fontWeight: 700, margin: "4px 0" }}>{l.name}</div>
                <div style={{ fontSize: 12, color: "#888" }}>Enemy HP: {l.hp}</div>
                <div style={{ fontSize: 11, color: "#666" }}>
                  Turns: {l.actions.map((a) => `${a.a}⚔/${a.d}🛡`).join(" → ")}
                </div>
              </div>
            ))}
          </div>

          <h2 style={{ color: "#ffd700", margin: "0 0 8px" }}>Build Deck ({deck.length}/{DECK_SIZE})</h2>
          <p style={{ fontSize: 12, color: "#666", margin: "0 0 12px" }}>Click cards to add/remove. You need exactly 15 cards.</p>

          <div style={sty.grid}>
            {CARD_DEFS.map((c) => {
              if (collection[c.id] === 0 && !deck.includes(c.id)) return null;
              const inDeck = deck.filter((d) => d === c.id).length;
              const invalid = deckInvalid.includes(c.id);
              return (
                <div key={c.id} style={{ position: "relative" }}>
                  {invalid && <div style={{ position: "absolute", top: -8, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "#ff6b6b", zIndex: 1 }}>⚠️ traded away</div>}
                  <Card cardId={c.id} small onClick={() => toggleDeckCard(c.id)}
                    selected={inDeck > 0} count={collection[c.id]}
                    dimmed={invalid} />
                  {inDeck > 0 && (
                    <div style={{
                      position: "absolute", bottom: -6, left: "50%", transform: "translateX(-50%)",
                      background: "#ffd700", color: "#000", borderRadius: 10, padding: "1px 8px",
                      fontSize: 11, fontWeight: 700
                    }}>×{inDeck}</div>
                  )}
                </div>
              );
            })}
          </div>

          {deck.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>
                Deck: {deck.map((d) => CARD_DEFS[d].name).join(", ")}
              </div>
              <div style={{ display: "flex", gap: 10, fontSize: 12, color: "#aaa" }}>
                <span>Total ATK: {deck.reduce((s, d) => s + CARD_DEFS[d].atk, 0)}</span>
                <span>Total DEF: {deck.reduce((s, d) => s + CARD_DEFS[d].def, 0)}</span>
                <span>Avg ATK: {(deck.reduce((s, d) => s + CARD_DEFS[d].atk, 0) / deck.length).toFixed(1)}</span>
              </div>
            </div>
          )}

          {deckInvalid.length > 0 && (
            <div style={{ color: "#ff6b6b", fontSize: 12, margin: "8px 0" }}>
              ⚠️ Cards no longer owned: {deckInvalid.map(id => CARD_DEFS[id].name).join(", ")}. Remove them before starting.
            </div>
          )}
          <button
            onClick={startGame}
            disabled={deck.length !== DECK_SIZE || selectedLevel === null || deckInvalid.length > 0}
            style={{ ...sty.btn(deck.length !== DECK_SIZE || selectedLevel === null || deckInvalid.length > 0), marginTop: 8 }}
          >
            Start Game
          </button>
        </div>
      )}

      {/* Battle Screen */}
      {screen === "battle" && battle && (
        <div style={sty.section}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 13, color: "#888" }}>You</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>HP {battle.playerHp}</div>
                <div style={{ width: 150, height: 10, background: "#222", borderRadius: 5, overflow: "hidden" }}>
                  <div style={{
                    width: `${(battle.playerHp / PLAYER_MAX_HP) * 100}%`, height: "100%",
                    background: battle.playerHp > 15 ? "#4a4" : battle.playerHp > 7 ? "#da4" : "#d44",
                    transition: "width 0.3s"
                  }} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#666" }}>Deck: {battle.deckSize} cards | Turn {battle.turn + 1}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: "#888" }}>{LEVELS[battle.level].name} {LEVELS[battle.level].emoji}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                <div style={{ width: 150, height: 10, background: "#222", borderRadius: 5, overflow: "hidden" }}>
                  <div style={{
                    width: `${(battle.enemyHp / LEVELS[battle.level].hp) * 100}%`, height: "100%",
                    background: "#d44", transition: "width 0.3s"
                  }} />
                </div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>HP {battle.enemyHp}</div>
              </div>
              {battle.phase === "play" && (() => {
                const ea = LEVELS[battle.level].actions[battle.turn % LEVELS[battle.level].actions.length];
                return <div style={{ fontSize: 11, color: "#a66" }}>Next enemy action: ⚔{ea.a} 🛡{ea.d}</div>;
              })()}
            </div>
          </div>

          {/* Pending tx states */}
          {PENDING_PHASES.includes(battle.phase) && (
            <div style={sty.pending}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>
              {PENDING_LABELS[battle.phase]}
            </div>
          )}

          {/* Play phase */}
          {battle.phase === "play" && (
            <>
              <div style={{ fontSize: 13, color: "#aaa", marginBottom: 8 }}>
                Select up to 3 cards to play ({battle.selectedCards.length}/3):
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                {battle.hand.slice(0, battle.handSize).map((cardId, idx) => (
                  <Card key={idx} cardId={cardId} small
                    selected={battle.selectedCards.includes(idx)}
                    onClick={() => toggleBattleCard(idx)} />
                ))}
              </div>
              {battle.selectedCards.length > 0 && (
                <div style={{ fontSize: 12, color: "#aaa", marginBottom: 8 }}>
                  Combined: ⚔{battle.selectedCards.reduce((s, i) => s + CARD_DEFS[battle.hand[i]].atk, 0)}
                  {" "} 🛡{battle.selectedCards.reduce((s, i) => s + CARD_DEFS[battle.hand[i]].def, 0)}
                </div>
              )}
              <button
                onClick={playTurn}
                disabled={battle.selectedCards.length === 0}
                style={sty.btn(battle.selectedCards.length === 0)}
              >
                Play Cards
              </button>
            </>
          )}

          {/* End states */}
          {(battle.phase === "won" || battle.phase === "lost") && (
            <div style={{ textAlign: "center", padding: 30 }}>
              <div style={{ fontSize: 48 }}>{battle.phase === "won" ? "🏆" : "💀"}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: battle.phase === "won" ? "#ffd700" : "#ff4444", marginTop: 8 }}>
                {battle.phase === "won" ? "VICTORY!" : "DEFEAT"}
              </div>
              <button
                onClick={() => { setBattle(null); setScreen("deckbuild"); }}
                style={{ ...sty.btn(false), marginTop: 20 }}
              >
                Play Again
              </button>
            </div>
          )}

          {/* Battle log */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: "#555", marginBottom: 4 }}>Battle Log</div>
            <div style={{
              maxHeight: 140, overflowY: "auto", background: "#0a0a14", border: "1px solid #1a1a2a",
              borderRadius: 6, padding: 8, fontSize: 12, color: "#7a7a6a", lineHeight: 1.6
            }}>
              {battle.battleLog.map((l, i) => (
                <div key={i} style={{
                  color: l.startsWith("🏆") ? "#ffd700" : l.startsWith("💀") ? "#f44" :
                    l.startsWith("---") ? "#555" : "#8a8a7a"
                }}>{l}</div>
              ))}
            </div>
          </div>

          {/* Forfeit (only when player can act) */}
          {(battle.phase === "play") && (
            <button onClick={handleForfeit} style={{ ...sty.btnDanger, marginTop: 12 }}>
              Forfeit
            </button>
          )}
        </div>
      )}

      {/* Shop */}
      {screen === "shop" && (
        <div style={sty.section}>
          <h2 style={{ color: "#ffd700", margin: "0 0 16px" }}>Booster Shop</h2>
          <div style={{
            background: "#111", border: "1px solid #333", borderRadius: 12, padding: 24,
            maxWidth: 400, textAlign: "center"
          }}>
            <div style={{ fontSize: 48 }}>📦</div>
            <div style={{ fontSize: 18, fontWeight: 700, margin: "8px 0" }}>Booster Pack</div>
            <div style={{ color: "#888", fontSize: 14 }}>3 random cards — 1 DOT</div>

            {packState === "idle" && !packResult && (
              <button onClick={handleCommitPack} style={{ ...sty.btn(false), marginTop: 16 }}>
                Buy Pack (1 DOT)
              </button>
            )}
            {(packState === "committing" || packState === "opening") && (
              <div style={{ color: "#888", marginTop: 16 }}>⏳ Processing...</div>
            )}
            {packState === "committed" && (
              <button onClick={handleOpenPack} style={{ ...sty.btn(false), marginTop: 16 }}>
                Open Pack!
              </button>
            )}

            {packResult && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, color: "#ffd700", marginBottom: 10 }}>You got:</div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  {packResult.map((cardId, i) => <Card key={i} cardId={cardId} small />)}
                </div>
                <button onClick={() => setPackResult(null)} style={{ ...sty.btn(false), marginTop: 16 }}>
                  Buy Another
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trade */}
      {screen === "trade" && (
        <div style={sty.section}>
          <h2 style={{ color: "#ffd700", margin: "0 0 16px" }}>Trading Post</h2>

          <div style={{ background: "#111", border: "1px solid #333", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 12 }}>Create Offer</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
              <label>
                Card:
                <select
                  value={tradeForm.cardId}
                  onChange={(e) => setTradeForm({ ...tradeForm, cardId: +e.target.value })}
                  style={{ marginLeft: 6, background: "#222", color: "#ddd", border: "1px solid #444", borderRadius: 4, padding: "4px 8px" }}
                >
                  {CARD_DEFS.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} (own: {collection[c.id]})</option>
                  ))}
                </select>
              </label>
              <label>
                Want:
                <select
                  value={tradeForm.wantsCard ? "card" : "tokens"}
                  onChange={(e) => setTradeForm({ ...tradeForm, wantsCard: e.target.value === "card" })}
                  style={{ marginLeft: 6, background: "#222", color: "#ddd", border: "1px solid #444", borderRadius: 4, padding: "4px 8px" }}
                >
                  <option value="tokens">DOT</option>
                  <option value="card">Card</option>
                </select>
              </label>
              {tradeForm.wantsCard ? (
                <label>
                  Card:
                  <select
                    value={tradeForm.wantedCardId}
                    onChange={(e) => setTradeForm({ ...tradeForm, wantedCardId: +e.target.value })}
                    style={{ marginLeft: 6, background: "#222", color: "#ddd", border: "1px solid #444", borderRadius: 4, padding: "4px 8px" }}
                  >
                    {CARD_DEFS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              ) : (
                <label>
                  Price (DOT units):
                  <input
                    type="number" value={tradeForm.price} min={1}
                    onChange={(e) => setTradeForm({ ...tradeForm, price: +e.target.value })}
                    style={{ marginLeft: 6, width: 70, background: "#222", color: "#ddd", border: "1px solid #444", borderRadius: 4, padding: "4px 8px" }}
                  />
                </label>
              )}
              <button onClick={handleCreateTrade} disabled={tradePending} style={sty.btn(tradePending)}>
                List
              </button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>Active Offers</div>
            <button onClick={loadTrades} style={{ ...sty.btnDanger, borderColor: "#444", color: "#888", fontSize: 12 }}>
              Refresh
            </button>
          </div>
          {trades.length === 0 && <div style={{ color: "#555", fontSize: 13 }}>No active trades.</div>}
          {trades.map((t, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 16, padding: "10px 16px",
              background: "#111", border: "1px solid #222", borderRadius: 8, marginBottom: 8
            }}>
              <Card cardId={t.offeredCardId} small />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Offering: {CARD_DEFS[t.offeredCardId].name}</div>
                <div style={{ fontSize: 12, color: "#888" }}>
                  Wants: {t.wantsCard
                    ? CARD_DEFS[t.wantedCardId].name
                    : `${(Number(t.tokenPrice) / 1e10).toFixed(2)} DOT`}
                </div>
                <div style={{ fontSize: 11, color: "#555" }}>
                  Seller: {t.seller?.toLowerCase() === account?.toLowerCase()
                    ? "You"
                    : `${t.seller?.slice(0, 6)}...${t.seller?.slice(-4)}`}
                </div>
              </div>
              {t.seller?.toLowerCase() === account?.toLowerCase() ? (
                <button onClick={() => handleCancelTrade(t.id)} disabled={tradePending} style={sty.btnDanger}>
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => handleAcceptTrade(t)}
                  disabled={tradePending || (t.wantsCard && collection[t.wantedCardId] < 1)}
                  style={sty.btn(tradePending || (t.wantsCard && collection[t.wantedCardId] < 1))}
                >
                  Accept
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
