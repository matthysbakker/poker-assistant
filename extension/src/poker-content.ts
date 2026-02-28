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

import { applyRuleTree, applyRuleTreeAllPersonas, type PersonaPostflopDecision } from "../../lib/poker/rule-tree";
import { facingRaiseDecision, facing3BetDecision, facingLimpDecision } from "../../lib/poker/facing-raise";
import { rfiDecision } from "../../lib/poker/rfi-fallback";
import { clearEvalCache, evaluateHand } from "../../lib/poker/hand-evaluator";
import { clearBoardCache, analyzeBoard } from "../../lib/poker/board-analyzer";
import { parseCurrency } from "../../lib/poker/equity/pot-odds";
import { lookupGtoSpot } from "../../lib/poker/gto/lookup";
import { DEFAULT_VILLAIN_RANGE, type VillainRange } from "../../lib/poker/villain-range";
import type { LocalDecision } from "../../lib/poker/types";
import type { PlayerExploitType } from "../../lib/poker/exploit";
import type { OpponentStats } from "../../lib/poker/opponent-stats";
import { statsToVillainRange } from "../../lib/poker/opponent-stats";
import { isValidAction } from "./messages";

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

const SUIT_NAMES: Record<string, string> = { d: "diamonds", h: "hearts", s: "spades", c: "clubs" };

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
let preflopFastPathFired = false; // true once persona chart fires preflop — discards stale Claude pre-fetch in both monitor and play mode

// ── Local Engine Config ─────────────────────────────────────────────────

let lastClaudeAdvice: ClaudeAdvice | null = null;
let monitorAdvice: AutopilotAction | null = null;
let allPostflopDecisions: PersonaPostflopDecision[] | null = null;
let pendingPlayAction: AutopilotAction | null = null; // shown in overlay while humanDelay runs
let executing = false;
let currentHandId: string | null = null;
let handMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
let lastState: GameState | null = null;
let lastHeroTurn = false;
let streetActions: string[] = []; // accumulates opponent actions between hero turns (todo 044)
let decisionWatchdog: ReturnType<typeof setTimeout> | null = null; // timeout guard (todo 031)
let watchdogToken: { cancelled: boolean } | null = null;           // cancellation token (todo 059)

// ── GTO + Equity Engine State ───────────────────────────────────────────
/** Per-seat opponent stats fetched at hand start (VPIP → villain range) */
let seatStats: Record<number, OpponentStats> = {};
/** Cached villain range for the main villain (last aggressor or default random) */
let opponentVillainRange: VillainRange = DEFAULT_VILLAIN_RANGE;
/** HUD popup stats collected at hand start — keyed by seat number */
let handPopupStats: Record<number, PopupStats> = {};
/** Last decision source label for overlay */
let lastDecisionSource: "gto" | "equity" | "ruletree" | null = null;
/** Last range equity computed (0–1) for overlay display */
let lastRangeEquity: number | null = null;

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
    if (!isValidAction(message.action)) {
      console.warn("[Poker] PERSONA_RECOMMENDATION has invalid action, dropping:", message.action);
      return;
    }
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

  if (message.type === "ACTION_INSPECTOR_START") startActionInspector();
  if (message.type === "ACTION_INSPECTOR_STOP")  stopActionInspector();
  if (message.type === "ACTION_INSPECTOR_REPORT") reportActionInspector();
});

// ── Action-log DOM inspector ───────────────────────────────────────────────
// Discovers which DOM selector carries opponent action text (raises/calls/folds).
// Activated via the popup "Inspect" button → background → this message handler.
// Results are logged to the browser console on the poker tab.
//
// Design notes:
// - Poker clients often show action toasts that appear and are immediately
//   removed. The ancestor chain MUST be snapshotted synchronously inside the
//   MutationObserver callback, before any async tick lets the node detach.
// - We also capture element-level text (not just leaf text nodes) so that
//   elements whose textContent is set directly (innerHTML = "…") are caught.
// - Every match is logged immediately to the console so you can watch live.

const ACTION_RE = /\b(raises?(?:\s+to)?|calls?|folds?|checks?|bets?)\b/i;

interface InspectorEntry {
  count: number;
  minDepth: number;
  examples: string[];
  // Full ancestor path of the best (shortest) match, for CSS path debugging
  bestPath: string[];
}
const inspectorHits = new Map<string, InspectorEntry>();
let inspectorObserver: MutationObserver | null = null;
let inspectorMatchCount = 0;

/** Build a short CSS selector for a single element. */
function selectorForEl(el: Element): string {
  if (el.id) return `#${el.id}`;
  const dataAttr = Array.from(el.attributes).find((a) => a.name.startsWith("data-"));
  if (dataAttr) return `${el.tagName.toLowerCase()}[${dataAttr.name}="${dataAttr.value}"]`;
  const cls = Array.from(el.classList).filter((c) => !/^\d/.test(c)).slice(0, 3).join(".");
  return el.tagName.toLowerCase() + (cls ? "." + cls : "");
}

/**
 * Snapshot the full ancestor chain RIGHT NOW (synchronously), record each
 * ancestor in inspectorHits. Called from inside the MutationObserver callback
 * so the node is still attached.
 */
function recordInspectorHit(text: string, startEl: Element | null) {
  if (!startEl) return;
  const chain: string[] = [];
  let el: Element | null = startEl;
  let depth = 1;

  while (el && el !== document.body && depth <= 10) {
    const sel = selectorForEl(el);
    chain.push(sel);
    const entry: InspectorEntry = inspectorHits.get(sel) ?? {
      count: 0, minDepth: depth, examples: [], bestPath: [],
    };
    entry.count += 1;
    entry.minDepth = Math.min(entry.minDepth, depth);
    if (entry.examples.length < 8) entry.examples.push(text.trim().slice(0, 80));
    if (depth < (entry.bestPath.length || 99)) entry.bestPath = [...chain];
    inspectorHits.set(sel, entry);
    el = el.parentElement;
    depth++;
  }

  inspectorMatchCount++;
  // Log every match immediately — helpful for seeing ephemeral toasts
  console.log(
    `%c[Inspector #${inspectorMatchCount}]%c ${text.trim().slice(0, 60)}`,
    "color:#f59e0b;font-weight:bold", "color:#d4d4d8",
    "\n  →", chain.slice(0, 3).join(" > "),
  );
}

/**
 * Inspect a node that was just added or whose text changed.
 * IMPORTANT: snapshot ancestor chain synchronously — do NOT defer.
 */
function processInspectorNode(node: Node) {
  const text = node.textContent ?? "";
  if (!ACTION_RE.test(text)) return;

  // For a text node, start at its parent element.
  // For an element, start at the element itself (textContent may be set directly).
  const startEl = node.nodeType === Node.TEXT_NODE
    ? node.parentElement
    : (node as Element);

  // Exclude our own overlay — its text (CHECK, Fold, Call, etc.) pollutes results.
  if (startEl?.closest("#poker-monitor-overlay")) return;

  recordInspectorHit(text, startEl);
}

function startActionInspector() {
  if (inspectorObserver) {
    console.log("[Poker] [Inspector] Already running — call stop first to reset.");
    return;
  }
  inspectorHits.clear();
  inspectorMatchCount = 0;

  // One-shot scan of existing DOM text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  let existingCount = 0;
  while ((n = walker.nextNode())) {
    if (ACTION_RE.test(n.textContent ?? "")) {
      processInspectorNode(n);
      existingCount++;
    }
  }
  if (existingCount) {
    console.log(`[Poker] [Inspector] Found ${existingCount} existing action(s) in DOM.`);
  }

  inspectorObserver = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      // New nodes added — snapshot ancestor chain immediately (node may be
      // removed in the same batch of mutations, before we next yield).
      for (const node of mut.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          processInspectorNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          // Also check the element itself (textContent set via innerHTML)
          if (ACTION_RE.test((node as Element).textContent ?? "")) {
            processInspectorNode(node);
          }
          // And walk child text nodes
          const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let nn: Node | null;
          while ((nn = w.nextNode())) processInspectorNode(nn);
        }
      }
      // Text node edited in place
      if (mut.type === "characterData") processInspectorNode(mut.target);
    }
  });

  inspectorObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log(
    "%c[Poker] [Inspector] Started — every match logs immediately. Use Report when ready.",
    "color:#a78bfa;font-weight:bold",
  );
}

function stopActionInspector() {
  inspectorObserver?.disconnect();
  inspectorObserver = null;
  console.log(`[Poker] [Inspector] Stopped. Total matches: ${inspectorMatchCount}.`);
}

function reportActionInspector() {
  if (inspectorHits.size === 0) {
    console.warn("[Poker] [Inspector] No matches yet — wait for opponents to act.");
    return;
  }
  const sorted = Array.from(inspectorHits.entries())
    .map(([sel, d]) => ({ sel, ...d }))
    .sort((a, b) => b.count - a.count || a.minDepth - b.minDepth);

  console.group(`[Poker] [Inspector] Report — ${inspectorMatchCount} total matches`);
  console.log("Rank  Selector                                             Hits    Depth  Example");
  sorted.slice(0, 15).forEach(({ sel, count, minDepth, examples }, i) => {
    console.log(
      `#${i + 1}`.padEnd(6),
      sel.padEnd(53),
      String(count).padEnd(8),
      String(minDepth).padEnd(7),
      examples[0] ?? "",
    );
  });
  console.groupEnd();

  const best = sorted[0];
  console.log(
    `%c[Inspector] Best: "${best.sel}" (${best.count} hits, depth ${best.minDepth})`,
    "color:#4ade80;font-weight:bold",
  );
  if (best.bestPath.length > 1) {
    console.log(`%c  Full path: ${best.bestPath.join(" > ")}`, "color:#60a5fa");
  }
  console.log(`%c  querySelectorAll("${best.sel}")`, "color:#60a5fa");

  chrome.runtime.sendMessage({
    type: "ACTION_INSPECTOR_RESULT",
    best: best.sel,
    hits: best.count,
    depth: best.minDepth,
    example: best.examples[0] ?? "",
    all: sorted.slice(0, 5).map(({ sel, count, minDepth, examples }) => ({
      sel, count, minDepth, example: examples[0] ?? "",
    })),
  });
}


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
    // Collect ALL leaf spans (no child spans) and join them — this captures split labels like
    // ["Raise To", "€1.25"] as a single string "Raise To €1.25".
    // Pre-action toggles (e.g. "Check/Fold", "Fold/Check") are also .base-button — skip them
    // by detecting the "/" separator; real action buttons never have slashes in their label.
    const spans = btn.querySelectorAll("span");
    const leafTexts: string[] = [];
    for (const s of spans) {
      if (s.querySelector("span") === null) {
        const t = s.textContent?.trim() ?? "";
        if (t) leafTexts.push(t);
      }
    }
    // Deduplicate consecutive identical entries (Playtech aria duplication: "Fold","Fold" → "Fold")
    const deduped = leafTexts.filter((t, i) => i === 0 || t !== leafTexts[i - 1]);
    const fallbackText = btn.textContent?.trim() ?? "";
    let text = deduped.join(" ") || fallbackText;
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
  /** CSS class suffix from .player-left-wing-color, e.g. "maniac" | "normal" | "tight" */
  vpipClass: string | null;
  /** CSS class suffix from .player-right-wing-color, e.g. "passive" | "aggressive" | "normal" */
  afClass: string | null;
}

/**
 * Stats scraped from the HUD popup (triggered by hovering over a player's HUD wings).
 * Contains per-hand action history and extended stats (PFR, 3BET, ATS).
 */
interface PopupStats {
  seat: number;
  hands: number | null;
  pfr: number | null;
  threeBet: number | null;
  ats: number | null;
  actionHistory: {
    preflop: string; // e.g. "Raise" or "Call → Raise"
    flop: string;
    turn: string;
    river: string;
  };
}

let statDebugLogged = false;

/**
 * Scrape per-seat HUD stats directly from the poker client's wing elements.
 *
 * DOM structure (per .player-area.player-seat-N):
 *   .player-left-wing-color.hud_vpip_<class>          ← VPIP archetype
 *   .hud-wings-value-wrapper:not(.right) .hud-wings-value  ← VPIP %
 *   .player-right-wing-color.hud_aggression_<class>   ← AF archetype
 *   .hud-wings-value-wrapper.right .hud-wings-value    ← AF %
 */
function scrapeHudStats(): DomPlayerStat[] {
  const results: DomPlayerStat[] = [];
  document.querySelectorAll(".player-area").forEach((area) => {
    const seatMatch = area.className.match(/player-seat-(\d+)/);
    if (!seatMatch) return;
    const seat = parseInt(seatMatch[1], 10);

    // VPIP % — left wing value wrapper (no "right" class)
    const vpipEl = area.querySelector(".hud-wings-value-wrapper:not(.right) .hud-wings-value");
    const vpipRaw = vpipEl?.textContent?.trim().replace("%", "") ?? "";
    const vpip = vpipRaw ? parseFloat(vpipRaw) : null;

    // AF % — right wing value wrapper (has "right" class)
    const afEl = area.querySelector(".hud-wings-value-wrapper.right .hud-wings-value");
    const afRaw = afEl?.textContent?.trim().replace("%", "") ?? "";
    const af = afRaw ? parseFloat(afRaw) : null;

    // CSS class archetypes — extract the suffix after "hud_vpip_" / "hud_aggression_"
    const leftWing = area.querySelector(".player-left-wing-color");
    const vpipClassMatch = leftWing?.className.match(/hud_vpip_(\w+)/);
    const vpipClass = vpipClassMatch ? vpipClassMatch[1] : null;

    const rightWing = area.querySelector(".player-right-wing-color");
    const afClassMatch = rightWing?.className.match(/hud_aggression_(\w+)/);
    const afClass = afClassMatch ? afClassMatch[1] : null;

    results.push({
      seat,
      vpip: vpip !== null && !isNaN(vpip) ? vpip : null,
      af:   af   !== null && !isNaN(af)   ? af   : null,
      vpipClass,
      afClass,
    });
  });

  // One-time debug log
  if (!statDebugLogged) {
    statDebugLogged = true;
    const hasAny = results.some((s) => s.vpip !== null || s.vpipClass !== null);
    if (hasAny) {
      console.log("[Poker] HUD stats scraped:", results);
    } else {
      const firstArea = document.querySelector(".player-area");
      console.log(
        "[Poker] HUD stats not found. First .player-area snippet:",
        firstArea?.innerHTML?.slice(0, 600) ?? "(none)",
      );
    }
  }

  return results;
}

/** @deprecated use scrapeHudStats() */
function scrapeTableStats(): DomPlayerStat[] {
  return scrapeHudStats();
}

/**
 * Hover over a player's HUD wings, wait for the popup to render, parse its contents,
 * and dismiss the hover. Returns null when no hover-trigger exists for the seat.
 *
 * Popup DOM structure (confirmed):
 *   .hud-tooltip
 *     .player-hud-popup-wrapper
 *       .player-hud-popup
 *         .player-hud-general-stats-wrapper   ← stat rows (PFR, 3BET, ATS…) + hands count
 *         .player-hud-action-history-wrapper
 *           .hud-action-history-round-wrapper  ← one per street
 *             .hud-action-history-round-name   ← "Pre-flop:", "Flop:", "Turn:", "River:"
 *             .hud-action-history-round-actions ← e.g. "Call" or "Check → Bet"
 */
async function scrapePopupStats(seat: number): Promise<PopupStats | null> {
  // Try both selector forms — some seats may be nested differently
  const trigger =
    document.querySelector(`.player-area.player-seat-${seat} .hover-trigger`) ??
    document.querySelector(`.player-seat-${seat} .hover-trigger`);

  if (!trigger) {
    console.log(`[Poker] No hover-trigger for seat ${seat} — skipping popup scrape`);
    return null;
  }

  trigger.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  trigger.dispatchEvent(new MouseEvent("mouseover",  { bubbles: true }));
  await new Promise<void>((resolve) => setTimeout(resolve, 700));

  const popup = document.querySelector(".hud-tooltip");
  if (!popup) {
    trigger.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent("mouseout",   { bubbles: true }));
    return null;
  }

  // Hands count
  const handsEl = popup.querySelector(".player-hud-hands-value");
  const handsRaw = handsEl?.textContent?.trim() ?? "";
  const hands = handsRaw && !isNaN(parseInt(handsRaw, 10)) ? parseInt(handsRaw, 10) : null;

  // Extended stats — search for leaf elements whose text matches a stat label,
  // then read the adjacent sibling or last sibling in the parent for the value.
  function readStat(label: string): number | null {
    for (const el of Array.from(popup!.querySelectorAll("*"))) {
      if (el.children.length > 0) continue; // leaf nodes only
      const text = el.textContent?.trim().toUpperCase() ?? "";
      if (text !== label.toUpperCase()) continue;
      // Try next sibling element
      const sib = el.nextElementSibling;
      if (sib) {
        const v = parseFloat(sib.textContent?.trim().replace("%", "") ?? "");
        if (!isNaN(v)) return v;
      }
      // Try last child of parent
      const parent = el.parentElement;
      if (parent) {
        const last = parent.children[parent.children.length - 1];
        if (last && last !== el) {
          const v = parseFloat(last.textContent?.trim().replace("%", "") ?? "");
          if (!isNaN(v)) return v;
        }
      }
    }
    return null;
  }

  const pfr      = readStat("PFR%") ?? readStat("PFR");
  const threeBet = readStat("3BET%") ?? readStat("3BET");
  const ats      = readStat("ATS%") ?? readStat("ATS");

  // Per-street action history
  const actionHistory = { preflop: "", flop: "", turn: "", river: "" };
  popup.querySelectorAll(".hud-action-history-round-wrapper").forEach((row) => {
    const name    = row.querySelector(".hud-action-history-round-name")?.textContent?.trim().toLowerCase() ?? "";
    const actions = row.querySelector(".hud-action-history-round-actions")?.textContent?.trim() ?? "";
    if (name.includes("pre-flop") || name.includes("preflop")) actionHistory.preflop = actions;
    else if (name.includes("flop"))  actionHistory.flop  = actions;
    else if (name.includes("turn"))  actionHistory.turn  = actions;
    else if (name.includes("river")) actionHistory.river = actions;
  });

  trigger.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
  trigger.dispatchEvent(new MouseEvent("mouseout",   { bubbles: true }));

  console.log(`[Poker] Popup stats seat ${seat}: hands=${hands}, pfr=${pfr}, actionHistory=`, actionHistory);
  return { seat, hands, pfr, threeBet, ats, actionHistory };
}

/**
 * Collect HUD popup stats for all active opponents at hand start.
 * Runs serially (one hover at a time) to avoid stacking popups.
 * Results stored in handPopupStats — fire-and-forget.
 */
async function collectAllPopupStats(state: GameState): Promise<void> {
  handPopupStats = {};
  for (const p of state.players) {
    if (p.seat === state.heroSeat || !p.name || !p.hasCards) continue;
    const stats = await scrapePopupStats(p.seat);
    if (stats) handPopupStats[p.seat] = stats;
    // Brief pause between seats so React can settle between hovers
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }
  if (Object.keys(handPopupStats).length > 0) {
    console.log("[Poker] Popup stats collected for", Object.keys(handPopupStats).length, "opponents");
  }
}

type TableTemperatureLocal =
  | "tight_passive"
  | "tight_aggressive"
  | "loose_passive"
  | "loose_aggressive"
  | "balanced"
  | "unknown";

// Maps hud_vpip_* CSS class suffix → loose/tight signal (null = use VPIP %)
const VPIP_CLASS_LOOSE: Record<string, boolean> = {
  maniac:           true,
  fish:             true,
  loose_aggressive: true,
  loose_passive:    true,
  loose:            true,
  tight_aggressive: false,
  tight_passive:    false,
  tight:            false,
  nit:              false,
  rock:             false,
};

// Maps hud_aggression_* CSS class suffix → aggressive signal (null = use AF %)
const AF_CLASS_AGGRESSIVE: Record<string, boolean> = {
  aggressive: true,
  maniac:     true,
  passive:    false,
  normal:     false, // treat "normal" as not-aggressive for exploit purposes
};

function deriveTemperatureFromDomStats(
  stats: DomPlayerStat[],
  heroSeat: number,
): TableTemperatureLocal {
  const opponents = stats.filter((s) => s.seat !== heroSeat);
  if (opponents.length === 0) return "unknown";

  // Prefer CSS class signal when available (more reliable than noisy % values)
  const classSignals = opponents
    .filter((s) => s.vpipClass !== null)
    .map((s) => ({
      loose: VPIP_CLASS_LOOSE[s.vpipClass!] ?? null,
      aggressive: s.afClass !== null ? (AF_CLASS_AGGRESSIVE[s.afClass!] ?? null) : null,
    }))
    .filter((x) => x.loose !== null);

  if (classSignals.length >= 2) {
    const looseCount = classSignals.filter((x) => x.loose).length;
    const isLoose = looseCount > classSignals.length / 2;
    const aggressiveCount = classSignals.filter((x) => x.aggressive === true).length;
    const passiveCount    = classSignals.filter((x) => x.aggressive === false).length;
    const isAggressive = aggressiveCount > passiveCount ? true
                       : passiveCount > aggressiveCount ? false
                       : null;
    if (isLoose) return isAggressive === false ? "loose_passive" : "loose_aggressive";
    return isAggressive ? "tight_aggressive" : "tight_passive";
  }

  // Fallback: use numeric VPIP/AF percentages
  const withVpip = opponents.filter((s) => s.vpip !== null);
  if (withVpip.length === 0) return "unknown";

  const avgVpip = withVpip.reduce((sum, s) => sum + s.vpip!, 0) / withVpip.length;
  const withAf  = opponents.filter((s) => s.af !== null);
  const avgAf   = withAf.length > 0
    ? withAf.reduce((sum, s) => sum + s.af!, 0) / withAf.length
    : null;

  const isTight = avgVpip < 22;
  const isLoose = avgVpip > 30;
  // AF% in this client appears to be a percentage (not a ratio), so >50% = aggressive
  const isAggressive = avgAf !== null ? avgAf > 50 : null;

  if (!isTight && !isLoose) return "balanced";
  if (isTight) return isAggressive === false ? "tight_passive" : "tight_aggressive";
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
          ? ` — SUITED (both ${SUIT_NAMES[c1.slice(-1)] ?? c1.slice(-1)})`
          : ` — OFFSUIT (${SUIT_NAMES[c1.slice(-1)] ?? c1.slice(-1)} and ${SUIT_NAMES[c2.slice(-1)] ?? c2.slice(-1)})`
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

  // Inject HUD popup action history — available after collectAllPopupStats fires at hand start
  const popupSeats = Object.keys(handPopupStats).map(Number);
  if (popupSeats.length > 0) {
    const historyLines: string[] = [];
    for (const seat of popupSeats) {
      const ps = handPopupStats[seat];
      const p = state.players.find((pl) => pl.seat === seat);
      const name = p?.name ?? `Seat ${seat}`;
      const parts: string[] = [];
      if (ps.actionHistory.preflop) parts.push(`pre-flop: ${ps.actionHistory.preflop}`);
      if (ps.actionHistory.flop)    parts.push(`flop: ${ps.actionHistory.flop}`);
      if (ps.actionHistory.turn)    parts.push(`turn: ${ps.actionHistory.turn}`);
      if (ps.actionHistory.river)   parts.push(`river: ${ps.actionHistory.river}`);
      if (parts.length > 0) {
        const handsNote = ps.hands !== null ? ` (${ps.hands} hands)` : "";
        historyLines.push(`${name}${handsNote}: ${parts.join(", ")}`);
      }
    }
    if (historyLines.length > 0) {
      lines.push("Opponent action history this hand:\n" + historyLines.join("\n"));
    }
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

// ── API ─────────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:3006";
const PERSONA_API_URL = `${API_BASE}/api/persona`;

/** Fetch opponent stats and cache villain range for a seat. Fire-and-forget pattern. */
async function fetchOpponentStats(seat: number, username: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/stats?username=${encodeURIComponent(username)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.stats) {
      seatStats[seat] = data.stats;
      console.log(`[Poker] Opponent stats for seat ${seat} (${username}):`, data.stats);
    }
  } catch {
    // Server not running or network error — silently skip
  }
}

/** Fetch range equity from /api/equity. Returns null on timeout/error (fall back to outs-based). */
async function fetchRangeEquity(
  heroCards: string[],
  communityCards: string[],
  villainCombos: string[],
): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout
  try {
    const res = await fetch(`${API_BASE}/api/equity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ heroCards, communityCards, villainCombos }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.equity === "number" ? data.equity : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Persona Request ────────────────────────────────────────────────────

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
 * Apply the local rule tree for post-flop spots.
 * Returns null only when called pre-flop (< 3 community cards) or no hero cards.
 */
function localDecide(
  state: GameState,
  extra?: { rangeEquity?: number; gtoHint?: import("../../lib/poker/gto/types").GtoEntry | null },
): LocalDecision | null {
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
      rangeEquity: extra?.rangeEquity,
      villainRange: opponentVillainRange,
      gtoHint: extra?.gtoHint,
    });
  } catch (err) {
    console.error("[Poker] localDecide() threw:", err);
    return null;
  }
}

/** Same context extraction as localDecide, but returns all 4 persona decisions. */
function localDecideAllPersonas(state: GameState): PersonaPostflopDecision[] | null {
  if (state.communityCards.length < 3 || state.heroCards.length === 0) return null;

  const temperature = lastTableTemperature ?? { dominantType: "unknown" as TableTemperatureLocal, handsObserved: 0 };
  const heroPlayer = state.players.find((p) => p.seat === state.heroSeat);
  if (!heroPlayer) return null;

  const heroStack = parseCurrency(heroPlayer.stack);
  const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
  const opponents = activePlayers.filter((p) => p.seat !== state.heroSeat);
  const opponentStacks = opponents.map((p) => parseCurrency(p.stack)).filter((s) => s > 0);
  const minOpponentStack = opponentStacks.length > 0 ? Math.min(...opponentStacks) : heroStack;
  const effectiveStack = Math.min(heroStack, minOpponentStack);

  const callAction = state.availableActions.find((a) => a.type === "CALL");
  const callAmount = parseCurrency(callAction?.amount);
  const facingBet = callAmount > 0;

  const rawPosition = getPosition(state.heroSeat, state.dealerSeat, activePlayers.length);
  const position = rawPosition === "BTN/SB" ? "BTN" : rawPosition;
  const pot = parseCurrency(state.pot);

  const opponentType = TEMPERATURE_TO_OPPONENT_TYPE[temperature.dominantType];
  const handsObserved = temperature.handsObserved;

  return applyRuleTreeAllPersonas({
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

/** Find the bet/raise amount input using all known Playtech selector variants. */
function findBetInput(): HTMLInputElement | null {
  return (
    document.querySelector<HTMLInputElement>(".betInput") ??
    document.querySelector<HTMLInputElement>("[data-bet-input]") ??
    document.querySelector<HTMLInputElement>(".actions-area input[type='number']") ??
    document.querySelector<HTMLInputElement>(".actions-area input[type='text']") ??
    document.querySelector<HTMLInputElement>("[class*='raise'] input") ??
    document.querySelector<HTMLInputElement>("[class*='bet-amount'] input")
  );
}

/**
 * Set a controlled input's value in a way that works with React/Vue event systems.
 * Uses the native HTMLInputElement setter so React's synthetic event system picks it up.
 */
function setBetInputValue(input: HTMLInputElement, value: number): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  const str = value.toFixed(2);
  if (nativeSetter) {
    nativeSetter.call(input, str);
  } else {
    input.value = str;
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
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
    if (decision.action === "RAISE" || decision.action === "BET") {
      // Find the raise/bet button — if absent (only fold+call available) fall back
      button = findActionButton(decision.action);
      if (!button) {
        console.warn(`[Poker] ${decision.action} button not found — falling back to CALL/CHECK`);
        button = findActionButton("CALL") ?? findActionButton("CHECK") ?? findActionButton("FOLD");
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

    // Show pending action in overlay BEFORE the humanDelay so the user can see
    // exactly what is about to be executed (amount, action type, pot context).
    if (autopilotMode === "play") {
      pendingPlayAction = decision;
      if (lastState) updateOverlay(lastState);
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
      button = findActionButton(decision.action);
      if (!button) {
        console.error("[Poker] Button lost after delay, aborting");
        return;
      }
    }

    // For RAISE/BET: must set bet input to the desired amount — no slider fallback.
    // If the input can't be found or the amount is unknown, abort and let the human act.
    // The input may not be rendered yet (Playtech animates buttons); retry up to 3×100ms.
    if (decision.action === "RAISE" || decision.action === "BET") {
      if (decision.amount === null) {
        console.warn(`[Poker] ${decision.action} has no amount — requires human input`);
        return;
      }
      let betInput = findBetInput();
      if (!betInput) {
        for (let i = 0; i < 3 && !betInput; i++) {
          await new Promise((r) => setTimeout(r, 100));
          betInput = findBetInput();
        }
      }
      if (betInput) {
        const min = parseFloat(betInput.min || "0");
        const max = parseFloat(betInput.max || "999999");
        const clamped = Math.min(
          Number.isFinite(max) ? max : 999999,
          Math.max(Number.isFinite(min) ? min : 0, decision.amount),
        );
        setBetInputValue(betInput, clamped);
        console.log(`[Poker] Set bet input: €${clamped.toFixed(2)} (range [${min}, ${max}])`);
        // Wait for React to re-render the button label with the updated amount
        await new Promise((r) => setTimeout(r, 150));
        // Re-find button — label may have changed ("Raise To €0.60" etc.)
        button = findActionButton(decision.action) ?? button;
      } else {
        console.warn(`[Poker] Bet input not found — ${decision.action} €${decision.amount.toFixed(2)} requires human input`);
        return; // abort; overlay already shows the recommendation
      }
    }

    simulateClick(button);
  } finally {
    executing = false;
    pendingPlayAction = null;
    if (lastState) updateOverlay(lastState);
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

  // Check if hero is currently facing a raise — the fast-path only handles RFI spots,
  // so any decision arriving while facing a raise is a legitimate explicit request.
  const heroFacingRaiseNow = lastState?.availableActions.some(
    (a) => a.type === "CALL" && parseFloat((a.amount ?? "0").replace(/[€$£,]/g, "")) > 0,
  ) ?? false;

  // If the preflop persona chart fast-path already fired, the Claude pre-fetch is stale.
  // Discard it in both monitor and play mode — the same race exists in both.
  // Exception: hero is facing a raise → fast-path was bypassed, this is a real decision.
  if (preflopFastPathFired && !heroFacingRaiseNow) {
    console.log(`[Poker] [${autopilotMode.toUpperCase()}] Discarding stale pre-fetch — preflop fast-path already acted`);
    executing = false;
    return;
  }

  // Also discard if we're still preflop and persona is loaded but the fast-path hasn't
  // fired yet. The fast-path handles RFI spots; when hero is facing a raise the fast-path
  // is skipped, so we must request a fresh Claude decision instead of just discarding.
  if (lastPersonaRec && lastState && lastState.communityCards.length === 0 && !heroFacingRaiseNow) {
    console.log(`[Poker] [${autopilotMode.toUpperCase()}] Discarding pre-fetch — persona chart will handle preflop`);
    executing = false;
    return;
  }

  // Pre-fetch arrived while hero is facing a raise preflop — it's based on pre-raise state.
  // Discard and request a fresh decision with the current pot/action info.
  if (lastPersonaRec && lastState && lastState.communityCards.length === 0 && heroFacingRaiseNow && !preflopFastPathFired) {
    executing = false;
    if (lastState.isHeroTurn && handMessages.length > 0) {
      console.log(`[Poker] [${autopilotMode.toUpperCase()}] Pre-fetch discarded — facing raise, requesting fresh decision`);
      const turnMsg = buildTurnMessage(lastState);
      if (turnMsg.trim()) handMessages.push({ role: "user", content: turnMsg });
      requestDecision([...handMessages]);
    }
    return;
  }

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

  // CHECK is truly free only when CHECK is available AND CALL is not.
  // If both appear, the pre-action "Check" toggle is active but CALL is the real decision.
  // Hoisted here so both persona section (post-flop) and AI advice line can share it.
  const checkFree = state.availableActions.some(a => a.type === "CHECK") &&
                    !state.availableActions.some(a => a.type === "CALL");
  // Live call amount for display (e.g. "CALL €1.50") when rule tree returns null amount.
  const liveCallStr = state.availableActions.find(a => a.type === "CALL")?.amount ?? null;

  let personaHtml = "";
  if (lastPersonaRec?.allPersonas.length) {
    if (isPreflop) {
      // Show why this persona was selected
      const selectionTag = lastPersonaRec.rotated
        ? "rotating"
        : lastPersonaRec.temperature !== "unknown"
          ? lastPersonaRec.temperature.replaceAll("_", "-")
          : "best";
      // checkFree is now hoisted above
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
      // Post-flop: show all 4 persona rows (mirrors preflop layout)
      if (allPostflopDecisions?.length) {
        const rows = allPostflopDecisions.map(p => {
          const isSelected = p.name === lastPersonaRec.name;
          const pfAction = p.action === "FOLD" && checkFree ? "CHECK" : p.action;
          const amountStr = p.amount != null
            ? ` €${p.amount.toFixed(2)}`
            : (pfAction === "CALL" && liveCallStr ? ` ${liveCallStr}` : "");
          const actionStr = pfAction + amountStr;
          const actionColor = (pfAction === "RAISE" || pfAction === "BET") ? "#4ade80"
            : pfAction === "CALL" ? "#fbbf24"
            : pfAction === "FOLD" ? "#ef4444"
            : "#9ca3af";
          const prefix = isSelected ? `<span style="color:#818cf8">★</span>` : `<span style="color:#3f3f46">·</span>`;
          const nameStyle = isSelected ? "color:#e4e4e7;font-weight:bold" : "color:#52525b";
          const reasonSnip = isSelected && p.reasoning
            ? ` <span style="color:#3f3f46;font-size:10px">${escapeHtml(p.reasoning.slice(0, 50))}${p.reasoning.length > 50 ? "…" : ""}</span>`
            : "";
          return `<div>${prefix} <span style="${nameStyle}">${escapeHtml(p.name)}</span> → <span style="color:${actionColor};font-weight:${isSelected ? "bold" : "normal"}">${escapeHtml(actionStr)}</span>${reasonSnip}</div>`;
        }).join("");
        personaHtml = `<div style="border-top:1px solid #3f3f46;margin-top:6px;padding-top:6px">${rows}</div>`;
      } else {
        personaHtml = `<div style="border-top:1px solid #3f3f46;margin-top:6px;padding-top:6px;color:#52525b">Playing as: <span style="color:#818cf8;font-weight:bold">${escapeHtml(lastPersonaRec.name)}</span> <span style='color:#52525b'>(waiting…)</span></div>`;
      }
    }
  } else if (!isPreflop && allPostflopDecisions?.length) {
    // Post-flop without a loaded persona — still show all 4 rows, no ★
    const rows = allPostflopDecisions.map(p => {
      const pfAction = p.action === "FOLD" && checkFree ? "CHECK" : p.action;
      const amountStr = p.amount != null ? ` €${p.amount.toFixed(2)}` : (pfAction === "CALL" && liveCallStr ? ` ${liveCallStr}` : "");
      const actionColor = (pfAction === "RAISE" || pfAction === "BET") ? "#4ade80" : pfAction === "CALL" ? "#fbbf24" : pfAction === "FOLD" ? "#ef4444" : "#9ca3af";
      return `<div><span style="color:#3f3f46">·</span> <span style="color:#52525b">${escapeHtml(p.name)}</span> → <span style="color:${actionColor}">${escapeHtml(pfAction + amountStr)}</span></div>`;
    }).join("");
    personaHtml = `<div style="border-top:1px solid #3f3f46;margin-top:6px;padding-top:6px">${rows}</div>`;
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
  // Apply FOLD→CHECK override at display time — covers the race where buttons hadn't
  // rendered when safeExecuteAction ran (the DOM guard fires on stale button list).
  const monitorActionDisplay = monitorAdvice && monitorAdvice.action === "FOLD" && checkFree
    ? "CHECK"
    : monitorAdvice?.action;
  const monAdviceRec = monitorAdvice && !isMonitorError
    ? monitorActionDisplay + (
        monitorAdvice.amount != null
          ? ` €${monitorAdvice.amount.toFixed(2)}`
          : (monitorAdvice.action === "CALL" && liveCallStr ? ` ${liveCallStr}` : "")
      )
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

  // Pending play-mode action banner — shown during humanDelay so user sees exactly
  // what is about to execute with full amount and pot context before the click.
  const pot = parseCurrency(state.pot);
  let pendingHtml = "";
  if (pendingPlayAction && autopilotMode === "play") {
    const pa = pendingPlayAction;
    const paAction = pa.action === "FOLD" && checkFree ? "CHECK" : pa.action;
    const paAmountStr = pa.amount != null
      ? ` €${pa.amount.toFixed(2)}`
      : (paAction === "CALL" && liveCallStr ? ` ${liveCallStr}` : "");
    const paPotPct = pa.amount != null && pot > 0
      ? ` (${Math.round(pa.amount / pot * 100)}% pot)`
      : "";
    const paColor = (paAction === "RAISE" || paAction === "BET") ? "#4ade80"
      : paAction === "CALL" ? "#fbbf24"
      : paAction === "FOLD" ? "#ef4444"
      : "#9ca3af";
    pendingHtml = `<div style="background:#1c1917;border:1px solid ${paColor};border-radius:4px;padding:6px 8px;margin-bottom:6px">
      <span style="color:#71717a;font-size:10px">AUTO ▶ </span>
      <span style="color:${paColor};font-weight:bold;font-size:14px">${escapeHtml(paAction + paAmountStr)}</span>
      <span style="color:#52525b;font-size:10px">${escapeHtml(paPotPct)}</span>
      <div style="color:#52525b;font-size:10px;margin-top:2px">${escapeHtml(pa.reasoning.slice(0, 80))}${pa.reasoning.length > 80 ? "…" : ""}</div>
    </div>`;
  }

  el.innerHTML = `
    ${pendingHtml}<div style="color:${modeColor};font-weight:bold;margin-bottom:4px">${modeLabel}</div>
    <div>Hand: ${escapeHtml(state.handId || "—")}</div>
    <div>Hero: <b>${hero}</b></div>
    <div>Board: ${board}</div>
    <div>Pot: ${escapeHtml(state.pot || "—")}</div>
    <div>Turn: <span style="color:${turnColor}">${turn}</span></div>
    <div>Actions: ${actions}</div>
    <div style="color:#71717a;margin-top:4px">Players: ${state.players.filter((p) => p.name).length}</div>
    ${lastDecisionSource || lastRangeEquity !== null ? `<div style="color:#71717a;margin-top:2px">Engine: <span style="color:#a78bfa">${escapeHtml(lastDecisionSource ?? "—")}</span>${lastRangeEquity !== null ? ` | Equity: <span style="color:#38bdf8">${Math.round(lastRangeEquity * 100)}%</span>` : ""}</div>` : ""}
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

async function processGameState() {
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

  // Secondary new-hand signal: hero cards changed completely while no board is showing.
  // Only fires preflop (communityCards empty) to avoid mid-hand detection glitches
  // triggering a spurious reset during flop/turn/river animation.
  const prevHeroCards = lastState?.heroCards ?? [];
  const heroCardsReplaced =
    state.heroCards.length >= 2 &&
    prevHeroCards.length >= 2 &&
    state.communityCards.length === 0 &&   // preflop only — board absent between hands
    !state.heroCards.every((c) => prevHeroCards.includes(c));
  if (heroCardsReplaced && state.handId === currentHandId) {
    console.log("[Poker] New hand detected via card change:", state.heroCards.join(" "), "(handId unchanged)");
    currentHandId = null; // force the block below to fire
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
    allPostflopDecisions = null;
    pendingPlayAction = null;
    preflopFastPathFired = false;
    seatStats = {};
    handPopupStats = {};
    opponentVillainRange = DEFAULT_VILLAIN_RANGE;
    lastDecisionSource = null;
    lastRangeEquity = null;
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

        // Fetch opponent stats for villain range estimation (fire-and-forget)
        for (const p of state.players) {
          if (p.seat !== state.heroSeat && p.name && p.hasCards) {
            fetchOpponentStats(p.seat, p.name);
          }
        }

        // Collect HUD popup stats for all opponents (fire-and-forget)
        collectAllPopupStats(state);
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
    // Guard: preflop only, hero is opening (not facing a raise)
    const isPreflop = state.communityCards.length === 0;
    const facingRaise = state.availableActions.some(
      (a) => a.type === "CALL" && parseFloat((a.amount ?? "0").replace(/[€$£,]/g, "")) > 0,
    );
    if (autopilotMode !== "off" && isPreflop && !facingRaise && state.heroCards.length > 0) {
      if (lastPersonaRec) {
        // Phase 1a — persona recommendation available
        const personaAction = lastPersonaRec.action.toUpperCase() as AutopilotAction["action"];
        if (["FOLD", "CALL", "RAISE", "BET", "CHECK"].includes(personaAction)) {
          executing = true;
          preflopFastPathFired = true; // prevent stale pre-fetch from overwriting this advice
          // Compute a strategic raise size from BB rather than reading the DOM slider
          // (action buttons may not be rendered yet when the fast-path fires).
          // BB is read from the BB player's posted bet — exact regardless of limpers/antes.
          // Falls back to pot / 1.5 only when the BB player has no visible bet yet.
          let preflopAmount: number | null = null;
          let bb: number | null = null;
          if (personaAction === "RAISE" || personaAction === "BET") {
            const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
            const rawPos = getPosition(state.heroSeat, state.dealerSeat, activePlayers.length);
            const pos = rawPos === "BTN/SB" ? "BTN" : rawPos;
            // Late position (BTN/CO): open 2.5×BB; early/mid/SB: open 3×BB
            const multiplier = ["BTN", "CO"].includes(pos) ? 2.5 : 3.0;
            const bbPlayer = state.players.find(
              (p) => p.name && getPosition(p.seat, state.dealerSeat, activePlayers.length) === "BB"
            );
            const bbFromPlayer = bbPlayer ? parseCurrency(bbPlayer.bet) : 0;
            if (bbFromPlayer > 0) {
              bb = bbFromPlayer;
            } else {
              // Fallback 1: SB bet × 2 — always a round number, reliable when BB hasn't posted yet
              const sbPlayer = state.players.find(
                (p) => p.name && getPosition(p.seat, state.dealerSeat, activePlayers.length) === "SB"
              );
              const sbBet = sbPlayer ? parseCurrency(sbPlayer.bet) : 0;
              if (sbBet > 0) {
                bb = sbBet * 2;
                console.warn("[Poker] [Preflop] BB player bet not visible — using SB × 2:", bb);
              } else {
                // Fallback 2: scrape table stakes element (e.g. "€1/€2")
                const stakesEl = document.querySelector(
                  "[class*='stake'], [class*='blind'], [class*='limit'], .table-title, .game-title, .game-info"
                );
                const stakesText = stakesEl?.textContent ?? "";
                const stakesMatch = stakesText.match(/[€$£]([\d.]+)\s*[/\\]\s*[€$£]([\d.]+)/);
                if (stakesMatch) {
                  bb = parseFloat(stakesMatch[2]);
                  console.warn("[Poker] [Preflop] BB player bet not visible — using stakes DOM:", bb);
                } else {
                  console.warn("[Poker] [Preflop] BB unknown — skipping raise sizing");
                  // bb stays null; preflopAmount will be null; executeAction will abort (amount required for RAISE)
                }
              }
            }
            if (bb !== null && bb > 0) {
              preflopAmount = Math.round(bb * multiplier * 100) / 100;
            }
          }
          const bbTag = preflopAmount != null && bb != null
            ? ` (${(preflopAmount / bb).toFixed(1)}BB)`
            : "";
          const reasoning = `Preflop chart: ${lastPersonaRec.name}${bbTag}`;
          console.log(`[Poker] [Local/Preflop] ${lastPersonaRec.name} → ${personaAction}${preflopAmount != null ? ` €${preflopAmount.toFixed(2)}${bbTag}` : ""} (confidence 1.0)`);
          safeExecuteAction(
            { action: personaAction, amount: preflopAmount, reasoning },
            "local",
          );

          // Store preflop fast-path decision as a hand record (fire-and-forget)
          {
            const activePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
            const rawPos = getPosition(state.heroSeat, state.dealerSeat, activePlayers.length);
            const pos = rawPos === "??" ? "CO" : rawPos === "BTN/SB" ? "BTN" : rawPos;
            const heroPlayer = state.players.find((p) => p.seat === state.heroSeat);
            chrome.runtime.sendMessage({
              type: "PREFLOP_RECORD",
              payload: {
                heroCards: state.heroCards,
                position: pos,
                potSize: state.pot ?? null,
                heroStack: heroPlayer?.stack ?? null,
                action: personaAction,
                amount: preflopAmount,
                reasoning,
                personaName: lastPersonaRec.name,
                handContext: handMessages[0]?.content ?? null,
                pokerHandId: state.handId ?? null,
                tableTemperature: lastTableTemperature ?? null,
                tableReads: null,
              },
            });
          }

          lastHeroTurn = state.isHeroTurn;
          lastState = state;
          return;
        }
      } else {
        // Phase 1b — RFI fallback: persona server unavailable, use inline chart
        const p1bActivePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
        const p1bRawPos = getPosition(state.heroSeat, state.dealerSeat, p1bActivePlayers.length);
        const p1bPos = p1bRawPos === "BTN/SB" ? "BTN" : p1bRawPos === "??" ? "CO" : p1bRawPos;
        const p1bBbPlayer = state.players.find(
          (p) => p.name && getPosition(p.seat, state.dealerSeat, p1bActivePlayers.length) === "BB"
        );
        let p1bBb = p1bBbPlayer ? parseCurrency(p1bBbPlayer.bet) : 0;
        if (p1bBb <= 0) {
          const p1bSbPlayer = state.players.find(
            (p) => p.name && getPosition(p.seat, state.dealerSeat, p1bActivePlayers.length) === "SB"
          );
          const p1bSbBet = p1bSbPlayer ? parseCurrency(p1bSbPlayer.bet) : 0;
          if (p1bSbBet > 0) {
            p1bBb = p1bSbBet * 2;
          } else {
            const stakesEl = document.querySelector(
              "[class*='stake'], [class*='blind'], [class*='limit'], .table-title, .game-title, .game-info"
            );
            const stakesText = stakesEl?.textContent ?? "";
            const stakesMatch = stakesText.match(/[€$£]([\d.]+)\s*[/\\]\s*[€$£]([\d.]+)/);
            if (stakesMatch) p1bBb = parseFloat(stakesMatch[2]);
          }
        }
        const p1bDecision = rfiDecision(state.heroCards, p1bPos, p1bBb);
        if (p1bDecision) {
          executing = true;
          preflopFastPathFired = true;
          console.log(`[Poker] [Local/Preflop/RFI] ${p1bPos} → ${p1bDecision.action}${p1bDecision.amount != null ? ` €${p1bDecision.amount.toFixed(2)}` : ""} (confidence ${p1bDecision.confidence.toFixed(2)}) — ${p1bDecision.reasoning}`);
          safeExecuteAction(
            { action: p1bDecision.action, amount: p1bDecision.amount, reasoning: p1bDecision.reasoning },
            "local",
          );
          lastHeroTurn = state.isHeroTurn;
          lastState = state;
          return;
        }
      }
    }

    // Phase 2 — Preflop facing raise/limp/3-bet: local chart routing
    if (autopilotMode !== "off" && isPreflop && facingRaise && state.heroCards.length > 0) {
      const callOpt = state.availableActions.find((a) => a.type === "CALL");
      const frCallAmount = parseCurrency(callOpt?.amount);
      const frPot = parseCurrency(state.pot);
      const frActivePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
      const frRawPos = getPosition(state.heroSeat, state.dealerSeat, frActivePlayers.length);
      const frPos = frRawPos === "BTN/SB" ? "BTN" : frRawPos === "??" ? "CO" : frRawPos;

      // Classify the preflop aggression we're facing:
      //   Limp:  non-BB, callAmount/pot ≈ 0.40 (1BB into ~2.5BB pot)  → ratio < 0.50
      //   3-bet: hero already opened (preflopFastPathFired), now faces re-raise
      //   Raise: standard single open raise (default)
      const isLimp = frPos !== "BB" && frCallAmount > 0 && frPot > 0 && frCallAmount / frPot < 0.50;
      const isFacing3Bet = preflopFastPathFired; // hero opened → this is a re-raise
      const frScenario = isLimp ? "limp" : isFacing3Bet ? "3-bet" : "raise";

      const frDecision = isLimp
        ? facingLimpDecision(state.heroCards, frPos, frCallAmount, frPot)
        : isFacing3Bet
          ? facing3BetDecision(state.heroCards, frPos, frCallAmount, frPot)
          : facingRaiseDecision(state.heroCards, frPos, frCallAmount, frPot);

      if (frDecision) {
        executing = true;
        console.log(`[Poker] [Local/Preflop] Facing ${frScenario} from ${frPos}: ${frDecision.action} (confidence ${frDecision.confidence.toFixed(2)}) — ${frDecision.reasoning}`);
        safeExecuteAction(
          { action: frDecision.action, amount: frDecision.amount, reasoning: frDecision.reasoning },
          "local",
        );
        lastHeroTurn = state.isHeroTurn;
        lastState = state;
        return;
      }
    }

    // Phase 3 + 4 — Post-flop decision pipeline (GTO lookup → equity → rule tree)
    if (autopilotMode !== "off" && state.communityCards.length >= 3) {
      // Compute all-persona decisions for overlay (fire-and-forget, no blocking)
      try {
        allPostflopDecisions = localDecideAllPersonas(state);
      } catch (_) {
        allPostflopDecisions = null;
      }

      // Derive position and board for Phase 3 GTO lookup
      const pfActivePlayers = state.players.filter((p) => p.name && !p.folded && p.hasCards);
      const pfRawPos = getPosition(state.heroSeat, state.dealerSeat, pfActivePlayers.length);
      const pfPos = pfRawPos === "BTN/SB" ? "BTN" : pfRawPos === "??" ? "CO" : pfRawPos;
      const pfCallAction = state.availableActions.find((a) => a.type === "CALL");
      const pfCallAmount = parseCurrency(pfCallAction?.amount);
      const pfFacingBet = pfCallAmount > 0;

      const pfBoard = analyzeBoard(state.communityCards);
      const pfHand = evaluateHand(state.heroCards, state.communityCards);

      // Phase 3 — GTO lookup
      let gtoHint: import("../../lib/poker/gto/types").GtoEntry | null = null;
      const gtoResult = lookupGtoSpot(pfPos, pfBoard, pfHand, pfFacingBet);
      if (gtoResult.hit) {
        gtoHint = gtoResult.entry;
        // High-confidence GTO action: execute immediately without equity fetch
        if (gtoResult.entry.frequency >= 0.70) {
          const pot = parseCurrency(state.pot);
          const gtoAmount = gtoResult.entry.sizingFraction > 0
            ? Math.round(pot * gtoResult.entry.sizingFraction * 100) / 100
            : null;
          executing = true;
          lastDecisionSource = "gto";
          console.log(`[Poker] [GTO] ${gtoResult.entry.action}${gtoAmount != null ? ` €${gtoAmount.toFixed(2)}` : ""} (freq ${(gtoResult.entry.frequency * 100).toFixed(0)}%) — ${gtoResult.entry.key}`);
          safeExecuteAction(
            { action: gtoResult.entry.action, amount: gtoAmount, reasoning: `GTO: ${gtoResult.entry.key}` },
            "local",
          );
          lastHeroTurn = state.isHeroTurn;
          lastState = state;
          return;
        }
      }

      // Phase 4 — Fetch range equity (3s timeout; fallback to outs-based inside rule tree)
      // Determine main villain for range: last aggressor or first active opponent
      const pfOpponents = pfActivePlayers.filter((p) => p.seat !== state.heroSeat);
      const mainVillainSeat = pfOpponents[0]?.seat;
      if (mainVillainSeat !== undefined && seatStats[mainVillainSeat]) {
        opponentVillainRange = statsToVillainRange(seatStats[mainVillainSeat]);
      }

      const rangeEquity = await fetchRangeEquity(
        state.heroCards,
        state.communityCards,
        opponentVillainRange.combos,
      );

      if (rangeEquity !== null) {
        lastRangeEquity = rangeEquity;
      }

      const local = localDecide(state, { rangeEquity: rangeEquity ?? undefined, gtoHint });
      if (local) {
        executing = true;
        lastDecisionSource = rangeEquity !== null ? "equity" : "ruletree";
        console.log(`[Poker] [Local/${lastDecisionSource}] ${local.action}${local.amount != null ? ` €${local.amount.toFixed(2)}` : ""} (confidence ${local.confidence.toFixed(2)}) — ${local.reasoning}`);
        // Forward decision to web app for observability — fire-and-forget via background
        chrome.runtime.sendMessage({
          type: "LOCAL_DECISION",
          payload: {
            action: local.action,
            amount: local.amount,
            confidence: local.confidence,
            reasoning: local.reasoning,
            source: lastDecisionSource,
          },
        });
        safeExecuteAction(
          { action: local.action, amount: local.amount, reasoning: local.reasoning },
          "local",
        );
        lastHeroTurn = state.isHeroTurn;
        lastState = state;
        return;
      }
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

// ── Debug bridge ────────────────────────────────────────────────────────
// Polls /api/debug/command every 2s. Supported command types:
//   DOM_QUERY  { selector }  → outerHTML of all matching elements (max 5)
//   DOM_HTML   { selector }  → innerHTML of first match
//   STATE_DUMP {}            → current gameState snapshot
//
// Results are POSTed to /api/debug/result so Claude can read them directly.

const DEBUG_COMMAND_URL = `${API_BASE}/api/debug/command`;
const DEBUG_RESULT_URL  = `${API_BASE}/api/debug/result`;

async function pollDebugCommand() {
  try {
    const res = await fetch(DEBUG_COMMAND_URL);
    if (!res.ok) return;
    const cmd = await res.json();
    if (!cmd?.type) return;

    // Clear the command immediately so we don't re-execute it
    await fetch(DEBUG_COMMAND_URL, { method: "DELETE" });

    let result: unknown;

    if (cmd.type === "DOM_QUERY" && cmd.selector) {
      const els = Array.from(document.querySelectorAll(cmd.selector)).slice(0, 5);
      result = els.map(el => ({
        tag: el.tagName.toLowerCase(),
        className: el.className,
        id: el.id,
        textContent: el.textContent?.trim().slice(0, 200),
        outerHTML: el.outerHTML.slice(0, 500),
      }));
    } else if (cmd.type === "DOM_HTML" && cmd.selector) {
      const el = document.querySelector(cmd.selector);
      result = el ? el.innerHTML.slice(0, 2000) : null;
    } else if (cmd.type === "STATE_DUMP") {
      result = lastState;
    } else if (cmd.type === "DOM_TEXT_SEARCH" && cmd.text) {
      // Walk all text nodes and find elements whose textContent contains cmd.text
      const needle = (cmd.text as string).toLowerCase();
      const matches: Array<{ tag: string; className: string; id: string; textContent: string; outerHTML: string }> = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode()) && matches.length < 5) {
        if ((node.textContent ?? "").toLowerCase().includes(needle)) {
          const el = node.parentElement;
          if (el && !matches.some(m => m.outerHTML === el.outerHTML.slice(0, 500))) {
            matches.push({
              tag: el.tagName.toLowerCase(),
              className: el.className,
              id: el.id,
              textContent: el.textContent?.trim().slice(0, 200) ?? "",
              outerHTML: el.outerHTML.slice(0, 500),
            });
          }
        }
      }
      result = matches;
    } else if (cmd.type === "DOM_HTML_LONG" && cmd.selector) {
      // Like DOM_HTML but returns up to 8000 chars
      const el = document.querySelector(cmd.selector);
      result = el ? el.innerHTML.slice(0, 8000) : null;
    } else if (cmd.type === "HOVER_FIND_POPUP" && cmd.selector) {
      // Simulate hover on an element, wait for React to render popup, then find it.
      // Searches for any element containing popup-like text (PFR, 3BET, ATS, action history).
      const target = document.querySelector(cmd.selector as string);
      if (!target) {
        result = { error: `Selector not found: ${cmd.selector}` };
      } else {
        // Snapshot element count before hover so we can detect new elements
        const before = document.querySelectorAll("*").length;

        // Dispatch hover events
        target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        target.dispatchEvent(new MouseEvent("mouseover",  { bubbles: true }));

        // Wait for React render
        await new Promise<void>((resolve) => setTimeout(resolve, 600));

        // Search entire document for popup-like content
        const popupKeywords = ["pfr", "3bet", "ats", "action history", "pre-flop", "hands"];
        const found: Array<{ selector: string; className: string; textContent: string; innerHTML: string }> = [];
        document.querySelectorAll("*").forEach((el) => {
          if (found.length >= 3) return;
          const text = (el.textContent ?? "").toLowerCase();
          const hasKeyword = popupKeywords.some((kw) => text.includes(kw));
          if (!hasKeyword) return;
          // Only report leaf-ish containers (not huge wrappers)
          if ((el.textContent?.length ?? 0) > 500) return;
          // Build a simple selector string
          const sel = el.tagName.toLowerCase()
            + (el.id ? `#${el.id}` : "")
            + (el.className && typeof el.className === "string"
                ? "." + el.className.trim().replace(/\s+/g, ".").slice(0, 40)
                : "");
          found.push({
            selector: sel,
            className: typeof el.className === "string" ? el.className : "",
            textContent: (el.textContent ?? "").trim().slice(0, 300),
            innerHTML: el.innerHTML.slice(0, 600),
          });
        });

        // Dismiss hover
        target.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        target.dispatchEvent(new MouseEvent("mouseout",   { bubbles: true }));

        const after = document.querySelectorAll("*").length;
        result = { newElements: after - before, popupCandidates: found };
      }
    } else if (cmd.type === "HOVER_READ" && cmd.selector) {
      // Hover, wait 700ms, read .hud-tooltip innerHTML, then dismiss.
      const target = document.querySelector(cmd.selector as string);
      if (!target) {
        result = { error: `Selector not found: ${cmd.selector}` };
      } else {
        target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        target.dispatchEvent(new MouseEvent("mouseover",  { bubbles: true }));
        await new Promise<void>((resolve) => setTimeout(resolve, 700));
        const popup = document.querySelector(".hud-tooltip");
        result = popup ? popup.innerHTML.slice(0, 4000) : null;
        target.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        target.dispatchEvent(new MouseEvent("mouseout",   { bubbles: true }));
      }
    } else if (cmd.type === "HOVER_ALL_SEATS") {
      // Probe every seat 1-9, try both selector forms, report which have .hover-trigger.
      const seats: Array<{ seat: number; selector: string | null }> = [];
      for (let s = 1; s <= 9; s++) {
        const sel1 = `.player-area.player-seat-${s} .hover-trigger`;
        const sel2 = `.player-seat-${s} .hover-trigger`;
        if (document.querySelector(sel1))      seats.push({ seat: s, selector: sel1 });
        else if (document.querySelector(sel2)) seats.push({ seat: s, selector: sel2 });
        else                                    seats.push({ seat: s, selector: null });
      }
      result = seats;
    } else {
      result = { error: `Unknown command type: ${cmd.type}` };
    }

    await fetch(DEBUG_RESULT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd, result }),
    });
  } catch {
    // server may be off — silent
  }
}

setInterval(pollDebugCommand, 2000);
