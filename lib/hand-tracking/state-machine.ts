import type { CardCode, DetectionResult } from "@/lib/card-detection/types";
import type { HandState, HandAction, Street, StreetSnapshot } from "./types";

/** Frames required to confirm a forward street transition. */
const FORWARD_HYSTERESIS = 2;
/** Frames required to confirm transition to WAITING (hand ended). */
const WAITING_HYSTERESIS = 2;

export const INITIAL_STATE: HandState = {
  street: "WAITING",
  heroCards: [],
  communityCards: [],
  heroTurn: false,
  streets: [],
  frameCount: 0,
  pendingStreet: null,
  analyzeGeneration: 0,
  analyzing: false,
  heroPosition: null,
};

/** Map community card count to expected street. */
function streetFromCommunityCount(
  heroCount: number,
  communityCount: number,
): Street {
  if (heroCount === 0) return "WAITING";
  if (communityCount === 0) return "PREFLOP";
  if (communityCount <= 3) return "FLOP";
  if (communityCount === 4) return "TURN";
  return "RIVER";
}

/** Street ordering for forward-only enforcement. */
const STREET_ORDER: Record<Street, number> = {
  WAITING: 0,
  PREFLOP: 1,
  FLOP: 2,
  TURN: 3,
  RIVER: 4,
};

/** Extract card codes from detection result. */
function cardCodes(detection: DetectionResult): {
  hero: CardCode[];
  community: CardCode[];
} {
  return {
    hero: detection.heroCards.flatMap((m) => (m.card ? [m.card] : [])),
    community: detection.communityCards.flatMap((m) => (m.card ? [m.card] : [])),
  };
}

/** Core state machine reducer. */
export function handReducer(state: HandState, action: HandAction): HandState {
  switch (action.type) {
    case "DETECTION":
      return handleDetection(state, action.detection);
    case "ANALYSIS_STARTED":
      return { ...state, analyzing: true };
    case "ANALYSIS_COMPLETE":
      return { ...state, analyzing: false };
    case "RESET":
      return { ...INITIAL_STATE };
    default:
      return state;
  }
}

function handleDetection(
  state: HandState,
  detection: DetectionResult,
): HandState {
  const { hero, community } = cardCodes(detection);
  const detectedStreet = streetFromCommunityCount(hero.length, community.length);
  const heroTurn = detection.heroTurn;
  // Lock position: use first non-null detection, don't overwrite within a hand
  const heroPosition = state.heroPosition ?? detection.heroPosition;

  // Determine if this is the same street or a transition
  if (detectedStreet === state.street) {
    // Same street — reset pending, update heroTurn
    const triggerAnalysis =
      heroTurn && !state.heroTurn && !state.analyzing && state.street !== "WAITING";
    return {
      ...state,
      heroCards: hero.length > 0 ? hero : state.heroCards,
      communityCards: community.length > 0 ? community : state.communityCards,
      heroTurn,
      heroPosition,
      frameCount: 0,
      pendingStreet: null,
      analyzeGeneration: triggerAnalysis
        ? state.analyzeGeneration + 1
        : state.analyzeGeneration,
    };
  }

  // Transitioning to WAITING (hand ended)
  if (detectedStreet === "WAITING") {
    const threshold = WAITING_HYSTERESIS;
    if (state.pendingStreet === "WAITING") {
      const newCount = state.frameCount + 1;
      if (newCount >= threshold) {
        // Hand ended — reset but preserve monotonic generation counter
        return {
          ...INITIAL_STATE,
          analyzeGeneration: state.analyzeGeneration,
        };
      }
      return { ...state, frameCount: newCount, heroTurn, heroPosition };
    }
    // Start counting toward WAITING
    return { ...state, pendingStreet: "WAITING", frameCount: 1, heroTurn, heroPosition };
  }

  // Forward-only: ignore backward transitions (except to WAITING)
  if (STREET_ORDER[detectedStreet] <= STREET_ORDER[state.street]) {
    return { ...state, heroTurn, heroPosition };
  }

  // Forward transition with hysteresis
  if (state.pendingStreet === detectedStreet) {
    const newCount = state.frameCount + 1;
    if (newCount >= FORWARD_HYSTERESIS) {
      // Transition confirmed
      const snapshot: StreetSnapshot = {
        street: detectedStreet,
        heroCards: hero,
        communityCards: community,
      };
      const triggerAnalysis = heroTurn && !state.analyzing;
      return {
        ...state,
        street: detectedStreet,
        heroCards: hero,
        communityCards: community,
        heroTurn,
        heroPosition,
        streets: [...state.streets, snapshot],
        frameCount: 0,
        pendingStreet: null,
        analyzeGeneration: triggerAnalysis
          ? state.analyzeGeneration + 1
          : state.analyzeGeneration,
      };
    }
    return { ...state, frameCount: newCount, heroTurn, heroPosition };
  }

  // Start counting toward new street
  return { ...state, pendingStreet: detectedStreet, frameCount: 1, heroTurn, heroPosition };
}
