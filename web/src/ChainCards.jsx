import { useState, useCallback, useEffect, useRef } from "react";
import { formatUnits } from "viem";

import {
  getCollection,
  claimStarterPack,
  commitPack as contractCommitPack,
  openPack as contractOpenPack,
  watchPackOpened,
  commitDeckAndDeal as contractCommitDeckAndDeal,
  dealHand as contractDealHand,
  playAndDeal as contractPlayAndDeal,
  forfeitGame as contractForfeitGame,
  createTrade as contractCreateTrade,
  cancelTrade as contractCancelTrade,
  acceptTrade as contractAcceptTrade,
  getActiveTrades as contractGetActiveTrades,
  getTradeDetails as contractGetTradeDetails,
  getGame as contractGetGame,
  getStarterClaimed,
  getWalletBalance,
  getPackPending,
  waitForNextBlock,
  parseReceiptLogs,
} from "./hooks/useContract";

// ─── Card type constants ──────────────────────────────────────────────
const CT_ATTACK = 0, CT_BLOCK = 1, CT_HEAL = 2, CT_SMITE = 3, CT_DRAIN = 4;
const EA_ATTACK = 0, EA_SHIELD = 1, EA_BUFF = 2, EA_REGEN = 3;
const MANA_PER_TURN = 3;

// ─── Card & Level Data (mirrors the Solidity contract) ───────────────
const CARD_DEFS = [
  { id: 0,  name: "Quick Strike",    type: CT_ATTACK, value: 6,  cost: 1, color: "#e85d3a" },
  { id: 1,  name: "Fortify",         type: CT_BLOCK,  value: 7,  cost: 2, color: "#8b8b7a" },
  { id: 2,  name: "Power Swing",     type: CT_ATTACK, value: 10, cost: 2, color: "#6b3fa0" },
  { id: 3,  name: "Bulwark",         type: CT_BLOCK,  value: 11, cost: 3, color: "#7a8e9e" },
  { id: 4,  name: "Heavy Blow",      type: CT_ATTACK, value: 12, cost: 2, color: "#d44a1a" },
  { id: 5,  name: "Guard",           type: CT_BLOCK,  value: 5,  cost: 1, color: "#4a9ad4" },
  { id: 6,  name: "Shatter",         type: CT_ATTACK, value: 14, cost: 3, color: "#d4c74a" },
  { id: 7,  name: "Steel Wall",      type: CT_BLOCK,  value: 9,  cost: 2, color: "#5a7a3a" },
  { id: 8,  name: "Bandage",         type: CT_HEAL,   value: 5,  cost: 1, color: "#7acaaa" },
  { id: 9,  name: "Life Tap",        type: CT_DRAIN,  value: 7,  cost: 2, color: "#aa5ad4" },
  { id: 10, name: "Stab",            type: CT_ATTACK, value: 7,  cost: 1, color: "#3a1a5a" },
  { id: 11, name: "Mend",            type: CT_HEAL,   value: 7,  cost: 1, color: "#dac060" },
  { id: 12, name: "Assassinate",     type: CT_SMITE,  value: 10, cost: 2, color: "#2a2a3a" },
  { id: 13, name: "Recover",         type: CT_HEAL,   value: 10, cost: 2, color: "#2a7aba" },
  { id: 14, name: "Soul Rend",       type: CT_DRAIN,  value: 10, cost: 3, color: "#ea6a0a" },
  { id: 15, name: "Unbreakable",     type: CT_BLOCK,  value: 14, cost: 3, color: "#3a6a4a" },
  { id: 16, name: "Battle Cry",      type: CT_ATTACK, value: 11, cost: 2, color: "#5a6a9a" },
  { id: 17, name: "Restoration",     type: CT_HEAL,   value: 13, cost: 3, color: "#ba7aea" },
  { id: 18, name: "Annihilate",      type: CT_ATTACK, value: 18, cost: 3, color: "#1a0a2a" },
  { id: 19, name: "Divine Blessing", type: CT_HEAL,   value: 16, cost: 3, color: "#eaeaca" },
];

const CARD_TYPE_LABEL = [
  (v) => `⚔ ${v} DMG`,
  (v) => `🛡 +${v}`,
  (v) => `💚 +${v} HP`,
  (v) => `🗡 ${v} PIERCE`,
  (v) => `🩸 ${v} dmg +${Math.floor(v/2)} hp`,
];

const LEVELS = [
  { id: 0, name: "Goblin Camp",   emoji: "👺", hp: 40, actions: [
    {type:EA_ATTACK,v:8}, {type:EA_SHIELD,v:7}, {type:EA_ATTACK,v:10}, {type:EA_REGEN,v:6},
  ]},
  { id: 1, name: "Dark Forest",   emoji: "🌲", hp: 60, actions: [
    {type:EA_ATTACK,v:10}, {type:EA_SHIELD,v:9}, {type:EA_BUFF,v:0}, {type:EA_ATTACK,v:14}, {type:EA_REGEN,v:10},
  ]},
  { id: 2, name: "Dragon's Lair", emoji: "🐉", hp: 90, actions: [
    {type:EA_ATTACK,v:13}, {type:EA_SHIELD,v:14}, {type:EA_BUFF,v:0}, {type:EA_ATTACK,v:18}, {type:EA_REGEN,v:15}, {type:EA_ATTACK,v:11},
  ]},
];

const enemyActionLabel = (ea, buffed) => {
  if (ea.type === EA_ATTACK) {
    const dmg = buffed ? ea.v * 2 : ea.v;
    return `⚔ Attacks for ${dmg}${buffed ? " ⚡ POWERED UP!" : ""}`;
  }
  if (ea.type === EA_SHIELD) return `🛡 Shields for ${ea.v}`;
  if (ea.type === EA_BUFF)   return "⚡ Powers up — next attack is doubled!";
  return `💚 Regens ${ea.v} HP`;
};

const DECK_SIZE = 15, HAND_SIZE = 5, PLAYER_MAX_HP = 40;

function parseHandFromReceipt(receipt, account) {
  const logs = parseReceiptLogs(receipt);
  const ev = logs.find(
    (l) => l.eventName === "HandDealt" && l.args?.player?.toLowerCase() === account?.toLowerCase()
  );
  if (!ev) throw new Error("HandDealt event not found in receipt");
  const { h0, h1, h2, h3, h4, handSize } = ev.args;
  const size = Number(handSize);
  return [h0, h1, h2, h3, h4].slice(0, size).map(Number);
}

// ─── Card Component ──────────────────────────────────────────────────
function Card({ cardId, selected, onClick, small, played, count, dimmed }) {
  const c = CARD_DEFS[cardId];
  const w = small ? 90 : 118, h = small ? 132 : 172;
  return (
    <div onClick={onClick} style={{
      width: w, minHeight: h,
      background: `linear-gradient(160deg, ${c.color}ee 0%, ${c.color}99 60%, #0a0604 100%)`,
      border: selected ? "2px solid #c9a84c" : dimmed ? "2px solid #5a2a2a" : "2px solid #6b4c1e",
      borderRadius: 8,
      padding: "8px 7px 7px",
      cursor: onClick ? "pointer" : "default",
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      position: "relative", transition: "transform 0.15s, box-shadow 0.15s",
      transform: selected ? "translateY(-8px) rotate(-1deg)" : played ? "scale(0.88)" : "none",
      opacity: dimmed ? 0.4 : played ? 0.55 : 1,
      boxShadow: selected
        ? "0 8px 24px rgba(201,168,76,0.5), 0 2px 6px rgba(0,0,0,0.6)"
        : "2px 4px 10px rgba(0,0,0,0.7)",
      fontFamily: "'Crimson Pro', Georgia, serif",
    }}>
      {/* mana cost badge */}
      <div style={{
        position: "absolute", top: -8, left: -8,
        background: c.cost === 1 ? "#2a4a8a" : c.cost === 2 ? "#1a3a6a" : "#0a1a4a",
        border: "1px solid #4a7adf",
        color: "#9ab8ff", borderRadius: "50%",
        width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 700,
        fontFamily: "monospace",
      }}>{c.cost}</div>
      {count > 1 && (
        <div style={{
          position: "absolute", top: -8, right: -8,
          background: "linear-gradient(135deg, #c9a84c, #8b6914)",
          color: "#1a0e04", borderRadius: "50%",
          width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 11, fontWeight: 700, boxShadow: "0 1px 4px rgba(0,0,0,0.5)",
          fontFamily: "'Cinzel', serif",
        }}>{count}</div>
      )}
      <div style={{
        fontSize: small ? 9.5 : 11, fontWeight: 600, color: "#e8d5b7",
        lineHeight: 1.2, letterSpacing: 0.3, textShadow: "0 1px 3px rgba(0,0,0,0.8)",
        fontFamily: "'Cinzel', serif",
      }}>{c.name}</div>
      <div style={{
        fontSize: small ? 30 : 38, textAlign: "center", margin: "2px 0",
        filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.7))",
      }}>
        {[
          "⚡",   //  0 Quick Strike
          "🏰",  //  1 Fortify
          "🪓",  //  2 Power Swing
          "🛡️", //  3 Bulwark
          "🔨",  //  4 Heavy Blow
          "🔰",  //  5 Guard
          "💥",  //  6 Shatter
          "🧱",  //  7 Steel Wall
          "🩹",  //  8 Bandage
          "🩸",  //  9 Life Tap
          "🗡️", // 10 Stab
          "🌿",  // 11 Mend
          "🌑",  // 12 Assassinate
          "🍃",  // 13 Recover
          "🌀",  // 14 Soul Rend
          "⛰️", // 15 Unbreakable
          "⚔️", // 16 Battle Cry
          "✨",  // 17 Restoration
          "💀",  // 18 Annihilate
          "☀️", // 19 Divine Blessing
        ][cardId]}
      </div>
      <div style={{
        fontSize: small ? 10 : 12, fontWeight: 600, textAlign: "center",
        background: "rgba(0,0,0,0.45)", borderRadius: 4, padding: "2px 4px",
        color: [
          "#ff8a6b",  // attack
          "#8ab8ff",  // block
          "#6aff8a",  // heal
          "#ff6aff",  // smite
          "#ffaa6a",  // drain
        ][c.type],
      }}>
        {CARD_TYPE_LABEL[c.type](c.value)}
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

  useEffect(() => {
    window.ethereum?.request({ method: "eth_requestAccounts" })
      .then(([addr]) => setAccount(addr));
  }, []);

  useEffect(() => {
    if (!account) return;
    getCollection(account).then((counts) => setCollection(counts.map(Number)));
    getStarterClaimed(account).then(setStarterClaimed);
    getWalletBalance(account).then((bal) =>
      setWalletBalance(parseFloat(formatUnits(bal, 16)).toFixed(2))
    );
    getPackPending(account).then((pending) => {
      if (pending) setPackState("committed");
    });
  }, [account]);

  useEffect(() => {
    if (!account) return;
    contractGetGame(account)
      .then((result) => {
        const [levelId, phase, playerHp, enemyHp, turn, deckSize, hand, handSize, enemyBlock, enemyBuffed] = result;
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
          enemyBlock: Number(enemyBlock), enemyBuffed: Boolean(enemyBuffed),
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

  useEffect(() => {
    if (!account) return;
    const unwatch = watchPackOpened((player) => {
      if (player.toLowerCase() === account.toLowerCase()) {
        getCollection(account).then((c) => setCollection(c.map(Number)));
        getWalletBalance(account).then((bal) =>
          setWalletBalance(parseFloat(formatUnits(bal, 16)).toFixed(2))
        );
      }
    });
    return unwatch;
  }, [account]);

  const refreshBalance = useCallback(() => {
    if (!account) return;
    getWalletBalance(account)
      .then((bal) => setWalletBalance(parseFloat(formatUnits(bal, 16)).toFixed(2)))
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

  useEffect(() => {
    if (!account) return;
    try { setDeck(JSON.parse(localStorage.getItem(`deck:${account}`) ?? "[]")); } catch { setDeck([]); }
  }, [account]);

  const [battle, setBattle] = useState(null);
  const [packState, setPackState] = useState("idle");
  const [packResult, setPackResult] = useState(null);
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
      await waitForNextBlock();
      setPackState("committed");
      refreshBalance();
      addLog("📦 Pack committed — ready to open!");
    } catch (e) {
      if (e.message?.includes("Pack already committed")) {
        setPackState("committed");
        addLog("📦 Pack already committed — click Open Pack to reveal!");
      } else {
        setPackState("idle");
        addLog(`❌ Pack commit failed: ${e.message}`);
      }
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
      enemyBlock: 0, enemyBuffed: false,
      selectedCards: [], phase: "committing",
      battleLog: [`⚔️ Starting vs ${lvl.name} — committing deck...`],
    });
    setScreen("battle");
    try {
      const receipt = await contractCommitDeckAndDeal(selectedLevel, deck);
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
      if (prev.selectedCards.includes(idx)) {
        return { ...prev, selectedCards: prev.selectedCards.filter((i) => i !== idx) };
      }
      const usedMana = prev.selectedCards.reduce((s, i) => s + CARD_DEFS[prev.hand[i]].cost, 0);
      const cardCost = CARD_DEFS[prev.hand[idx]].cost;
      if (usedMana + cardCost > MANA_PER_TURN) return prev;
      return { ...prev, selectedCards: [...prev.selectedCards, idx] };
    });
  };

  const playTurn = async () => {
    if (!battle || battle.selectedCards.length === 0) return;
    const indices = [...battle.selectedCards];
    setBattle((prev) => ({ ...prev, phase: "resolving", selectedCards: [] }));
    try {
      const receipt = await contractPlayAndDeal(indices);
      const logs = parseReceiptLogs(receipt);
      const turnEv = logs.find((l) => l.eventName === "TurnResolved");
      const endEv  = logs.find((l) => l.eventName === "GameEnded");
      const lvl = LEVELS[battle.level];
      const bLog = [...battle.battleLog];

      if (turnEv) {
        const { dmgDealt, healAmount, blockGained, enemyActionType, enemyActionValue, dmgTaken, playerHp, enemyHp, newEnemyBlock, turn: resolvedTurn, newEnemyBuffed } = turnEv.args;
        const nDmg   = Number(dmgDealt);
        const nHeal  = Number(healAmount);
        const nBlock = Number(blockGained);
        const eaType = Number(enemyActionType);
        const eaVal  = Number(enemyActionValue);
        const nTaken = Number(dmgTaken);
        const nPHp   = Number(playerHp);
        const nEHp   = Number(enemyHp);
        const nEBlock = Number(newEnemyBlock);
        const nextTurn = Number(resolvedTurn) + 1;
        const nextEnemyBuffed = Boolean(newEnemyBuffed);

        const parts = [];
        if (nDmg  > 0) parts.push(`⚔ ${nDmg} dmg to enemy`);
        if (nBlock > 0) parts.push(`🛡 +${nBlock} block`);
        if (nHeal  > 0) parts.push(`💚 +${nHeal} HP`);
        bLog.push(`You: ${parts.join(", ")} → Enemy HP ${nEHp}/${lvl.hp}`);

        if (!endEv) {
          if (eaType === EA_ATTACK) {
            bLog.push(`Enemy: ⚔ attacks → you take ${nTaken} dmg${nTaken === 0 ? " (blocked!)" : ""} → HP ${nPHp}/${PLAYER_MAX_HP}`);
          } else if (eaType === EA_SHIELD) {
            bLog.push(`Enemy: 🛡 shields for ${eaVal}`);
          } else if (eaType === EA_REGEN) {
            bLog.push(`Enemy: 💚 regens ${eaVal} HP → Enemy HP ${nEHp}/${lvl.hp}`);
          } else {
            bLog.push(`Enemy: ⚡ powers up — next attack is doubled!`);
          }
        }

        if (endEv) {
          const won = endEv.args.won;
          bLog.push(won ? "🏆 VICTORY!" : "💀 DEFEAT.");
          setBattle((prev) => ({
            ...prev, phase: won ? "won" : "lost",
            playerHp: nPHp, enemyHp: nEHp,
            enemyBlock: 0, enemyBuffed: false, battleLog: bLog,
          }));
          addLog(won ? `🏆 Won at ${lvl.name}!` : `💀 Lost at ${lvl.name}`);
          getCollection(account).then((c) => setCollection(c.map(Number)));
        } else {
          // Hand was dealt in the same tx — parse it from the same receipt
          const hand = parseHandFromReceipt(receipt, account);
          bLog.push(`--- Turn ${nextTurn + 1} ---`);
          setBattle((prev) => ({
            ...prev, phase: "play",
            playerHp: nPHp, enemyHp: nEHp,
            enemyBlock: nEBlock, enemyBuffed: nextEnemyBuffed,
            turn: nextTurn,
            hand, handSize: hand.length,
            deckSize: prev.deckSize + prev.handSize - hand.length,
            selectedCards: [], battleLog: bLog,
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

  const G = {
    gold:      "#c9a84c",
    goldDim:   "#8b6914",
    goldDeep:  "#5a3a08",
    parchment: "#e8d5b7",
    parchDim:  "#a09070",
    woodDark:  "#1c0e04",
    woodMid:   "#2e1a08",
    woodLight: "#4a2e14",
    felt:      "#0d1f0d",
    feltLight: "#162a16",
    red:       "#c0392b",
    redDim:    "#7a2a2a",
  };

  const sty = {
    page: { minHeight: "100vh", color: G.parchment, fontFamily: "'Crimson Pro', Georgia, serif" },
    header: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 28px",
      borderBottom: `2px solid ${G.goldDim}`,
      background: `linear-gradient(180deg, #0d0602 0%, ${G.woodDark} 100%)`,
      boxShadow: "0 4px 16px rgba(0,0,0,0.7)",
    },
    title: {
      fontSize: 24, fontWeight: 700, letterSpacing: 4,
      color: G.gold, textTransform: "uppercase",
      fontFamily: "'Cinzel Decorative', 'Cinzel', serif",
      textShadow: `0 0 20px ${G.goldDim}88`,
    },
    stats: { display: "flex", gap: 24, fontSize: 15, color: G.parchDim, fontStyle: "italic" },
    nav: {
      display: "flex", gap: 6, padding: "10px 24px", flexWrap: "wrap",
      borderBottom: `1px solid ${G.woodLight}`,
      background: `linear-gradient(180deg, ${G.woodDark} 0%, ${G.woodMid} 100%)`,
    },
    navBtn: (active) => ({
      padding: "7px 18px", borderRadius: 3,
      border: active ? `1px solid ${G.gold}` : `1px solid ${G.woodLight}`,
      background: active
        ? `linear-gradient(180deg, ${G.goldDeep} 0%, #3a1a04 100%)`
        : "transparent",
      color: active ? G.gold : G.parchDim,
      cursor: "pointer", fontSize: 12, fontWeight: 600,
      letterSpacing: 1, textTransform: "uppercase",
      fontFamily: "'Cinzel', serif",
      transition: "all 0.15s",
    }),
    section: { padding: "20px 28px" },
    panel: {
      background: `radial-gradient(ellipse at 50% 0%, ${G.feltLight} 0%, ${G.felt} 60%, #080e08 100%)`,
      border: `3px solid ${G.woodLight}`,
      borderRadius: 10, padding: "20px", margin: "4px 0 16px",
      boxShadow: `inset 0 2px 12px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.5)`,
    },
    grid: { display: "flex", flexWrap: "wrap", gap: 12 },
    btn: (disabled) => ({
      padding: "9px 26px", borderRadius: 4,
      border: disabled ? `1px solid ${G.woodLight}` : `1px solid ${G.gold}`,
      fontWeight: 700, fontSize: 13,
      cursor: disabled ? "not-allowed" : "pointer",
      background: disabled
        ? G.woodMid
        : `linear-gradient(180deg, #7a5a1e 0%, ${G.goldDeep} 50%, #6a4a18 100%)`,
      color: disabled ? G.woodLight : G.gold,
      opacity: disabled ? 0.55 : 1,
      letterSpacing: 1, textTransform: "uppercase",
      fontFamily: "'Cinzel', serif",
      boxShadow: disabled ? "none" : `0 2px 6px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,100,0.15)`,
      transition: "all 0.15s",
    }),
    btnDanger: {
      padding: "7px 18px", borderRadius: 4,
      border: `1px solid ${G.red}`,
      background: "transparent", color: G.red,
      cursor: "pointer", fontSize: 12,
      letterSpacing: 1, textTransform: "uppercase",
      fontFamily: "'Cinzel', serif",
    },
    log: {
      maxHeight: 160, overflowY: "auto",
      background: "rgba(0,0,0,0.5)",
      border: `1px solid ${G.woodLight}`,
      borderRadius: 4, padding: "10px 12px",
      fontSize: 14, color: G.parchDim, lineHeight: 1.7,
      fontFamily: "'Crimson Pro', serif",
    },
    pending: {
      color: G.parchDim, fontSize: 16, padding: "28px 0",
      textAlign: "center", fontStyle: "italic",
      fontFamily: "'Crimson Pro', serif",
    },
    h2: { color: G.gold, margin: "0 0 14px", fontFamily: "'Cinzel', serif", letterSpacing: 2, fontSize: 18 },
    label: { color: G.parchDim, fontSize: 13 },
    input: {
      marginLeft: 6, background: `${G.woodDark}cc`, color: G.parchment,
      border: `1px solid ${G.woodLight}`, borderRadius: 3, padding: "4px 8px",
      fontFamily: "'Crimson Pro', serif", fontSize: 14,
    },
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
          background: `linear-gradient(90deg, ${G.woodDark}, #3a1a00, ${G.woodDark})`,
          borderBottom: `1px solid ${G.goldDim}`, padding: "8px 28px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ color: G.gold, fontSize: 14, fontStyle: "italic", fontFamily: "'Crimson Pro', serif" }}>
            ⚔️ Battle in progress — {LEVELS[battle.level].name} · Turn {battle.turn + 1} · HP {battle.playerHp}/{PLAYER_MAX_HP}
          </span>
          <button onClick={() => setScreen("battle")} style={{
            padding: "4px 14px", borderRadius: 3,
            border: `1px solid ${G.goldDim}`, background: G.goldDeep,
            color: G.gold, cursor: "pointer", fontSize: 11,
            letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Cinzel', serif",
          }}>
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
          <button onClick={() => setScreen("battle")} style={{
            ...sty.navBtn(screen === "battle"),
            borderColor: G.goldDim, color: screen === "battle" ? G.gold : "#c97a30",
          }}>
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
          <h2 style={sty.h2}>Welcome to Chain Cards</h2>
          <p style={{ color: G.parchDim, lineHeight: 1.8, maxWidth: 640, fontSize: 16 }}>
            Collect 20 unique action cards, build a deck, and battle AI enemies across 3 levels.
            Each card is an action — attack for damage, raise a shield, heal yourself, pierce enemy
            defences, or drain life. Enemies telegraph their moves, block incoming strikes, and
            power up for devastating blows. Card ownership and deck shuffling are on-chain.
          </p>
          {!starterClaimed && (
            <p style={{ color: G.gold, marginTop: 16, fontStyle: "italic", fontSize: 15 }}>
              👆 Claim your starter pack to begin your adventure!
            </p>
          )}
          <div style={{ marginTop: 20 }}>
            <div style={{ color: G.parchDim, fontSize: 12, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Cinzel', serif", marginBottom: 8 }}>Activity Log</div>
            <div ref={logRef} style={sty.log}>
              {log.length === 0 && <div style={{ color: G.woodLight, fontStyle: "italic" }}>No activity yet...</div>}
              {log.map((l, i) => <div key={i}>{l.msg}</div>)}
            </div>
          </div>
          <div style={{ marginTop: 20, color: G.parchDim, fontSize: 13, lineHeight: 1.8, maxWidth: 540 }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 12, letterSpacing: 1, color: G.gold, marginBottom: 6 }}>CARD TYPES</div>
            <div>⚔ <b style={{color:"#ff8a6b"}}>Attack</b> — deal damage, reduced by enemy shield</div>
            <div>🛡 <b style={{color:"#8ab8ff"}}>Block</b> — raise a shield to absorb enemy attacks this turn</div>
            <div>💚 <b style={{color:"#6aff8a"}}>Heal</b> — restore HP</div>
            <div>🗡 <b style={{color:"#ff6aff"}}>Smite</b> — deal damage that ignores enemy shield</div>
            <div>🩸 <b style={{color:"#ffaa6a"}}>Drain</b> — deal damage + steal half as healing</div>
          </div>
        </div>
      )}

      {/* Collection */}
      {screen === "collection" && (
        <div style={sty.section}>
          <h2 style={sty.h2}>Your Collection</h2>
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
          <h2 style={sty.h2}>Choose Your Battle</h2>
          <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
            {LEVELS.map((l) => (
              <div key={l.id} onClick={() => setSelectedLevel(l.id)} style={{
                padding: "14px 20px", borderRadius: 6, cursor: "pointer", flex: 1, maxWidth: 220,
                border: selectedLevel === l.id ? `2px solid ${G.gold}` : `2px solid ${G.woodLight}`,
                background: selectedLevel === l.id
                  ? `linear-gradient(160deg, ${G.goldDeep}, #2a1204)`
                  : `linear-gradient(160deg, ${G.woodMid}, ${G.woodDark})`,
                transition: "all 0.2s",
                boxShadow: selectedLevel === l.id ? `0 0 12px ${G.goldDim}66` : "none",
              }}>
                <div style={{ fontSize: 28 }}>{l.emoji}</div>
                <div style={{ fontWeight: 700, margin: "4px 0", fontFamily: "'Cinzel', serif", fontSize: 13, color: G.parchment }}>{l.name}</div>
                <div style={{ fontSize: 13, color: G.parchDim, fontStyle: "italic" }}>HP: {l.hp}</div>
                <div style={{ fontSize: 11, color: G.woodLight, marginTop: 4, lineHeight: 1.6 }}>
                  {l.actions.map((a, i) => {
                    const lbl = a.type === EA_ATTACK ? `⚔${a.v}` : a.type === EA_SHIELD ? `🛡${a.v}` : a.type === EA_REGEN ? `💚${a.v}` : "⚡BUFF";
                    return <span key={i}>{i>0?" · ":""}{lbl}</span>;
                  })}
                </div>
              </div>
            ))}
          </div>

          <h2 style={{ ...sty.h2, marginTop: 8 }}>Build Deck ({deck.length}/{DECK_SIZE})</h2>
          <p style={{ fontSize: 14, color: G.parchDim, fontStyle: "italic", margin: "0 0 14px" }}>
            Click cards to add or remove. Exactly 15 required.
          </p>

          <div style={sty.grid}>
            {CARD_DEFS.map((c) => {
              if (collection[c.id] === 0 && !deck.includes(c.id)) return null;
              const inDeck = deck.filter((d) => d === c.id).length;
              const invalid = deckInvalid.includes(c.id);
              return (
                <div key={c.id} style={{ position: "relative" }}>
                  {invalid && (
                    <div style={{ position: "absolute", top: -10, left: 0, right: 0, textAlign: "center", fontSize: 10, color: G.red, zIndex: 1, fontFamily: "'Cinzel', serif" }}>
                      ⚠ traded
                    </div>
                  )}
                  <Card cardId={c.id} small onClick={() => toggleDeckCard(c.id)}
                    selected={inDeck > 0} count={collection[c.id]} dimmed={invalid} />
                  {inDeck > 0 && (
                    <div style={{
                      position: "absolute", bottom: -7, left: "50%", transform: "translateX(-50%)",
                      background: `linear-gradient(135deg, ${G.gold}, ${G.goldDim})`,
                      color: G.woodDark, borderRadius: 8, padding: "1px 8px",
                      fontSize: 11, fontWeight: 700, fontFamily: "'Cinzel', serif",
                    }}>×{inDeck}</div>
                  )}
                </div>
              );
            })}
          </div>

          {deck.length > 0 && (
            <div style={{ marginTop: 16, padding: "10px 14px", background: "rgba(0,0,0,0.3)", borderRadius: 4, border: `1px solid ${G.woodLight}` }}>
              <div style={{ fontSize: 13, color: G.parchDim, marginBottom: 4, fontStyle: "italic" }}>
                {deck.map((d) => CARD_DEFS[d].name).join(", ")}
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: G.parchDim }}>
                <span>⚔ {deck.filter(d=>CARD_DEFS[d].type===CT_ATTACK||CARD_DEFS[d].type===CT_DRAIN||CARD_DEFS[d].type===CT_SMITE).length} dmg</span>
                <span>🛡 {deck.filter(d=>CARD_DEFS[d].type===CT_BLOCK).length} block</span>
                <span>💚 {deck.filter(d=>CARD_DEFS[d].type===CT_HEAL||CARD_DEFS[d].type===CT_DRAIN).length} heal</span>
                <span>◆ avg {(deck.reduce((s,d)=>s+CARD_DEFS[d].cost,0)/deck.length).toFixed(1)} mana</span>
              </div>
            </div>
          )}

          {deckInvalid.length > 0 && (
            <div style={{ color: G.red, fontSize: 13, margin: "10px 0", fontStyle: "italic" }}>
              ⚠️ No longer owned: {deckInvalid.map(id => CARD_DEFS[id].name).join(", ")}
            </div>
          )}
          <button
            onClick={startGame}
            disabled={deck.length !== DECK_SIZE || selectedLevel === null || deckInvalid.length > 0}
            style={{ ...sty.btn(deck.length !== DECK_SIZE || selectedLevel === null || deckInvalid.length > 0), marginTop: 14 }}
          >
            Enter Battle
          </button>
        </div>
      )}

      {/* Battle Screen */}
      {screen === "battle" && battle && (
        <div style={sty.section}>
          {/* HP bars */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            {/* Player side */}
            <div>
              <div style={{ fontSize: 12, color: G.parchDim, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Cinzel', serif" }}>You</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Cinzel', serif", color: G.parchment }}>
                  {battle.playerHp} <span style={{ fontSize: 13, color: G.parchDim }}>/ {PLAYER_MAX_HP}</span>
                </div>
                <div style={{ width: 140, height: 8, background: "rgba(0,0,0,0.5)", borderRadius: 4, overflow: "hidden", border: `1px solid ${G.woodLight}` }}>
                  <div style={{
                    width: `${(battle.playerHp / PLAYER_MAX_HP) * 100}%`, height: "100%",
                    background: battle.playerHp > 20 ? "#4a8a3a" : battle.playerHp > 10 ? "#c9a030" : G.red,
                    transition: "width 0.4s",
                  }} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: G.parchDim, marginTop: 3, fontStyle: "italic" }}>
                {battle.deckSize} cards remaining · Turn {battle.turn + 1}
              </div>
            </div>

            {/* Enemy side */}
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 13, color: G.parchDim, fontFamily: "'Cinzel', serif" }}>
                {LEVELS[battle.level].emoji} {LEVELS[battle.level].name}
                {battle.enemyBlock > 0 && (
                  <span style={{ marginLeft: 8, color: "#8ab8ff", fontSize: 12 }}>🛡 {battle.enemyBlock}</span>
                )}
                {battle.enemyBuffed && (
                  <span style={{ marginLeft: 8, color: "#ffdd44", fontSize: 12 }}>⚡ POWERED</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
                <div style={{ width: 140, height: 8, background: "rgba(0,0,0,0.5)", borderRadius: 4, overflow: "hidden", border: `1px solid ${G.woodLight}` }}>
                  <div style={{
                    width: `${(battle.enemyHp / LEVELS[battle.level].hp) * 100}%`, height: "100%",
                    background: G.red, transition: "width 0.4s",
                  }} />
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Cinzel', serif", color: G.parchment }}>
                  {battle.enemyHp} <span style={{ fontSize: 13, color: G.parchDim }}>/ {LEVELS[battle.level].hp}</span>
                </div>
              </div>
              {battle.phase === "play" && (() => {
                const lvl = LEVELS[battle.level];
                const ea = lvl.actions[battle.turn % lvl.actions.length];
                return (
                  <div style={{ fontSize: 12, marginTop: 3, color: ea.type === EA_BUFF ? "#ffdd44" : ea.type === EA_SHIELD ? "#8ab8ff" : "#c07060", fontStyle: "italic" }}>
                    {enemyActionLabel(ea, battle.enemyBuffed)}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Pending tx states */}
          {PENDING_PHASES.includes(battle.phase) && (
            <div style={sty.pending}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>⏳</div>
              {PENDING_LABELS[battle.phase]}
            </div>
          )}

          {/* Play phase */}
          {battle.phase === "play" && (() => {
            const usedMana = battle.selectedCards.reduce((s, i) => s + CARD_DEFS[battle.hand[i]].cost, 0);
            return (<>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: G.parchDim, fontStyle: "italic" }}>
                  Mana:
                </span>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 18, height: 18, borderRadius: "50%",
                    background: i < usedMana ? "#4a7adf" : "rgba(0,0,0,0.5)",
                    border: `2px solid ${i < usedMana ? "#8ab8ff" : "#2a3a5a"}`,
                    transition: "background 0.15s",
                  }} />
                ))}
                <span style={{ fontSize: 12, color: "#9ab8ff" }}>{usedMana}/{MANA_PER_TURN}</span>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
                {battle.hand.slice(0, battle.handSize).map((cardId, idx) => (
                  <Card key={idx} cardId={cardId} small
                    selected={battle.selectedCards.includes(idx)}
                    onClick={() => toggleBattleCard(idx)} />
                ))}
              </div>
              {battle.selectedCards.length > 0 && (() => {
                const selCards = battle.selectedCards.map(i => CARD_DEFS[battle.hand[i]]);
                const totalDmg = selCards.filter(c=>c.type===CT_ATTACK||c.type===CT_DRAIN||c.type===CT_SMITE).reduce((s,c)=>s+c.value,0);
                const totalBlock = selCards.filter(c=>c.type===CT_BLOCK).reduce((s,c)=>s+c.value,0);
                const totalHeal = selCards.filter(c=>c.type===CT_HEAL).reduce((s,c)=>s+c.value,0) + selCards.filter(c=>c.type===CT_DRAIN).reduce((s,c)=>s+Math.floor(c.value/2),0);
                const parts = [];
                if (totalDmg > 0)  parts.push(`⚔ ${totalDmg} dmg`);
                if (totalBlock > 0) parts.push(`🛡 +${totalBlock} block`);
                if (totalHeal > 0)  parts.push(`💚 +${totalHeal} heal`);
                return (
                  <div style={{ fontSize: 14, color: G.parchDim, marginBottom: 10, fontStyle: "italic" }}>
                    This turn: {parts.join(" · ")}
                  </div>
                );
              })()}
              <button onClick={playTurn} disabled={battle.selectedCards.length === 0} style={sty.btn(battle.selectedCards.length === 0)}>
                Play Cards
              </button>
            </>);
          })()}

          {/* End states */}
          {(battle.phase === "won" || battle.phase === "lost") && (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div style={{ fontSize: 52 }}>{battle.phase === "won" ? "🏆" : "💀"}</div>
              <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Cinzel Decorative', serif", letterSpacing: 3, marginTop: 10,
                color: battle.phase === "won" ? G.gold : G.red,
                textShadow: battle.phase === "won" ? `0 0 20px ${G.goldDim}` : "none",
              }}>
                {battle.phase === "won" ? "Victory" : "Defeat"}
              </div>
              <button onClick={() => { setBattle(null); setScreen("deckbuild"); }} style={{ ...sty.btn(false), marginTop: 20 }}>
                Play Again
              </button>
            </div>
          )}

          {/* Battle log */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: G.woodLight, marginBottom: 4, letterSpacing: 1, textTransform: "uppercase", fontFamily: "'Cinzel', serif" }}>Battle Log</div>
            <div style={{ ...sty.log, maxHeight: 140 }}>
              {battle.battleLog.map((l, i) => (
                <div key={i} style={{
                  color: l.startsWith("🏆") ? G.gold : l.startsWith("💀") ? G.red :
                    l.startsWith("---") ? G.woodLight : G.parchDim
                }}>{l}</div>
              ))}
            </div>
          </div>

          {battle.phase === "play" && (
            <button onClick={handleForfeit} style={{ ...sty.btnDanger, marginTop: 12 }}>Forfeit</button>
          )}
        </div>
      )}

      {/* Shop */}
      {screen === "shop" && (
        <div style={sty.section}>
          <h2 style={sty.h2}>Merchant's Stall</h2>
          <div style={{ ...sty.panel, maxWidth: 380, textAlign: "center" }}>
            <div style={{ fontSize: 52 }}>📦</div>
            <div style={{ fontSize: 17, fontWeight: 700, margin: "8px 0", fontFamily: "'Cinzel', serif", color: G.parchment, letterSpacing: 1 }}>
              Booster Pack
            </div>
            <div style={{ color: G.parchDim, fontSize: 14, fontStyle: "italic" }}>3 random cards · 1 DOT</div>

            {packState === "idle" && !packResult && (
              <button onClick={handleCommitPack} style={{ ...sty.btn(false), marginTop: 18 }}>
                Purchase Pack
              </button>
            )}
            {(packState === "committing" || packState === "opening") && (
              <div style={{ color: G.parchDim, marginTop: 16, fontStyle: "italic" }}>⏳ Processing…</div>
            )}
            {packState === "committed" && (
              <button onClick={handleOpenPack} style={{ ...sty.btn(false), marginTop: 16 }}>
                Open Pack
              </button>
            )}

            {packResult && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 14, color: G.gold, marginBottom: 12, fontFamily: "'Cinzel', serif", letterSpacing: 1 }}>You received:</div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  {packResult.map((cardId, i) => <Card key={i} cardId={cardId} small />)}
                </div>
                <button onClick={() => setPackResult(null)} style={{ ...sty.btn(false), marginTop: 18 }}>
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
          <h2 style={sty.h2}>Trading Post</h2>

          <div style={{ ...sty.panel, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 14, fontFamily: "'Cinzel', serif", fontSize: 13, letterSpacing: 1, color: G.gold }}>
              Post an Offer
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 14 }}>
              <label style={{ color: G.parchDim }}>
                Offer:
                <select value={tradeForm.cardId} onChange={(e) => setTradeForm({ ...tradeForm, cardId: +e.target.value })} style={sty.input}>
                  {CARD_DEFS.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} (×{collection[c.id]})</option>
                  ))}
                </select>
              </label>
              <label style={{ color: G.parchDim }}>
                In exchange for:
                <select value={tradeForm.wantsCard ? "card" : "tokens"} onChange={(e) => setTradeForm({ ...tradeForm, wantsCard: e.target.value === "card" })} style={sty.input}>
                  <option value="tokens">DOT tokens</option>
                  <option value="card">A specific card</option>
                </select>
              </label>
              {tradeForm.wantsCard ? (
                <label style={{ color: G.parchDim }}>
                  Which card:
                  <select value={tradeForm.wantedCardId} onChange={(e) => setTradeForm({ ...tradeForm, wantedCardId: +e.target.value })} style={sty.input}>
                    {CARD_DEFS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              ) : (
                <label style={{ color: G.parchDim }}>
                  Price (DOT):
                  <input type="number" value={tradeForm.price} min={1}
                    onChange={(e) => setTradeForm({ ...tradeForm, price: +e.target.value })}
                    style={{ ...sty.input, width: 70 }}
                  />
                </label>
              )}
              <button onClick={handleCreateTrade} disabled={tradePending} style={sty.btn(tradePending)}>
                Post
              </button>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: 13, letterSpacing: 1, color: G.gold }}>Active Offers</div>
            <button onClick={loadTrades} style={{ ...sty.btnDanger, borderColor: G.woodLight, color: G.parchDim, fontSize: 11 }}>
              Refresh
            </button>
          </div>
          {trades.length === 0 && <div style={{ color: G.parchDim, fontSize: 14, fontStyle: "italic" }}>The board is empty. Be the first to post an offer.</div>}
          {trades.map((t, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "10px 14px",
              background: `linear-gradient(90deg, ${G.woodMid}, ${G.woodDark})`,
              border: `1px solid ${G.woodLight}`, borderRadius: 6, marginBottom: 8,
            }}>
              <Card cardId={t.offeredCardId} small />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontFamily: "'Cinzel', serif", fontSize: 12, color: G.parchment }}>{CARD_DEFS[t.offeredCardId].name}</div>
                <div style={{ fontSize: 13, color: G.parchDim, fontStyle: "italic", marginTop: 2 }}>
                  for {t.wantsCard ? CARD_DEFS[t.wantedCardId].name : `${(Number(t.tokenPrice) / 1e10).toFixed(2)} DOT`}
                </div>
                <div style={{ fontSize: 11, color: G.woodLight, marginTop: 2 }}>
                  {t.seller?.toLowerCase() === account?.toLowerCase() ? "Your listing" : `${t.seller?.slice(0, 6)}…${t.seller?.slice(-4)}`}
                </div>
              </div>
              {t.seller?.toLowerCase() === account?.toLowerCase() ? (
                <button onClick={() => handleCancelTrade(t.id)} disabled={tradePending} style={sty.btnDanger}>
                  Withdraw
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
