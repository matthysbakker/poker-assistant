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

let autopilotMode: "off" | "monitor" | "play" = "off";
let executing = false;
let currentHandId: string | null = null;
let handMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
let lastState: GameState | null = null;
let lastHeroTurn = false;
let streetActions: string[] = []; // accumulates opponent actions between hero turns (todo 044)
let decisionWatchdog: ReturnType<typeof setTimeout> | null = null; // timeout guard (todo 031)

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
    (a.amount === null || typeof a.amount === "number") &&
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
  for (let i = 1; i <= 6; i++) {
    const pos = document.querySelector(
      `.game-position-${i}:not(.pt-visibility-hidden)`,
    );
    if (pos) return i;
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
    const text = btn.textContent?.trim() || "";
    if (!text) return;

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
    lines.push(`\nHero holds: ${state.heroCards.join(" ")}`);
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

// ── Decision Request ───────────────────────────────────────────────────

function requestDecision(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
) {
  if (executing) {
    console.log("[Poker] Already executing, skipping decision request");
    return;
  }
  executing = true;

  // Watchdog: auto-fold if AUTOPILOT_ACTION never arrives (todo 031 — plan specified 12s timeout)
  const timer = scrapeTimer();
  const timeoutMs = Math.max(3000, (timer ?? 12) * 1000 - 3000);
  decisionWatchdog = setTimeout(() => {
    decisionWatchdog = null;
    console.warn("[Poker] Decision timeout — auto-fold");
    executing = false;
    executeAction({ action: "FOLD", amount: null, reasoning: "Decision timeout" });
  }, timeoutMs);

  console.log("[Poker] Requesting decision. Messages:", messages.length);
  chrome.runtime.sendMessage({
    type: "AUTOPILOT_DECIDE",
    messages,
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
    executing = false;
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
      executing = false;
      return;
    }
  }

  simulateClick(button);
  executing = false;
}

function onDecisionReceived(action: AutopilotAction) {
  // Cancel timeout watchdog (todo 031)
  if (decisionWatchdog) {
    clearTimeout(decisionWatchdog);
    decisionWatchdog = null;
  }

  // Clear pre-action checkboxes — play mode only, here not in scrapeGameState (todo 032)
  if (autopilotMode === "play") {
    document.querySelectorAll(".pre-action-toggle:checked").forEach((el) => {
      (el as HTMLInputElement).checked = false;
    });
  }

  // Record as readable prose, not raw JSON (todo 041)
  const actionStr = action.amount != null
    ? `${action.action} €${action.amount.toFixed(2)}`
    : action.action;
  handMessages.push({
    role: "assistant",
    content: `Hero ${actionStr.toLowerCase()}s. ${action.reasoning}`,
  });

  console.log(
    `[Poker] Executing: ${actionStr} — ${action.reasoning}`,
  );

  executeAction(action);
}

// ── Monitor Overlay ────────────────────────────────────────────────────

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
    return;
  }

  const el = getOverlay();
  const modeLabel = autopilotMode === "play" ? "PLAY" : "MONITOR";
  const modeColor = autopilotMode === "play" ? "#c084fc" : "#60a5fa";

  const hero = state.heroCards.length > 0 ? state.heroCards.join(" ") : "—";
  const board = state.communityCards.length > 0 ? state.communityCards.join(" ") : "—";
  const actions = state.availableActions.map((a) => a.label).join(" | ") || "—";
  const turn = state.isHeroTurn ? "YES" : "no";
  const turnColor = state.isHeroTurn ? "#4ade80" : "#71717a";

  el.innerHTML = `
    <div style="color:${modeColor};font-weight:bold;margin-bottom:4px">${modeLabel}</div>
    <div>Hand: ${state.handId || "—"}</div>
    <div>Hero: <b>${hero}</b></div>
    <div>Board: ${board}</div>
    <div>Pot: ${state.pot || "—"}</div>
    <div>Turn: <span style="color:${turnColor}">${turn}</span></div>
    <div>Actions: ${actions}</div>
    <div style="color:#71717a;margin-top:4px">Players: ${state.players.filter((p) => p.name).length}</div>
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

    if (state.heroCards.length > 0) {
      handMessages.push({
        role: "user",
        content: buildHandStartMessage(state),
      });
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
      console.log("[Poker] [MONITOR] Would send to Claude:", lastMsg?.content);
      sendDebugLog({
        type: "hero_turn",
        handId: state.handId,
        mode: "monitor",
        message: lastMsg?.content,
        state,
      });
    }

    if (autopilotMode === "play" && handMessages.length > 0) {
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
