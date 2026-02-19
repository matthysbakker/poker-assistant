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
 *   REGISTER_POKER_TAB    poker-content → bg   Tab registers as the poker tab
 *   UNREGISTER_POKER_TAB  poker-content → bg   Tab unregisters on unload
 *   AUTOPILOT_DECIDE      poker-content → bg   Request decision (messages array)
 *   AUTOPILOT_ACTION      bg → poker-content   Decision result (action object)
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

// Also parse from SVG filenames: c=clubs, d=diamonds, h=hearts, s=spades
const SVG_SUIT_MAP: Record<string, string> = {
  c: "c",
  d: "d",
  h: "h",
  s: "s",
};

const SVG_RANK_MAP: Record<string, string> = {
  a: "A",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  "10": "10",
  j: "J",
  q: "Q",
  k: "K",
};

// ── State ──────────────────────────────────────────────────────────────

let autopilotEnabled = false;
let executing = false;
let currentHandId: string | null = null;
let handMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
let lastState: GameState | null = null;
let lastHeroTurn = false;

// ── Registration ───────────────────────────────────────────────────────

chrome.runtime.sendMessage(
  { type: "REGISTER_POKER_TAB" },
  (response) => {
    if (chrome.runtime.lastError) {
      console.error(
        "[Poker] Register failed:",
        chrome.runtime.lastError.message,
      );
    } else {
      console.log("[Poker] Registered:", response);
    }
  },
);

window.addEventListener("beforeunload", () => {
  chrome.runtime.sendMessage({ type: "UNREGISTER_POKER_TAB" });
});

// ── Message Handling ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "AUTOPILOT_ACTION") {
    console.log("[Poker] Received action:", message.action);
    onDecisionReceived(message.action);
  }

  if (message.type === "AUTOPILOT_ENABLED") {
    autopilotEnabled = message.enabled;
    console.log("[Poker] Autopilot", autopilotEnabled ? "ENABLED" : "DISABLED");
    if (autopilotEnabled) {
      startObserving();
    }
  }
});

// ── DOM Scraping ───────────────────────────────────────────────────────

function parseCardFromSvg(src: string): string | null {
  // Parse card from SVG filename: "../../resources/images/cards-classic-assets/dq.svg" → "Qd"
  const match = src.match(/\/([cdhs])(\w+)\.svg$/);
  if (!match) return null;
  const [, suitChar, rankStr] = match;
  const suit = SVG_SUIT_MAP[suitChar];
  const rank = SVG_RANK_MAP[rankStr];
  if (!suit || !rank) return null;
  return rank + suit;
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
    if (src.includes("card-back")) return; // face-down card
    const card = parseCardFromSvg(src);
    if (card) cards.push(card);
  });

  // Fallback to text nodes
  if (cards.length === 0) {
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
      // Try SVG first
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
      // Fallback to text
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
    // Extract seat number from class: "player-seat-N"
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
  // Dealer button is visible (no pt-visibility-hidden) on one game-position element
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
  // Check for turn indicator or countdown on hero's seat
  return !!(
    myPlayer.querySelector(".turn-to-act-indicator") ||
    myPlayer.querySelector(".countdown-text")
  );
}

function scrapeAvailableActions(): ActionOption[] {
  const actions: ActionOption[] = [];
  const actionsArea = document.querySelector(".actions-area");
  if (!actionsArea) return actions;

  // LOG THE RAW HTML for Phase 0 discovery
  console.log("[Poker] Actions area HTML:", actionsArea.outerHTML);

  // Try to parse action buttons
  actionsArea.querySelectorAll(".base-button").forEach((btn) => {
    const text = btn.textContent?.trim() || "";
    if (!text) return;

    const lowerText = text.toLowerCase();

    // Parse pre-action checkboxes
    const isPreAction = btn.classList.contains("pre-action");

    // Parse action type from button text
    let type: ActionOption["type"] | null = null;
    let amount: string | null = null;

    if (lowerText.startsWith("fold")) {
      type = "FOLD";
    } else if (lowerText.startsWith("check")) {
      type = "CHECK";
    } else if (lowerText.startsWith("call")) {
      type = "CALL";
      // Extract amount: "Call €0,04" → "€0,04"
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
      actions.push({
        type,
        label: text,
        amount,
      });
    }
  });

  return actions;
}

function scrapeGameState(): GameState {
  // Clear pre-action checkboxes (autopilot should never use them)
  document
    .querySelectorAll(".pre-action-toggle:checked")
    .forEach((el) => {
      (el as HTMLInputElement).checked = false;
    });

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

const POSITIONS_6MAX = ["BTN", "SB", "BB", "UTG", "MP", "CO"] as const;

function getPosition(
  seat: number,
  dealerSeat: number,
  activeSeatCount: number,
): string {
  if (dealerSeat < 0 || activeSeatCount < 2) return "??";
  // Count seats clockwise from dealer
  // Seats are 1-6 in the Playtech DOM
  const offset = ((seat - dealerSeat + 6) % 6);
  if (offset < POSITIONS_6MAX.length) {
    return POSITIONS_6MAX[offset];
  }
  return "??";
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

  // List all players with positions
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

  // Hero cards
  if (state.heroCards.length > 0) {
    lines.push(`\nHero holds: ${state.heroCards.join(" ")}`);
  }

  // Community cards
  if (state.communityCards.length > 0) {
    lines.push(`Board: ${state.communityCards.join(" ")}`);
  }

  // Pot
  if (state.pot) {
    lines.push(`Pot: ${state.pot}`);
  }

  // Available actions
  if (state.availableActions.length > 0) {
    const opts = state.availableActions.map((a) => a.label).join(", ");
    lines.push(`\nAction to Hero. Options: ${opts}`);
  }

  return lines.join("\n");
}

function buildTurnMessage(state: GameState): string {
  const lines: string[] = [];

  // Report what changed since last state
  if (lastState) {
    // New community cards
    if (
      state.communityCards.length > lastState.communityCards.length
    ) {
      const newCards = state.communityCards.slice(
        lastState.communityCards.length,
      );
      const streetName =
        state.communityCards.length === 3
          ? "FLOP"
          : state.communityCards.length === 4
            ? "TURN"
            : "RIVER";
      lines.push(
        `${streetName}: ${state.communityCards.join(" ")}`,
      );
    }

    // Player action changes (bets, folds)
    for (const p of state.players) {
      if (!p.name || p.seat === state.heroSeat) continue;
      const prev = lastState.players.find((lp) => lp.seat === p.seat);
      if (!prev) continue;

      if (p.folded && !prev.folded) {
        lines.push(`${p.name} folds.`);
      } else if (p.bet !== prev.bet && p.bet) {
        lines.push(`${p.name} bets/raises to ${p.bet}.`);
      }
    }
  }

  // Current pot
  if (state.pot) {
    lines.push(`Pot: ${state.pot}`);
  }

  // Available actions
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

  console.log("[Poker] Requesting decision. Messages:", messages.length);
  chrome.runtime.sendMessage({
    type: "AUTOPILOT_DECIDE",
    messages,
  });
}

// ── Action Execution ───────────────────────────────────────────────────

// Fallback hierarchy for when Claude's action isn't available
const FALLBACK_MAP: Record<string, string[]> = {
  RAISE: ["BET", "ALL_IN", "CALL", "CHECK", "FOLD"],
  BET: ["RAISE", "ALL_IN", "CALL", "CHECK", "FOLD"],
  CALL: ["CHECK", "FOLD"],
  CHECK: ["FOLD"],
  FOLD: [],
};

function gaussianRandom(mean: number, stddev: number): number {
  // Box-Muller transform
  const u1 = Math.random();
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

function simulateClick(selector: string) {
  const element = document.querySelector(selector);
  if (!element) {
    console.error("[Poker] Click target not found:", selector);
    return false;
  }

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

  console.log("[Poker] Clicked:", selector);
  return true;
}

function findActionButton(actionType: string): string | null {
  // Find the button in the actions area matching the action type
  const actionsArea = document.querySelector(".actions-area");
  if (!actionsArea) return null;

  const buttons = actionsArea.querySelectorAll(".base-button");
  for (let i = 0; i < buttons.length; i++) {
    const text = buttons[i].textContent?.trim().toLowerCase() || "";
    const matchType = actionType.toLowerCase();

    if (text.startsWith(matchType)) {
      // Return a selector that uniquely identifies this button
      return `.actions-area .base-button:nth-child(${i + 1})`;
    }

    // Handle ALL_IN → "all-in" or "allin"
    if (
      actionType === "ALL_IN" &&
      (text.includes("all-in") || text.includes("allin"))
    ) {
      return `.actions-area .base-button:nth-child(${i + 1})`;
    }
  }

  return null;
}

async function executeAction(decision: AutopilotAction) {
  // Read remaining time for dynamic delay
  const timer = scrapeTimer();

  // Find the action button
  let selector = findActionButton(decision.action);

  // If not found, try fallback hierarchy
  if (!selector && FALLBACK_MAP[decision.action]) {
    for (const fallback of FALLBACK_MAP[decision.action]) {
      selector = findActionButton(fallback);
      if (selector) {
        console.log(
          `[Poker] Action ${decision.action} not available, falling back to ${fallback}`,
        );
        break;
      }
    }
  }

  // Last resort: fold
  if (!selector) {
    selector = findActionButton("FOLD");
    if (!selector) {
      console.error("[Poker] No action buttons found at all!");
      executing = false;
      return;
    }
  }

  // Dynamic humanization delay based on remaining timer
  if (timer !== null && timer <= 3) {
    // Timer critical — click immediately
    console.log("[Poker] Timer critical, clicking immediately");
  } else {
    const maxDelay =
      timer !== null ? Math.min(8000, (timer - 3) * 1000) : 8000;
    const minDelay = Math.min(1500, maxDelay);
    if (maxDelay > minDelay) {
      await humanDelay(minDelay, maxDelay);
    }
  }

  // TODO: For RAISE/BET, enter amount in the sizing input first
  // This requires Phase 0 DOM discovery of the bet input

  // Click the button
  simulateClick(selector);
  executing = false;
}

function onDecisionReceived(action: AutopilotAction) {
  // Record Claude's response in conversation
  handMessages.push({
    role: "assistant",
    content: JSON.stringify(action),
  });

  console.log(
    `[Poker] Executing: ${action.action}${action.amount ? ` €${action.amount}` : ""} — ${action.reasoning}`,
  );

  executeAction(action);
}

// ── Game State Observer ────────────────────────────────────────────────

let observerActive = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function onDomChange() {
  // Debounce: wait 200ms for DOM to settle before scraping
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    processGameState();
  }, 200);
}

function processGameState() {
  const state = scrapeGameState();

  // Log state periodically for debugging
  if (state.handId && state.handId !== currentHandId) {
    console.log("[Poker] New hand:", state.handId);
    console.log("[Poker] Game state:", JSON.stringify(state, null, 2));
  }

  // Detect new hand
  if (state.handId && state.handId !== currentHandId) {
    currentHandId = state.handId;
    handMessages = [];
    executing = false;
    lastHeroTurn = false;

    // Build initial hand context (even if not hero's turn yet)
    if (state.heroCards.length > 0) {
      handMessages.push({
        role: "user",
        content: buildHandStartMessage(state),
      });
    }
  }

  // Detect hero's turn
  if (state.isHeroTurn && !lastHeroTurn && !executing && autopilotEnabled) {
    console.log("[Poker] Hero's turn detected!");

    // If we haven't built the hand start message yet, do it now
    if (handMessages.length === 0 && state.heroCards.length > 0) {
      handMessages.push({
        role: "user",
        content: buildHandStartMessage(state),
      });
    } else if (handMessages.length > 0) {
      // Append turn-specific delta
      const turnMsg = buildTurnMessage(state);
      if (turnMsg.trim()) {
        handMessages.push({ role: "user", content: turnMsg });
      }
    }

    // Request Claude's decision
    if (handMessages.length > 0) {
      requestDecision([...handMessages]);
    }
  }

  lastHeroTurn = state.isHeroTurn;
  lastState = state;
}

function startObserving() {
  if (observerActive) return;

  const tableArea = document.querySelector(".table-area");
  if (!tableArea) {
    console.log("[Poker] No .table-area found, retrying in 2s...");
    setTimeout(startObserving, 2000);
    return;
  }

  const observer = new MutationObserver(onDomChange);
  observer.observe(tableArea, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  observerActive = true;
  console.log("[Poker] MutationObserver started on .table-area");

  // Initial scrape
  processGameState();
}

// ── Auto-start ─────────────────────────────────────────────────────────

// Always start observing to capture DOM structure for debugging
// (actual autopilot actions only fire when autopilotEnabled = true)
function waitForTable() {
  if (document.querySelector(".table-area")) {
    startObserving();
  } else {
    console.log("[Poker] Waiting for table to load...");
    setTimeout(waitForTable, 1000);
  }
}

waitForTable();
