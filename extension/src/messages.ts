// Shared message type definitions for the poker assistant extension.
// All cross-boundary messages must use these types.
// Cross-reference: background.ts header comment for the full protocol diagram.

export const VALID_ACTIONS = ["FOLD", "CHECK", "CALL", "RAISE", "BET"] as const;
export type ValidAction = typeof VALID_ACTIONS[number];

export function isValidAction(a: unknown): a is ValidAction {
  return VALID_ACTIONS.includes(a as ValidAction);
}

// ── Content ↔ Page (window.postMessage, source: "poker-assistant-ext" / "poker-assistant-app") ──

/** Page → Content: request EXTENSION_CONNECTED reply */
export type PingMessage = { type: "PING" };

/** Content → Page: extension presence announcement */
export type ExtensionConnectedMessage = { type: "EXTENSION_CONNECTED" };

/** Content → Page: manual capture for analysis */
export type CaptureMessage = { type: "CAPTURE"; base64: string };

/** Content → Page: continuous capture frame for detection */
export type FrameMessage = { type: "FRAME"; base64: string };

// ── Page → Background (via content.ts chrome.runtime.sendMessage) ────────────

/** Content → Background: tab registers as the web app */
export type RegisterWebAppMessage = { type: "REGISTER_WEB_APP" };

/** Content → Background: tab unregisters on unload */
export type UnregisterWebAppMessage = { type: "UNREGISTER_WEB_APP" };

/** Page → Background: forward persona recommendation to poker tab */
export type PersonaRecommendationMessage = {
  type: "PERSONA_RECOMMENDATION";
  personaName: string;
  action: ValidAction;
  temperature: unknown;
};

/** Page → Background: forward Claude's completed advice to poker overlay */
export type ClaudeAdviceMessage = {
  type: "CLAUDE_ADVICE";
  action: string;
  amount?: string;
  street?: string;
  boardTexture?: string;
  spr?: string;
};

// ── Background → Content (chrome.tabs.sendMessage) ───────────────────────────

/** Background → Content: manual hotkey screenshot (PNG) */
export type PokerCaptureMessage = { type: "POKER_CAPTURE"; base64: string };

/** Background → Content: continuous capture frame (JPEG 85%) */
export type CaptureFrameMessage = {
  type: "CAPTURE_FRAME";
  base64: string;
  mode?: "manual" | "continuous";
};

// ── Popup ↔ Background (chrome.runtime messages) ─────────────────────────────

/** Popup → Background: query connection + continuous + autopilot state */
export type GetStatusMessage = { type: "GET_STATUS" };

/** Popup → Background: start continuous capture */
export type ContinuousStartMessage = { type: "CONTINUOUS_START" };

/** Popup → Background: stop continuous capture */
export type ContinuousStopMessage = { type: "CONTINUOUS_STOP" };

/** Popup → Background: set autopilot mode */
export type AutopilotSetModeMessage = {
  type: "AUTOPILOT_SET_MODE";
  mode: "off" | "monitor" | "play";
};

// ── Poker Content ↔ Background (chrome.runtime messages) ─────────────────────

/** Poker Content → Background: tab registers as the poker tab */
export type RegisterPokerTabMessage = { type: "REGISTER_POKER_TAB" };

/** Poker Content → Background: tab unregisters on unload */
export type UnregisterPokerTabMessage = { type: "UNREGISTER_POKER_TAB" };

/** Poker Content → Background: request autopilot decision */
export type AutopilotDecideMessage = {
  type: "AUTOPILOT_DECIDE";
  messages: Array<{ role: string; content: string }>;
};

/** Background → Poker Content: decision result (action object) */
export type AutopilotActionMessage = {
  type: "AUTOPILOT_ACTION";
  action: {
    action: ValidAction;
    amount: number | null;
    reasoning: string;
  };
};

/** Background → Poker Content: apply mode change */
export type AutopilotModeMessage = {
  type: "AUTOPILOT_MODE";
  mode: "off" | "monitor" | "play";
};

/** Poker Content → Background: forward local engine decision for observability */
export type LocalDecisionMessage = {
  type: "LOCAL_DECISION";
  payload: {
    action: string;
    amount: number | null;
    confidence: number;
    reasoning: string;
    source: "local";
  };
};

/** Poker Content → Background: store preflop fast-path decision as a hand record */
export type PreflopRecordMessage = {
  type: "PREFLOP_RECORD";
  payload: {
    heroCards: string[];
    position: string;
    potSize: string | null;
    heroStack: string | null;
    action: string;
    amount: number | null;
    reasoning: string;
    personaName: string;
    handContext: string | null;
    pokerHandId: string | null;
    tableTemperature: unknown;
    tableReads: unknown;
  };
};

/** Poker Content → Background: debug log (full state dump) */
export type AutopilotDebugMessage = {
  type: "AUTOPILOT_DEBUG";
  data: Record<string, unknown>;
};

// ── Full discriminated union ─────────────────────────────────────────────────

export type ExtensionMessage =
  // Page ↔ Content (postMessage)
  | PingMessage
  | ExtensionConnectedMessage
  | CaptureMessage
  | FrameMessage
  // Content ↔ Background
  | RegisterWebAppMessage
  | UnregisterWebAppMessage
  | PersonaRecommendationMessage
  | ClaudeAdviceMessage
  // Background → Content
  | PokerCaptureMessage
  | CaptureFrameMessage
  // Popup ↔ Background
  | GetStatusMessage
  | ContinuousStartMessage
  | ContinuousStopMessage
  | AutopilotSetModeMessage
  // Poker Content ↔ Background
  | RegisterPokerTabMessage
  | UnregisterPokerTabMessage
  | AutopilotDecideMessage
  | AutopilotActionMessage
  | AutopilotModeMessage
  | LocalDecisionMessage
  | PreflopRecordMessage
  | AutopilotDebugMessage;
