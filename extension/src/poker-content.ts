/**
 * Poker content script — injects into the Holland Casino Playtech poker page.
 *
 * Responsibilities:
 * 1. Scrape full game state from DOM
 * 2. Detect when it's hero's turn
 * 3. Send state to background for Claude decision
 * 4. Execute action by clicking DOM buttons
 *
 * Message protocol (poker-content ↔ background):
 *   REGISTER_POKER_TAB    poker-content → bg   Tab registers as the poker tab (sent after .table-area found)
 *   UNREGISTER_POKER_TAB  poker-content → bg   Tab unregisters on unload
 *   AUTOPILOT_DECIDE      poker-content → bg   Request decision (messages array)
 *   AUTOPILOT_ACTION      bg → poker-content   Decision result (action object)
 *   AUTOPILOT_MODE        bg → poker-content   Apply mode change ("off"|"monitor"|"play")
 */

import { applyRuleTree } from "../../lib/poker/rule-tree";
import { clearEvalCache } from "../../lib/poker/hand-evaluator";
import { clearBoardCache } from "../../lib/poker/board-analyzer";
import { parseCurrency } from "../../lib/poker/equity/pot-odds";
import type { LocalDecision } from "../../lib/poker/types";
import type { PlayerExploitType } from "../../lib/poker/exploit";

console.log("[Poker] Content script loaded on", window.location.href);

// ── Types ──────────────────────────────────────────────────────────────

interface GameState {
  handId: string;
  heroCards: string[];
  communityCards: string[];
  pot: string;
  players: PlayerState[];
  heroSeat: number;
  dealerSeat: number;
  availableActions: ActionOption[];
  isHeroTurn: boolean;
  timerSeconds: number | null;
}

interface PlayerState {
  seat: number;
  name: string;
  stack: string;
  bet: string;
  folded: boolean;
  hasCards: boolean;
}

interface ActionOption {
  type: "FOLD" | "CHECK" | "CALL" | "RAISE" | "BET" | "ALL_IN";
  label: string;
  amount: string | null;
}

// Mirror of autopilotActionSchema in lib/ai/autopilot-schema.ts — keep in sync
interface AutopilotAction {
  action: "FOLD" | "CHECK" | "CALL" | "RAISE" | "BET";
  amount: number | null;
  reasoning: string;
}

// ── Constants ──────────────────────────────────────────────────────────

const SUIT_MAP: Record<string, string> = {
  "♠": "s",
  "♥": "h",
  "♦": "d",
  "♣": "c",
};

// ── State ──────────────────────────────────────────────────────────────

interface PersonaRec {
  name: string;
  action: string;
  temperature: string;
  rotated: boolean;
  allPersonas: Array<{ name: string; action: string; selected: boolean }>;
}

interface ClaudeAdvice {
  action: string;
  amount: string | null;
  street: string | null;
  boardTexture: string | null;
  spr: string | null;
}

let autopilotMode: "off" | "monitor" | "play" = "off";
let lastPersonaRec: PersonaRec | null = null;
let lastTableTemperature: { dominantType: TableTemperatureLocal; handsObserved: number } | null = null;
let personaRequesting = false; // mutex — prevents concurrent requestPersona() calls
let cachedDealerSeat: number | null = null; // dealer seat changes once per hand, cache to avoid per-tick queries

// ── Local Engine Config ─────────────────────────────────────────────────

let CONFIDENCE_THRESHOLD = 0.60;
// Allow runtime tuning via chrome.storage.local without reloading the extension
chrome.storage.local.get("localEngineThreshold", (v) => {
  if (typeof v["localEngineThreshold"] === "number") {
    CONFIDENCE_THRESHOLD = v["localEngineThreshold"];
    console.log("[Poker] Local engine threshold loaded:", CONFIDENCE_THRESHOLD);
  }
});
let lastClaudeAdvice: ClaudeAdvice | null = null;
let monitorAdvice: AutopilotAction | null = null;
let executing = false;
let currentHandId: string | null = null;
let handMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
let lastState: GameState | null = null;
let lastHeroTurn = false;
let streetActions: string[] = []; // accumulates opponent actions between hero turns (todo 044)
let decisionWatchdog: ReturnType<typeof setTimeout> | null = null; // timeout guard (todo 031)
let watchdogToken: { cancelled: boolean } | null = null;           // cancellation token (todo 059)

// ── Registration ───────────────────────────────────────────────────────

// Startup debug — no bodyHTML (removed session token leak, todo 034)
chrome.runtime.sendMessage({
  type: "AUTOPILOT_DEBUG",
  data: {
    type: "script_loaded",
    url: window.location.href,
    hasTableArea: !!document.querySelector(".table-area"),
    hasBody: !!document.body,
  },
});

// REGISTER_POKER_TAB is sent lazily in startObserving() once .table-area is found.
// This prevents payment/lobby iframes from registering as the poker tab (todo 033).

window.addEventListener("beforeunload", () => {
  chrome.runtime.sendMessage({ type: "UNREGISTER_POKER_TAB" });
});

// ── Type Guard ─────────────────────────────────────────────────────────

function isAutopilotAction(x: unknown): x is AutopilotAction {
  if (!x || typeof x !== "object") return false;
  const a = x as Record<string, unknown>;
  return (
    ["FOLD", "CHECK", "CALL", "RAISE", "BET"].includes(a.action as string) &&
    (a.amount === null || Number.isFinite(a.amount)) &&
    typeof a.reasoning === "string"
  );
}

// ── Message Handling ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "AUTOPILOT_ACTION") {
    // Validate before executing on real-money DOM (todo 038)
    if (!isAutopilotAction(message.action)) {
      console.error("[Poker] Invalid action shape received:", message.action);
      return;
    }
    onDecisionReceived(message.action);
  }

  if (message.type === "AUTOPILOT_MODE") {
    // Validate mode before assigning (todo 038)
    const valid: Array<typeof autopilotMode> = ["off", "monitor", "play"];
    if (!valid.includes(message.mode)) {
      console.error("[Poker] Invalid autopilot mode:", message.mode);
      return;
    }
    autopilotMode = message.mode;
    console.log("[Poker] Autopilot mode:", autopilotMode);
    if (autopilotMode !== "off") {
      startObserving();
    }
  }

  // Persona recommendation relayed from the web app via background (todo 050)
  if (message.type === "PERSONA_RECOMMENDATION") {
    lastPersonaRec = {
      name: message.personaName,
      action: message.action,
      temperature: message.temperature,
    };
  }

  // Claude's completed advice relayed from the web app
  if (message.type === "CLAUDE_ADVICE") {
    lastClaudeAdvice = {
      action: message.action,
      amount: message.amount ?? null,
      street: message.street ?? null,
      boardTexture: message.boardTexture ?? null,
      spr: message.spr ?? null,
    };
  }
});


// ── DOM Scraping ───────────────────────────────────────────────────────

function parseCardFromSvg(src: string): string | null {
  // Simplified: regex validates suit + rank in one pass (todo 046 — removed identity maps)
  // Matches filenames like "../../resources/images/cards-classic-assets/dq.svg"
  const match = src.match(/\/([cdhs])([a2-9]|10|[jqka])\.svg$/i);
  if (!match) return null;
  const [, suitChar, rankStr] = match;
  return rankStr.toUpperCase() + suitChar; // a→A, j→J, q→Q, k→K; numbers unchanged
}

function parseCardFromText(
  rankEl: Element | null,
  suitEl: Element | null,
): string | null {
  if (!rankEl || !suitEl) return null;
  const rank = rankEl.textContent?.trim();
  const suitSymbol = suitEl.textContent?.trim();
  if (!rank || !suitSymbol) return null;
  const suit = SUIT_MAP[suitSymbol];
  if (!suit) return null;
  return rank + suit;
}

function scrapeHeroCards(): string[] {
  const cards: string[] = [];
  const holder = document.querySelector(".cards-holder-hero");
  if (!holder) return cards;

  // Try SVG filenames first (more reliable)
  holder.querySelectorAll(".card img.card-image").forEach((img) => {
    const src = img.getAttribute("src") || "";
    if (src.includes("card-back")) return;
    const card = parseCardFromSvg(src);
    if (card) cards.push(card);
  });

  // Fallback to text nodes if SVG didn't find both cards
  if (cards.length < 2) {
    cards.length = 0;
    holder.querySelectorAll(".card").forEach((cardEl) => {
      const card = parseCardFromText(
        cardEl.querySelector(".card-rank"),
        cardEl.querySelector(".card-suit"),
      );
      if (card) cards.push(card);
    });
  }

  return cards;
}

function scrapeCommunityCards(): string[] {
  const cards: string[] = [];
  const community = document.querySelector(".cardset-community");
  if (!community) return cards;

  community
    .querySelectorAll(".card:not(.pt-visibility-hidden)")
    .forEach((cardEl) => {
      const img = cardEl.querySelector("img.card-image");
      if (img) {
        const src = img.getAttribute("src") || "";
        if (!src.includes("card-back")) {
          const card = parseCardFromSvg(src);
          if (card) {
            cards.push(card);
            return;
          }
        }
      }
      const card = parseCardFromText(
        cardEl.querySelector(".card-rank"),
        cardEl.querySelector(".card-suit"),
      );
      if (card) cards.push(card);
    });

  return cards;
}

function scrapePlayers(): PlayerState[] {
  const players: PlayerState[] = [];
  document.querySelectorAll(".player-area").forEach((area) => {
    const seatMatch = area.className.match(/player-seat-(\d+)/);
    if (!seatMatch) return;
    const seat = parseInt(seatMatch[1], 10);

    const nameEl = area.querySelector(".nickname .target");
    const stackEl = area.querySelector(".text-block.amount");
    const betEl = area.querySelector(
      `.bet:not(.pt-visibility-hidden) .amount`,
    );
    const foldAction = area.querySelector(".player-action.action-fold");
    const cardsHidden = area.querySelector(".cardset-hidden-other-player");
    const cardsHero = area.querySelector(".cards-holder-hero");

    players.push({
      seat,
      name: nameEl?.textContent?.trim() || "",
      stack: stackEl?.textContent?.trim() || "",
      bet: betEl?.textContent?.trim() || "",
      folded: !!foldAction,
      hasCards: !!(cardsHidden || cardsHero),
    });
  });

  return players;
}

function scrapeHeroSeat(): number {
  const myPlayer = document.querySelector(".player-area.my-player");
  if (!myPlayer) return -1;
  const match = myPlayer.className.match(/player-seat-(\d+)/);
  return match ? parseInt(match[1], 10) : -1;
}

function scrapeDealerSeat(): number {
  // Dealer position is stable for an entire hand (~30-90s). Return cached value to avoid
  // 6 document.querySelector calls on every detection tick.
  if (cachedDealerSeat !== null) return cachedDealerSeat;
  for (let i = 1; i <= 6; i++) {
    const pos = document.querySelector(
      `.game-position-${i}:not(.pt-visibility-hidden)`,
    );
    if (pos) {
      cachedDealerSeat = i;
      return i;
    }
  }
  return -1;
}

function scrapePot(): string {
  return (
    document.querySelector(".total-pot-amount")?.textContent?.trim() || ""
  );
}

function scrapeHandId(): string {
  const text =
    document.querySelector(".hand-id")?.textContent?.trim() || "";
  return text.replace("#", "");
}

function scrapeTimer(): number | null {
  const el = document.querySelector(
    ".my-player .countdown-text, .my-player .turn-to-act-indicator",
  );
  if (!el) return null;
  const text = el.textContent?.trim();
  if (!text) return null;
  const num = parseInt(text, 10);
  return isNaN(num) ? null : num;
}

function scrapeIsHeroTurn(): boolean {
  const myPlayer = document.querySelector(".player-area.my-player");
  if (!myPlayer) return false;
  return !!(
    myPlayer.querySelector(".turn-to-act-indicator") ||
    myPlayer.querySelector(".countdown-text")
  );
}

function scrapeAvailableActions(): ActionOption[] {
  const actions: ActionOption[] = [];
  const actionsArea = document.querySelector(".actions-area");
  if (!actionsArea) return actions;

  actionsArea.querySelectorAll(".base-button").forEach((btn) => {
    // Playtech renders dual spans per button (visual + aria label) so btn.textContent gives "FoldFold".
    // The first LEAF span (no child spans) holds just the visible label.
    // Pre-action toggles (e.g. "Check/Fold", "Fold/Check") are also .base-button — skip them
    // by detecting the "/" separator; real action buttons never have slashes in their label.
    const spans = btn.querySelectorAll("span");
    // Find the first leaf span (no child spans), fall back to btn.textContent
    let text = "";
    for (const s of spans) {
      if (s.querySelector("span") === null) { text = s.textContent?.trim() ?? ""; break; }
    }
    if (!text) text = btn.textContent?.trim() ?? "";
    if (!text || text.includes("/")) return; // skip pre-action toggles

    const lowerText = text.toLowerCase();

    let type: ActionOption["type"] | null = null;
    let amount: string | null = null;

    if (lowerText.startsWith("fold")) {
      type = "FOLD";
    } else if (lowerText.startsWith("check")) {
      type = "CHECK";
    } else if (lowerText.startsWith("call")) {
      type = "CALL";
      const amountMatch = text.match(/[€$£]([\d,.]+)/);
      if (amountMatch) amount = amountMatch[0];
    } else if (lowerText.startsWith("raise")) {
      type = "RAISE";
      const amountMatch = text.match(/[€$£]([\d,.]+)/);
      if (amountMatch) amount = amountMatch[0];
    } else if (lowerText.startsWith("bet")) {
      type = "BET";
      const amountMatch = text.match(/[€$£]([\d,.]+)/);
      if (amountMatch) amount = amountMatch[0];
    } else if (lowerText.includes("all-in") || lowerText.includes("allin")) {
      type = "ALL_IN";
      const amountMatch = text.match(/[€$£]([\d,.]+)/);
      if (amountMatch) amount = amountMatch[0];
    }

    if (type) {
      actions.push({ type, label: text, amount });
    }
  });

  return actions;
}

// ── Table Statistics Scraping ──────────────────────────────────────────

/**
 * Find the numeric value associated with a stat label (e.g. "VPIP", "AF")
 * inside a player area element.
 *
 * Handles two common Playtech DOM patterns:
 *   A) <span class="label">VPIP</span><span class="value">28</span>
 *   B) <div>VPIP 28</div>  (label and value in same text node)
 */
function findStatValue(area: Element, label: string): number | null {
  // Use targeted selectors instead of querySelectorAll("*") which traverses the entire
  // subtree. HUD stats are shallow — label+value elements are spans or direct children.
  const all = Array.from(area.querySelectorAll("span, div, td, p"));
  for (const el of all) {
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim() || "")
      .join("");

    // Pattern B: single element contains "VPIP 28" or "VPIP: 28"
    const inlineMatch = ownText.match(
      new RegExp(`${label}[:\\s]+([\\d.]+)`, "i"),
    );
    if (inlineMatch) return parseFloat(inlineMatch[1]);

    // Pattern A: element text IS the label; value is in a sibling
    if (ownText === label) {
      const siblings = Array.from(el.parentElement?.children ?? []);
      for (const sib of siblings) {
        if (sib === el) continue;
        const val = parseFloat(sib.textContent?.trim() || "");
        if (!isNaN(val)) return val;
      }
      // Or next/prev sibling text node
      const next = el.nextSibling?.textContent?.trim();
      if (next) {
        const val = parseFloat(next);
        if (!isNaN(val)) return val;
      }
    }
  }
  return null;
}

interface DomPlayerStat {
  seat: number;
  vpip: number | null;
  af: number | null;
}

let statDebugLogged = false;

function scrapeTableStats(): DomPlayerStat[] {
  const results: DomPlayerStat[] = [];
  document.querySelectorAll(".player-area").forEach((area) => {
    const seatMatch = area.className.match(/player-seat-(\d+)/);
    if (!seatMatch) return;
    const seat = parseInt(seatMatch[1], 10);
    const vpip = findStatValue(area, "VPIP");
    const af = findStatValue(area, "AF");
    results.push({ seat, vpip, af });
  });

  // One-time debug log so we can verify / refine selectors
  if (!statDebugLogged) {
    statDebugLogged = true;
    const hasAny = results.some((s) => s.vpip !== null || s.af !== null);
    if (hasAny) {
      console.log("[Poker] DOM stats scraped:", results);
    } else {
      const firstArea = document.querySelector(".player-area");
      console.log(
        "[Poker] VPIP/AF not found. First .player-area snippet:",
        firstArea?.innerHTML?.slice(0, 600) ?? "(none)",
      );
    }
  }

  return results;
}

type TableTemperatureLocal =
  | "tight_passive"
  | "tight_aggressive"
  | "loose_passive"
  | "loose_aggressive"
  | "balanced"
  | "unknown";

function deriveTemperatureFromDomStats(
  stats: DomPlayerStat[],
  heroSeat: number,
): TableTemperatureLocal {
  const opponents = stats.filter((s) => s.seat !== heroSeat);
  const withVpip = opponents.filter((s) => s.vpip !== null);
  if (withVpip.length === 0) return "unknown";

  const avgVpip =
    withVpip.reduce((sum, s) => sum + s.vpip!, 0) / withVpip.length;

  const withAf = opponents.filter((s) => s.af !== null);
  const avgAf =
    withAf.length > 0
      ? withAf.reduce((sum, s) => sum + s.af!, 0) / withAf.length
      : null;

  const isTight = avgVpip < 22;
  const isLoose = avgVpip > 30;
  const isAggressive = avgAf !== null ? avgAf > 1.5 : null;

  if (!isTight && !isLoose) return "balanced";
  if (isTight) {
    return isAggressive === false ? "tight_passive" : "tight_aggressive";
  }
  // Loose
  return isAggressive === false ? "loose_passive" : "loose_aggressive";
}

const TEMPERATURE_TO_OPPONENT_TYPE: Partial<Record<TableTemperatureLocal, PlayerExploitType>> = {
  loose_passive:    "LOOSE_PASSIVE",
  tight_passive:    "TIGHT_PASSIVE",
  loose_aggressive: "LOOSE_AGGRESSIVE",
  tight_aggressive: "TIGHT_AGGRESSIVE",
};

function scrapeGameState(): GameState {
  // Pure read — no DOM mutations here (todo 032 / CQS principle)
  return {
    handId: scrapeHandId(),
    heroCards: scrapeHeroCards(),
    communityCards: scrapeCommunityCards(),
    pot: scrapePot(),
    players: scrapePlayers(),
    heroSeat: scrapeHeroSeat(),
    dealerSeat: scrapeDealerSeat(),
    availableActions: scrapeAvailableActions(),
    isHeroTurn: scrapeIsHeroTurn(),
    timerSeconds: scrapeTimer(),
  };
}

// ── Position Mapping ───────────────────────────────────────────────────

// Positions ordered clockwise from dealer button (todo 037 — uses activeSeatCount)
const POSITIONS_BY_COUNT: Record<number, readonly string[]> = {
  2: ["BTN/SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "UTG"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "MP", "CO"],
};

function getPosition(
  seat: number,
  dealerSeat: number,
  activeSeatCount: number,
): string {
  if (dealerSeat < 0 || activeSeatCount < 2) return "??";
  const count = Math.min(activeSeatCount, 6);
  const positions = POSITIONS_BY_COUNT[count] ?? POSITIONS_BY_COUNT[6];
  const offset = ((seat - dealerSeat + count) % count);
  return offset < positions.length ? positions[offset] : "??";
}

// ── Conversation Builders ──────────────────────────────────────────────

function buildHandStartMessage(state: GameState): string {
  const activePlayers = state.players.filter(
    (p) => p.name && !p.folded && p.hasCards,
  );

  const lines: string[] = [];
  lines.push(
    `New hand #${state.handId}. ${activePlayers.length}-handed NL Hold'em.`,
  );

  for (const p of state.players) {
    if (!p.name) continue;
    const pos = getPosition(
      p.seat,
      state.dealerSeat,
      activePlayers.length,
    );
    const isHero = p.seat === state.heroSeat;
    const heroLabel = isHero ? " (Hero)" : "";
    const status = p.folded ? " [folded]" : "";
    lines.push(
      `Seat ${p.seat} (${pos})${heroLabel}: ${p.name} ${p.stack}${status}`,
    );
  }

  if (state.heroCards.length > 0) {
    const [c1, c2] = state.heroCards;
    const suitTag =
      state.heroCards.length === 2 && c1 && c2
        ? c1.slice(-1) === c2.slice(-1)
          ? " (suited)"
          : " (offsuit)"
        : "";
    lines.push(`\nHero holds: ${state.heroCards.join(" ")}${suitTag}`);
  }

  if (state.communityCards.length > 0) {
    lines.push(`Board: ${state.communityCards.join(" ")}`);
  }

  if (state.pot) {
    lines.push(`Pot: ${state.pot}`);
  }

  if (state.availableActions.length > 0) {
    const opts = state.availableActions.map((a) => a.label).join(", ");
    lines.push(`\nAction to Hero. Options: ${opts}`);
  }

  return lines.join("\n");
}

function buildTurnMessage(state: GameState): string {
  const lines: string[] = [];

  // New community cards
  if (lastState) {
    if (state.communityCards.length > lastState.communityCards.length) {
      const streetName =
        state.communityCards.length === 3
          ? "FLOP"
          : state.communityCards.length === 4
            ? "TURN"
            : "RIVER";
      lines.push(`${streetName}: ${state.communityCards.join(" ")}`);
    }
  }

  // Flush accumulated opponent actions (todo 044 — captured continuously, not just at diff time)
  if (streetActions.length > 0) {
    lines.push(...streetActions);
    streetActions = [];
  }

  if (state.pot) {
    lines.push(`Pot: ${state.pot}`);
  }

  if (state.availableActions.length > 0) {
    const opts = state.availableActions.map((a) => a.label).join(", ");
    lines.push(`Action to Hero. Options: ${opts}`);
  }

  return lines.join("\n");
}

// ── Persona Request ────────────────────────────────────────────────────

const PERSONA_API_URL = "http://localhost:3006/api/persona";

async function requestPersona(heroCards: string[], position: string) {
  if (lastPersonaRec) return; // already set for this hand
  if (personaRequesting) return; // concurrent call in flight — skip to avoid race overwrite
  personaRequesting = true;

  // Derive temperature from VPIP/AF stats visible in the table DOM
  const tableStats = scrapeTableStats();
  const heroSeat = scrapeHeroSeat();
  const domTemperature = deriveTemperatureFromDomStats(tableStats, heroSeat);
  if (domTemperature !== "unknown") {
    console.log("[Poker] Table temperature from DOM stats:", domTemperature);
  }

  // Persist temperature for the exploit layer — use VPIP player count as sample proxy
  const withVpip = tableStats.filter((s) => s.seat !== heroSeat && s.vpip !== null);
  lastTableTemperature = {
    dominantType: domTemperature,
    handsObserved: withVpip.length >= 3 ? 30 : withVpip.length >= 2 ? 15 : withVpip.length >= 1 ? 6 : 0,
  };

  try {
    const res = await fetch(PERSONA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        heroCards: heroCards.join(" "),
        position,
        temperature: domTemperature !== "unknown" ? domTemperature : undefined,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.personaName && data.action) {
      lastPersonaRec = {
        name: data.personaName,
        action: data.action,
        temperature: data.temperature ?? "unknown",
        rotated: data.rotated ?? false,
        allPersonas: data.allPersonas ?? [],
      };
      console.log("[Poker] Persona:", lastPersonaRec.name, "→", lastPersonaRec.action);
      if (lastState) updateOverlay(lastState);
    }
  } catch {
    // Server not running — silently skip
  } finally {
    personaRequesting = false;
  }
}

// ── Local Decision Engine ──────────────────────────────────────────────

/**
 * Attempt a local rule-based decision for post-flop spots.
 * Returns null if insufficient information or pre-flop.
 * Caller falls back to Claude when null or confidence < CONFIDENCE_THRESHOLD.
 */
function localDecide(state: GameState): LocalDecision | null {
  // Post-flop only: need ≥ 3 community cards (guard against partial deal animation)
  if (state.communityCards.length < 3 || state.heroCards.length === 0) return null;

  // Temperature is set by requestPersona() which fires at hand start.
  // If it hasn't arrived yet (async race on first hand), fall back to base rules (no exploit layer).
  const temperature = lastTableTemperature ?? { dominantType: "unknown" as TableTemperatureLocal, handsObserved: 0 };

  const heroPlayer = state.players.find((p) => p.seat === state.heroSeat);
  if (!heroPlayer) return null;

  const heroStack = parseCurrency(heroPlayer.stack);
  const activePlayers = state.players.filter(
    (p) => p.name && !p.folded && p.hasCards,
  );
  const opponents = activePlayers.filter((p) => p.seat !== state.heroSeat);
  const opponentStacks = opponents.map((p) => parseCurrency(p.stack)).filter((s) => s > 0);
  const minOpponentStack = opponentStacks.length > 0 ? Math.min(...opponentStacks) : heroStack;
  const effectiveStack = Math.min(heroStack, minOpponentStack);

  const callAction = state.availableActions.find((a) => a.type === "CALL");
  const callAmount = parseCurrency(callAction?.amount);
  const facingBet = callAmount > 0;

  // Normalise BTN/SB → BTN for position lookup
  const rawPosition = getPosition(state.heroSeat, state.dealerSeat, activePlayers.length);
  const position = rawPosition === "BTN/SB" ? "BTN" : rawPosition;

  const pot = parseCurrency(state.pot);

  // Infer opponent type from table temperature (aggregate VPIP/AF from DOM).
  // Per-seat wiring deferred until CLAUDE_ADVICE → opponentTypes bridge is in place.
  const opponentType = TEMPERATURE_TO_OPPONENT_TYPE[temperature.dominantType];
  const handsObserved = temperature.handsObserved;

  try {
    return applyRuleTree({
      heroCards: state.heroCards,
      communityCards: state.communityCards,
      pot,
      heroStack,
      effectiveStack,
      callAmount,
      facingBet,
      position,
      activePlayers: activePlayers.length,
      opponentType,
      handsObserved,
    });
  } catch (err) {
    console.error("[Poker] localDecide() threw:", err);
    return null;
  }
}

// ── Decision Request ───────────────────────────────────────────────────

/** Brief post-flop style guidance per persona, prepended to every hand. */
const PERSONA_GUIDES: Record<string, string> = {
  "GTO Grinder":    "Play balanced, unexploitable ranges. Mix value bets and bluffs at correct frequencies. Avoid easy-to-exploit patterns post-flop.",
  "TAG Shark":      "Play tight-aggressive. Only enter with premium hands and strong draws. Apply maximum pressure with value bets and bluffs when in the hand.",
  "LAG Assassin":   "Play loose-aggressive. Wide ranges, relentless pressure with bets and raises, frequent semi-bluffs and float plays.",
  "Exploit Hawk":   "Exploit tendencies. Steal relentlessly from tight/passive players. Value bet thinly against calling stations. Bluff only proven folders.",
};

function requestDecision(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
  if (executing) {
    console.log("[Poker] Already executing, skipping decision request");
    return;
  }
  executing = true;

  // Prepend persona style guide so Claude plays the same archetype all hand
  const personaGuide = lastPersonaRec && PERSONA_GUIDES[lastPersonaRec.name];
  const fullMessages = personaGuide
    ? [
        { role: "user" as const, content: `Play as ${lastPersonaRec!.name}: ${personaGuide}` },
        { role: "assistant" as const, content: `Understood. Playing as ${lastPersonaRec!.name} throughout this hand.` },
        ...messages,
      ]
    : messages;

  // Watchdog: auto-fold if AUTOPILOT_ACTION never arrives (todo 031 — plan specified 12s timeout)
  // Cancellation token (todo 059): prevents double-action if decision arrives just as timer fires.
  const timer = scrapeTimer();
  const timeoutMs = Math.max(3000, (timer ?? 12) * 1000 - 3000);
  const token = { cancelled: false };
  watchdogToken = token;
  decisionWatchdog = setTimeout(() => {
    decisionWatchdog = null;
    if (token.cancelled) return;
    console.warn("[Poker] Decision timeout");
    executing = false;
    if (autopilotMode === "play") {
      executeAction({ action: "FOLD", amount: null, reasoning: "Decision timeout" });
    }
  }, timeoutMs);

  console.log("[Poker] Requesting decision. Messages:", fullMessages.length, lastPersonaRec ? `(${lastPersonaRec.name})` : "");
  chrome.runtime.sendMessage({
    type: "AUTOPILOT_DECIDE",
    messages: fullMessages,
  });
}

// ── Action Execution ───────────────────────────────────────────────────

// Fallback hierarchy for FOLD/CHECK/CALL when primary action unavailable
const FALLBACK_MAP: Record<string, string[]> = {
  CALL: ["CHECK", "FOLD"],
  CHECK: ["FOLD"],
  FOLD: [],
};

function gaussianRandom(mean: number, stddev: number): number {
  // Box-Muller transform; use 1-Math.random() to avoid log(0)
  const u1 = 1 - Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stddev;
}

function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const mean = (minMs + maxMs) / 2;
  const stddev = (maxMs - minMs) / 6;
  const delay = Math.max(
    minMs,
    Math.min(maxMs, gaussianRandom(mean, stddev)),
  );
  return new Promise((r) => setTimeout(r, delay));
}

function simulateClick(element: Element) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
  const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);

  const eventOpts = {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    view: window,
  };

  element.dispatchEvent(new MouseEvent("mouseover", eventOpts));
  element.dispatchEvent(new MouseEvent("mousedown", eventOpts));
  element.dispatchEvent(new MouseEvent("mouseup", eventOpts));
  element.dispatchEvent(new MouseEvent("click", eventOpts));

  console.log("[Poker] Clicked:", element.textContent?.trim());
  return true;
}

function findActionButton(actionType: string): Element | null {
  // Returns the Element directly so the reference survives async delays (todo 036)
  const actionsArea = document.querySelector(".actions-area");
  if (!actionsArea) return null;

  const buttons = actionsArea.querySelectorAll(".base-button");
  for (const btn of buttons) {
    const text = btn.textContent?.trim().toLowerCase() || "";
    const match = actionType.toLowerCase();

    if (text.startsWith(match)) return btn;

    if (
      actionType === "ALL_IN" &&
      (text.includes("all-in") || text.includes("allin"))
    ) {
      return btn;
    }
  }

  return null;
}

async function executeAction(decision: AutopilotAction) {
  const timer = scrapeTimer();

  let button: Element | null;

  // try/finally guarantees executing is always cleared, even if an unexpected
  // exception is thrown (todo 060)
  try {
    // RAISE/BET: bet-input not yet implemented — fall back to CALL/CHECK to avoid
    // executing at the wrong default size (todo 030)
    if (decision.action === "RAISE" || decision.action === "BET") {
      console.warn(
        `[Poker] ${decision.action} €${decision.amount ?? "?"} requested but bet-input entry not yet implemented — falling back to avoid wrong-sized bet`,
      );
      button = findActionButton("CALL") ?? findActionButton("CHECK") ?? findActionButton("FOLD");
      if (button) {
        console.log("[Poker] RAISE/BET fallback: clicked", button.textContent?.trim());
      }
    } else {
      button = findActionButton(decision.action);

      // Standard fallback chain for FOLD/CHECK/CALL
      if (!button && FALLBACK_MAP[decision.action]) {
        for (const fallback of FALLBACK_MAP[decision.action]) {
          button = findActionButton(fallback);
          if (button) {
            console.log(`[Poker] ${decision.action} unavailable, fell back to ${fallback}`);
            break;
          }
        }
      }
    }

    if (!button) {
      console.error("[Poker] No action button found — giving up");
      return;
    }

    // Dynamic humanization delay based on remaining timer
    if (timer !== null && timer <= 3) {
      console.log("[Poker] Timer critical, clicking immediately");
    } else {
      const maxDelay =
        timer !== null ? Math.min(8000, (timer - 3) * 1000) : 8000;
      const minDelay = Math.min(1500, maxDelay);
      if (maxDelay > minDelay) {
        await humanDelay(minDelay, maxDelay);
      }
    }

    // Re-check element is still connected after async delay (todo 036)
    if (!button.isConnected) {
      console.warn("[Poker] Button detached during delay — refinding");
      button = findActionButton(decision.action === "RAISE" || decision.action === "BET"
        ? "CALL"
        : decision.action);
      if (!button) {
        console.error("[Poker] Button lost after delay, aborting");
        return;
      }
    }

    // For RAISE/BET: re-validate that the bet input is still present and the amount
    // is within the allowed range — pot/blinds can change during the humanisation delay
    if ((decision.action === "RAISE" || decision.action === "BET") && decision.amount !== null) {
      const betInput = document.querySelector<HTMLInputElement>(".betInput, [data-bet-input]");
      if (!betInput) {
        console.warn("[Poker] Bet input gone after delay — aborting raise");
        return;
      }
      const min = parseFloat(betInput.min);
      const max = parseFloat(betInput.max);
      if (Number.isFinite(min) && (decision.amount < min || decision.amount > max)) {
        console.warn(`[Poker] Amount €${decision.amount} out of range [${min}, ${max}] after delay — aborting`);
        return;
      }
    }

    simulateClick(button);
  } finally {
    executing = false;
  }
}

/**
 * Single execution point for all autopilot actions (local engine + Claude path).
 * Handles FOLD→CHECK safety override, monitor-mode intercept, and checkbox clearing.
 * Callers set executing=true before calling; this function clears it via executeAction().
 */
function safeExecuteAction(action: AutopilotAction, source: "claude" | "local" = "claude") {
  // 1. Safety: never fold when checking is free — query live DOM, not stale lastState.
  // Only override when CHECK is available AND CALL is NOT — if both appear the pre-action
  // "Check" toggle is selected and CALL is the real option; folding there is a real choice.
  let finalAction = action;
  if (
    action.action === "FOLD" &&
    findActionButton("CHECK") !== null &&
    findActionButton("CALL") === null
  ) {
    console.warn("[Poker] Overriding FOLD → CHECK (check is truly free — no call available)");
    finalAction = { ...action, action: "CHECK", amount: null };
  }

  // 2. Monitor mode: display recommendation in overlay, do not execute
  if (autopilotMode === "monitor") {
    monitorAdvice = finalAction;
    executing = false;
    const recStr = finalAction.amount != null
      ? `${finalAction.action} €${finalAction.amount.toFixed(2)}`
      : finalAction.action;
    const tag = source === "local" ? "[Local]" : "[Claude]";
    console.log(`[Poker] [MONITOR] ${tag} recommends: ${recStr}${finalAction.reasoning ? ` — ${finalAction.reasoning}` : ""}`);
    if (lastState) updateOverlay(lastState);
    return;
  }

  // 3. Clear pre-action checkboxes — play mode only (todo 032)
  if (autopilotMode === "play") {
    document.querySelectorAll(".pre-action-toggle:checked").forEach((el) => {
      (el as HTMLInputElement).checked = false;
    });
  }

  executeAction(finalAction);
}

function onDecisionReceived(action: AutopilotAction) {
  // Cancel timeout watchdog — token must be cancelled before clearTimeout in case
  // the timer already fired and its callback is queued (todo 031, todo 059)
  if (watchdogToken) {
    watchdogToken.cancelled = true;
    watchdogToken = null;
  }
  if (decisionWatchdog) {
    clearTimeout(decisionWatchdog);
    decisionWatchdog = null;
  }

  // Record as readable prose, not raw JSON (todo 041)
  const actionStr = action.amount != null
    ? `${action.action} €${action.amount.toFixed(2)}`
    : action.action;
  handMessages.push({
    role: "assistant",
    content: `Hero ${actionStr.toLowerCase()}s. ${action.reasoning}`,
  });

  console.log(`[Poker] Claude decided: ${actionStr} — ${action.reasoning}`);

  safeExecuteAction(action, "claude");
}

// ── Monitor Overlay ────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let overlayEl: HTMLElement | null = null;

function getOverlay(): HTMLElement {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.id = "poker-monitor-overlay";
  overlayEl.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 999999;
    background: rgba(0,0,0,0.85); color: #e4e4e7;
    font: 11px/1.4 monospace; padding: 8px 10px;
    border-radius: 6px; border: 1px solid #3f3f46;
    max-width: 320px; pointer-events: none;
  `;
  document.body.appendChild(overlayEl);
  return overlayEl;
}

function updateOverlay(state: GameState) {
  if (autopilotMode === "off") {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
    lastPersonaRec = null;
    return;
  }

  const el = getOverlay();
  const modeLabel = autopilotMode === "play" ? "PLAY" : "MONITOR";
  const modeColor = autopilotMode === "play" ? "#c084fc" : "#60a5fa";

  const hero = state.heroCards.length > 0 ? escapeHtml(state.heroCards.join(" ")) : "—";
  const board = state.communityCards.length > 0 ? escapeHtml(state.communityCards.join(" ")) : "—";
  const actions = escapeHtml(state.availableActions.map((a) => a.label).join(" | ") || "—");
  const turn = state.isHeroTurn ? "YES" : "no";
  const turnColor = state.isHeroTurn ? "#4ade80" : "#71717a";

  // Persona section — all 4 personas shown preflop, active persona shown post-flop
  const isPreflop = state.communityCards.length === 0 && state.heroCards.length > 0;

  // Concrete raise amount: only show when a RAISE/BET button is actually in the DOM.
  // When hero is facing a raise (only Fold+Call available) there is no raise button, so
  // we omit the amount to avoid displaying the misleading €0.06 open-raise default.
  const raiseOpt = state.availableActions.find(a => a.type === "RAISE" || a.type === "BET");
  const preflopRaiseAmt = raiseOpt?.amount ?? null;

  let personaHtml = "";
  if (lastPersonaRec?.allPersonas.length) {
    if (isPreflop) {
      // Show why this persona was selected
      const selectionTag = lastPersonaRec.rotated
        ? "rotating"
        : lastPersonaRec.temperature !== "unknown"
          ? lastPersonaRec.temperature.replaceAll("_", "-")
          : "best";
      // CHECK is truly free only when CHECK is available AND CALL is not.
      // If both appear, the pre-action "Check" toggle is active but CALL is the real decision.
      const checkFree = state.availableActions.some(a => a.type === "CHECK") &&
                        !state.availableActions.some(a => a.type === "CALL");
      const rows = lastPersonaRec.allPersonas.map(p => {
        const isSelected = p.selected;
        // Apply FOLD→CHECK safety override in display too (mirrors safeExecuteAction)
        const displayAction = p.action === "FOLD" && checkFree ? "CHECK" : p.action;
        const actionStr = (displayAction === "RAISE" || displayAction === "BET")
          ? (preflopRaiseAmt ? `${displayAction} ${preflopRaiseAmt}` : displayAction)
          : displayAction;
        const actionColor = displayAction === "RAISE" || displayAction === "BET" ? "#4ade80" : displayAction === "CALL" ? "#fbbf24" : displayAction === "CHECK" && checkFree && p.action === "FOLD" ? "#71717a" : "#52525b";
        const prefix = isSelected ? `<span style="color:#818cf8">★</span>` : `<span style="color:#3f3f46">·</span>`;
        const nameStyle = isSelected ? "color:#e4e4e7;font-weight:bold" : "color:#52525b";
        const tag = isSelected ? ` <span style="color:#3f3f46;font-size:10px">[${escapeHtml(selectionTag)}]</span>` : "";
        return `<div>${prefix} <span style="${nameStyle}">${escapeHtml(p.name)}</span> → <span style="color:${actionColor};font-weight:${isSelected ? "bold" : "normal"}">${escapeHtml(actionStr)}</span>${tag}</div>`;
      }).join("");
      personaHtml = `<div style="border-top:1px solid #3f3f46;margin-top:6px;padding-top:6px">${rows}</div>`;
    } else {
      // Post-flop: show active persona + the current local-engine recommendation inline
      const isMonitorErrPost = !!monitorAdvice && monitorAdvice.reasoning.startsWith("Auto-fold:");
      const postAction = monitorAdvice && !isMonitorErrPost
        ? monitorAdvice.action + (monitorAdvice.amount != null ? ` €${monitorAdvice.amount.toFixed(2)}` : "")
        : null;
      const postActionColor = !postAction ? "#52525b"
        : (postAction.startsWith("RAISE") || postAction.startsWith("BET")) ? "#4ade80"
        : postAction.startsWith("CALL") ? "#fbbf24"
        : postAction.startsWith("FOLD") ? "#ef4444"
        : "#9ca3af";
      const postReasoningSnip = monitorAdvice && !isMonitorErrPost && monitorAdvice.reasoning
        ? ` <span style="color:#52525b;font-size:10px">${escapeHtml(monitorAdvice.reasoning.slice(0, 60))}${monitorAdvice.reasoning.length > 60 ? "…" : ""}</span>`
        : "";
      personaHtml = `<div style="border-top:1px solid #3f3f46;margin-top:6px;padding-top:6px;color:#52525b">Playing as: <span style="color:#818cf8;font-weight:bold">${escapeHtml(lastPersonaRec.name)}</span>${postAction ? ` → <span style="color:${postActionColor};font-weight:bold">${escapeHtml(postAction)}</span>${postReasoningSnip}` : " <span style='color:#52525b'>(waiting…)</span>"}</div>`;
    }
  } else if (isPreflop && state.heroCards.length > 0) {
    personaHtml = `<div style="border-top:1px solid #3f3f46;margin-top:6px;padding-top:6px;color:#52525b">Personas loading…</div>`;
  }

  // Advice line priority:
  // Monitor mode: local engine / autopilot decision (monitorAdvice) wins — it's instant and
  //   stake-aware. Web-app Claude advice (lastClaudeAdvice) is shown only as fallback.
  // Other modes: web-app Claude advice takes precedence (richer reasoning).
  const webAdviceRec = lastClaudeAdvice?.action
    ? lastClaudeAdvice.action + (lastClaudeAdvice.amount ? ` ${lastClaudeAdvice.amount}` : "")
    : null;
  const webAdviceExtra = !isPreflop && lastClaudeAdvice?.boardTexture
    ? ` | ${escapeHtml(lastClaudeAdvice.boardTexture)}${lastClaudeAdvice.spr ? ` | SPR ${escapeHtml(lastClaudeAdvice.spr)}` : ""}`
    : "";
  // Distinguish real autopilot advice from error fallbacks ("Auto-fold: ...")
  const isMonitorError = !!monitorAdvice && monitorAdvice.reasoning.startsWith("Auto-fold:");
  const monAdviceRec = monitorAdvice && !isMonitorError
    ? monitorAdvice.action + (monitorAdvice.amount != null ? ` €${monitorAdvice.amount.toFixed(2)}` : "")
    : null;
  // In monitor mode: local engine advice first; web-app Claude only as fallback.
  const adviceRec = autopilotMode === "monitor"
    ? (monAdviceRec ?? webAdviceRec)
    : (webAdviceRec ?? monAdviceRec);
  const adviceExtra = (adviceRec === webAdviceRec && adviceRec !== null) ? webAdviceExtra : "";
  const adviceReasoning = (adviceRec === monAdviceRec && monitorAdvice?.reasoning && !isMonitorError)
    ? ` — ${escapeHtml(monitorAdvice.reasoning.slice(0, 80))}${monitorAdvice.reasoning.length > 80 ? "…" : ""}`
    : "";
  const errorMsg = isMonitorError
    ? monitorAdvice!.reasoning.replace("Auto-fold: ", "")
    : null;
  const claudeHtml = adviceRec
    ? `<div style="border-top:1px solid #3f3f46;margin-top:6px;padding-top:6px">
         <span style="color:#71717a">AI: </span>
         <span style="color:#4ade80;font-weight:bold">${escapeHtml(adviceRec)}</span>
         <span style="color:#9ca3af">${adviceExtra}${adviceReasoning}</span>
       </div>`
    : errorMsg
      ? `<div style="border-top:1px solid #3f3f46;margin-top:6px;padding-top:6px;color:#f97316">⚠ ${escapeHtml(errorMsg)}</div>`
      : "";

  el.innerHTML = `
    <div style="color:${modeColor};font-weight:bold;margin-bottom:4px">${modeLabel}</div>
    <div>Hand: ${escapeHtml(state.handId || "—")}</div>
    <div>Hero: <b>${hero}</b></div>
    <div>Board: ${board}</div>
    <div>Pot: ${escapeHtml(state.pot || "—")}</div>
    <div>Turn: <span style="color:${turnColor}">${turn}</span></div>
    <div>Actions: ${actions}</div>
    <div style="color:#71717a;margin-top:4px">Players: ${state.players.filter((p) => p.name).length}</div>
    ${personaHtml}
    ${claudeHtml}
  `;
}

// ── Game State Observer ────────────────────────────────────────────────

let observerActive = false;
let activeObserver: MutationObserver | null = null; // module-level ref for disconnect (todo 042)
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onDomChange() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processGameState();
  }, 200);
}

let lastDebugTime = 0;
const DEBUG_THROTTLE_MS = 3000;

function sendDebugLog(data: Record<string, unknown>) {
  chrome.runtime.sendMessage({ type: "AUTOPILOT_DEBUG", data });
}

function processGameState() {
  const state = scrapeGameState();

  updateOverlay(state);

  if (autopilotMode === "monitor") {
    const now = Date.now();
    if (now - lastDebugTime > DEBUG_THROTTLE_MS) {
      lastDebugTime = now;
      const heroHolder = document.querySelector(".cards-holder-hero");
      const communityHolder = document.querySelector(".cardset-community");
      const actionsArea = document.querySelector(".actions-area");
      sendDebugLog({
        type: "monitor",
        handId: state.handId || "(none)",
        state,
        dom: {
          heroCards: heroHolder?.outerHTML || null,
          communityCards: communityHolder?.outerHTML || null,
          actionsArea: actionsArea?.outerHTML || null,
        },
      });
    }
  }

  // Accumulate opponent actions continuously so pot consolidation can't erase them (todo 044)
  if (lastState) {
    for (const p of state.players) {
      if (!p.name || p.seat === state.heroSeat) continue;
      const prev = lastState.players.find((lp) => lp.seat === p.seat);
      if (!prev) continue;
      if (p.folded && !prev.folded) {
        streetActions.push(`${p.name} folds.`);
      } else if (p.bet !== prev.bet && p.bet) {
        streetActions.push(`${p.name} bets/raises to ${p.bet}.`);
      }
    }
  }

  // Detect new hand — single block (todo 047 — merged duplicate condition)
  if (state.handId && state.handId !== currentHandId) {
    console.log("[Poker] New hand:", state.handId);
    currentHandId = state.handId;
    handMessages = [];
    executing = false;
    lastHeroTurn = false;
    streetActions = [];
    lastPersonaRec = null;
    lastTableTemperature = null;   // reset so new hand gets fresh temperature scrape
    cachedDealerSeat = null;       // dealer button may move between hands
    lastClaudeAdvice = null;
    monitorAdvice = null;
    clearEvalCache();
    clearBoardCache();

    if (state.heroCards.length > 0) {
      handMessages.push({
        role: "user",
        content: buildHandStartMessage(state),
      });

      // Fetch persona recommendation for this hand (preflop only)
      if (autopilotMode !== "off" && state.communityCards.length === 0) {
        const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
        const rawPosition = getPosition(state.heroSeat, state.dealerSeat, activePlayers.length);
        const position = rawPosition === "??" ? "CO" : rawPosition;
        requestPersona(state.heroCards, position);

        // Pre-fetch decision for monitor mode — start the API call while others are deciding
        // so advice is ready (or nearly ready) by the time action reaches hero
        if (autopilotMode === "monitor") {
          requestDecision([...handMessages]);
        }
      }
    }
  }

  // Detect hero's turn (rising edge)
  if (state.isHeroTurn && !lastHeroTurn && !executing && autopilotMode !== "off") {
    console.log("[Poker] Hero's turn detected! Mode:", autopilotMode);

    if (handMessages.length === 0 && state.heroCards.length > 0) {
      handMessages.push({
        role: "user",
        content: buildHandStartMessage(state),
      });
    } else if (handMessages.length > 0) {
      const turnMsg = buildTurnMessage(state);
      if (turnMsg.trim()) {
        handMessages.push({ role: "user", content: turnMsg });
      }
    }

    if (autopilotMode === "monitor") {
      const lastMsg = handMessages[handMessages.length - 1];
      console.log("[Poker] [MONITOR] Sending to Claude:", lastMsg?.content);
      sendDebugLog({
        type: "hero_turn",
        handId: state.handId,
        mode: "monitor",
        message: lastMsg?.content,
        state,
      });
    }

    // Fetch persona if not yet set — fallback for when handId detection misses the new hand
    if (!lastPersonaRec && state.communityCards.length === 0 && state.heroCards.length > 0) {
      const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
      const rawPosition = getPosition(state.heroSeat, state.dealerSeat, activePlayers.length);
      const position = rawPosition === "??" ? "CO" : rawPosition;
      requestPersona(state.heroCards, position);
    }

    // Phase 1 — Preflop chart fast-path: skip Claude when we have a clean RFI spot
    // Guard: preflop only, persona available, and hero is opening (not facing a raise)
    const isPreflop = state.communityCards.length === 0;
    const facingRaise = state.availableActions.some(
      (a) => a.type === "CALL" && parseFloat((a.amount ?? "0").replace(/[€$£,]/g, "")) > 0,
    );
    if (
      autopilotMode !== "off" &&
      isPreflop &&
      lastPersonaRec &&
      !facingRaise &&
      state.heroCards.length > 0
    ) {
      const personaAction = lastPersonaRec.action.toUpperCase() as AutopilotAction["action"];
      if (["FOLD", "CALL", "RAISE", "BET", "CHECK"].includes(personaAction)) {
        executing = true;
        // Phase 1: attach euro amount to preflop RAISE from DOM button.
        // No fallback — if the button has no parseable amount we send null (display "RAISE").
        const raiseBtn = state.availableActions.find((a) => a.type === "RAISE" || a.type === "BET");
        const preflopRaiseEur =
          raiseBtn?.amount ? parseFloat(raiseBtn.amount.replace(/[€$£,]/g, "")) : null;
        const preflopAmount = personaAction === "RAISE" || personaAction === "BET" ? preflopRaiseEur : null;
        console.log(`[Poker] [Local/Preflop] ${lastPersonaRec.name} → ${personaAction}${preflopAmount != null ? ` €${preflopAmount.toFixed(2)}` : ""} (confidence 1.0)`);
        safeExecuteAction(
          { action: personaAction, amount: preflopAmount, reasoning: `Preflop chart: ${lastPersonaRec.name}` },
          "local",
        );
        lastHeroTurn = state.isHeroTurn;
        lastState = state;
        return;
      }
    }

    // Phase 4 — Post-flop local engine fast-path
    // Monitor mode: always use local engine regardless of confidence.
    // Play mode: only use local engine when confidence >= CONFIDENCE_THRESHOLD.
    if (autopilotMode !== "off" && state.communityCards.length >= 3) {
      const local = localDecide(state);
      if (local) {
        const meetsThreshold = local.confidence >= CONFIDENCE_THRESHOLD;
        if (autopilotMode === "monitor" || meetsThreshold) {
          executing = true;
          const confidenceTag = meetsThreshold ? "" : ` (~${(local.confidence * 100).toFixed(0)}% conf)`;
          console.log(`[Poker] [Local] ${local.action}${local.amount != null ? ` €${local.amount.toFixed(2)}` : ""} (confidence ${local.confidence.toFixed(2)}) — ${local.reasoning}${confidenceTag}`);
          // Forward decision to web app for observability — fire-and-forget via background
          chrome.runtime.sendMessage({
            type: "LOCAL_DECISION",
            payload: {
              action: local.action,
              amount: local.amount,
              confidence: local.confidence,
              reasoning: local.reasoning,
              source: "local",
            },
          });
          safeExecuteAction(
            { action: local.action, amount: local.amount, reasoning: local.reasoning + confidenceTag },
            "local",
          );
          lastHeroTurn = state.isHeroTurn;
          lastState = state;
          return;
        }
        console.log(`[Poker] [Local] Low confidence (${local.confidence.toFixed(2)}) — falling back to Claude: ${local.reasoning}`);
      }
    }

    if (autopilotMode !== "off" && handMessages.length > 0) {
      requestDecision([...handMessages]);
    }
  }

  lastHeroTurn = state.isHeroTurn;
  lastState = state;
}

function startObserving() {
  // Disconnect previous observer before creating a new one (todo 042)
  if (activeObserver) {
    activeObserver.disconnect();
    activeObserver = null;
    observerActive = false;
  }

  const tableArea = document.querySelector(".table-area");
  if (!tableArea) {
    const bodyClasses = document.body?.className || "(no body)";
    const url = window.location.href;
    console.log(`[Poker] No .table-area found. URL: ${url}, body classes: ${bodyClasses}`);
    sendDebugLog({ type: "no_table", url, bodyClasses });
    setTimeout(startObserving, 2000);
    return;
  }

  // Register as poker tab only after confirming we're in the game frame (todo 033)
  // Prevents payment/lobby iframes from overwriting pokerTabId in background
  chrome.runtime.sendMessage(
    { type: "REGISTER_POKER_TAB" },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[Poker] Register failed:",
          chrome.runtime.lastError.message,
        );
      } else {
        console.log("[Poker] Registered as poker tab:", response);
      }
    },
  );

  // Observe only childList + attributes (removed characterData — fires on every timer tick, todo 043)
  activeObserver = new MutationObserver(onDomChange);
  activeObserver.observe(tableArea, {
    subtree: true,
    childList: true,
    attributes: true,
    // characterData removed: timer countdown fires this 100s of times/sec (see todo 043)
  });

  observerActive = true;
  console.log("[Poker] MutationObserver started on .table-area");

  processGameState();
}

// ── Auto-start ─────────────────────────────────────────────────────────

// startObserving() handles its own retry when .table-area isn't found yet (todo 047)
startObserving();
