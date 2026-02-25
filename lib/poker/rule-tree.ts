/**
 * Rule Tree — GTO-informed post-flop decision engine.
 *
 * Pure function: no side effects, no chrome.* globals, fully unit-testable.
 * Called by localDecide() in poker-content.ts.
 *
 * Decision output:
 *   action  — one of FOLD / CHECK / CALL / RAISE / BET
 *   amount  — null (use bet-sizing logic in caller) or explicit € amount
 *   confidence  — 0.0–1.0
 */

import { evaluateHand, type HandTier } from "./hand-evaluator";
import { analyzeBoard, betFractionFromWetScore } from "./board-analyzer";
import { applyExploitAdjustments, type PlayerExploitType } from "./exploit";
import type { LocalDecision } from "./types";
import {
  parseCards,
  analyzeOuts,
  exactOutEquity,
  computePotOdds,
  impliedOddsBonus,
  applyDirtyOutsDiscount,
  detectStrengthEquityMismatch,
} from "./equity";

export interface RuleTreeInput {
  heroCards: string[];         // ["Ah", "Kd"]
  communityCards: string[];    // ["Qs", "Jh", "7c"] — must be ≥ 3 for post-flop
  pot: number;                 // total pot in €
  heroStack: number;           // hero's remaining stack in €
  effectiveStack: number;      // min(heroStack, villain's stack)
  callAmount: number;          // cost to call (0 if no bet facing)
  facingBet: boolean;          // is there a bet/raise to act on?
  position: string;            // "BTN"|"SB"|"BB"|"UTG"|"MP"|"CO"|"??"
  activePlayers: number;       // number of players still in hand (2 = heads-up)
  opponentType?: PlayerExploitType; // inferred type from session
  handsObserved?: number;      // sample size for opponent model — scales exploit confidence
}

// ── SPR ──────────────────────────────────────────────────────────────────────

function computeSPR(effectiveStack: number, pot: number): number {
  return pot > 0 ? effectiveStack / pot : 99;
}

// ── Position ─────────────────────────────────────────────────────────────────

function isInPosition(position: string): boolean {
  return ["BTN", "CO", "BTN/SB"].includes(position.toUpperCase());
}

// ── Bet Sizing ────────────────────────────────────────────────────────────────

function betSize(pot: number, fraction: number): number {
  return Math.round(pot * fraction * 100) / 100;
}

// ── Main Rule Tree ─────────────────────────────────────────────────────────────

/**
 * Apply the GTO-informed rule tree to the current game state.
 * Returns a LocalDecision with confidence ≥ 0.0.
 */
export function applyRuleTree(input: RuleTreeInput): LocalDecision {
  const {
    heroCards, communityCards, pot, effectiveStack,
    callAmount, facingBet, position, activePlayers, opponentType,
    handsObserved = 0,
  } = input;

  // Need at least the flop to make post-flop decisions
  if (communityCards.length < 3) {
    return { action: "CHECK", amount: null, confidence: 0, reasoning: "Pre-flop: use persona chart" };
  }

  const board = analyzeBoard(communityCards);
  const hand = evaluateHand(heroCards, communityCards);
  const spr = computeSPR(effectiveStack, pot);
  const inPosition = isInPosition(position);
  const multiway = activePlayers >= 3;

  // ── Draw analysis (for weak hands) ──────────────────────────────────────
  const allCards = [...heroCards, ...communityCards];
  const parsedAll = parseCards(allCards);
  const outs = analyzeOuts(parsedAll);
  const streetsLeft = (communityCards.length === 3 ? 2 : 1) as 1 | 2;
  const seenCount = allCards.length;

  const adjustedOuts = applyDirtyOutsDiscount({
    flushOuts: outs.flushOuts,
    straightOuts: outs.oesd + outs.gutshot,
    boardPaired: board.paired,
    activePlayers,
  });

  const rawEquity = exactOutEquity(adjustedOuts, seenCount, streetsLeft);
  const impliedBonus = impliedOddsBonus(outs.flushOuts, outs.oesd + outs.gutshot, spr);
  const equity = rawEquity + impliedBonus;
  const potOdds = computePotOdds(callAmount, pot);
  const betFraction = betFractionFromWetScore(board.wetScore);

  // ── Mismatch detection ───────────────────────────────────────────────────
  // Only flag as "wet" for connected two-tone (wetScore 3) or monotone (wetScore 4).
  // Two-tone alone (wetScore 2) is semi-wet but not dangerous enough to dominate TPTK.
  const mismatch = detectStrengthEquityMismatch(hand.tier, board.wetScore >= 3, activePlayers, facingBet);

  // ── Multiway and large-bet overrides ────────────────────────────────────

  // Multiway pot post-flop: tighten ranges, small bets only with premium hands
  if (multiway && communityCards.length >= 3) {
    if (hand.tier === "nut" || hand.tier === "strong") {
      if (facingBet) {
        return { action: "CALL", amount: null, confidence: 0.72, reasoning: `Multiway: ${hand.tier} hand, calling` };
      }
      return { action: "BET", amount: betSize(pot, betFraction * 0.75), confidence: 0.72, reasoning: `Multiway: ${hand.tier} hand, small bet` };
    }
    if (hand.tier === "top_pair_gk") {
      if (facingBet) return { action: "FOLD", amount: null, confidence: 0.70, reasoning: "Multiway: TPTK vs bet, range disadvantage" };
      return { action: "CHECK", amount: null, confidence: 0.72, reasoning: "Multiway: TPTK, pot control" };
    }
    // medium, weak, draws, air — check-fold
    if (facingBet) return { action: "FOLD", amount: null, confidence: 0.75, reasoning: "Multiway: weak holding vs bet" };
    return { action: "CHECK", amount: null, confidence: 0.72, reasoning: "Multiway: checking weak hand" };
  }

  // Facing large bet with medium/weak/TPTK: fold is standard
  if (facingBet && callAmount > pot * 0.5 && (hand.tier === "medium" || hand.tier === "weak" || hand.tier === "top_pair_gk")) {
    return { action: "FOLD", amount: null, confidence: 0.75, reasoning: `Facing large bet (${(callAmount / pot * 100).toFixed(0)}% pot) with ${hand.tier}` };
  }

  // River: draws miss — check back or fold to bet
  if (communityCards.length === 5 && (hand.tier === "draw" || hand.tier === "weak_draw" || hand.tier === "strong_draw")) {
    if (facingBet) return { action: "FOLD", amount: null, confidence: 0.85, reasoning: "River: draw missed, folding to bet" };
    return { action: "CHECK", amount: null, confidence: 0.80, reasoning: "River: draw missed, checking back" };
  }

  // ── Tier-based decision tree ─────────────────────────────────────────────

  let decision: LocalDecision;

  // ── NUT TIER ────────────────────────────────────────────────────────────
  if (hand.tier === "nut") {
    if (facingBet) {
      decision = { action: "RAISE", amount: betSize(pot + callAmount, 2.5), confidence: 0.92, reasoning: `Nut hand vs bet, raising for value` };
    } else {
      decision = { action: "BET", amount: betSize(pot, betFraction), confidence: 0.90, reasoning: `Nut hand, betting ${Math.round(betFraction * 100)}% pot` };
    }
  }

  // ── STRONG TIER ─────────────────────────────────────────────────────────
  else if (hand.tier === "strong") {
    if (spr < 3) {
      const commitAmt = facingBet ? null : Math.min(effectiveStack, betSize(pot, 1.0));
      decision = { action: facingBet ? "CALL" : "BET", amount: commitAmt, confidence: 0.88, reasoning: `Strong hand, low SPR (${spr.toFixed(1)}) — commit` };
    } else if (facingBet) {
      decision = { action: "CALL", amount: null, confidence: 0.85, reasoning: "Strong hand, calling 1 bet" };
    } else {
      decision = { action: "BET", amount: betSize(pot, betFraction), confidence: 0.85, reasoning: `Strong hand, betting ${Math.round(betFraction * 100)}% pot` };
    }
  }

  // ── TOP PAIR / GOOD KICKER or OVERPAIR ──────────────────────────────────
  else if (hand.tier === "top_pair_gk") {
    if (spr < 3) {
      const commitAmt = facingBet ? null : Math.min(effectiveStack, betSize(pot, 0.75));
      decision = { action: facingBet ? "CALL" : "BET", amount: commitAmt, confidence: 0.85, reasoning: `TPTK/overpair, commit zone (SPR ${spr.toFixed(1)})` };
    } else if (mismatch.dominated) {
      return { action: "FOLD", amount: null, confidence: 0.72, reasoning: `TPTK may be dominated: ${mismatch.reason}` };
    } else if (facingBet) {
      // OOP check-call is standard GTO
      decision = { action: "CALL", amount: null, confidence: inPosition ? 0.72 : 0.65, reasoning: `TPTK vs bet, ${inPosition ? "in position call" : "OOP call"}` };
    } else if (inPosition) {
      decision = { action: "BET", amount: betSize(pot, 0.60), confidence: 0.75, reasoning: "TPTK in position, betting 60% pot" };
    } else {
      decision = { action: "CHECK", amount: null, confidence: 0.65, reasoning: "TPTK OOP, pot-control check" };
    }
  }

  // ── MEDIUM PAIR ──────────────────────────────────────────────────────────
  else if (hand.tier === "medium") {
    if (facingBet) {
      decision = { action: "FOLD", amount: null, confidence: 0.70, reasoning: `Medium pair vs bet, likely behind` };
    } else {
      decision = { action: "CHECK", amount: null, confidence: 0.68, reasoning: "Medium pair, check-call line" };
    }
  }

  // ── WEAK PAIR ────────────────────────────────────────────────────────────
  else if (hand.tier === "weak") {
    if (facingBet) {
      decision = { action: "FOLD", amount: null, confidence: 0.75, reasoning: "Weak pair vs bet, folding" };
    } else {
      decision = { action: "CHECK", amount: null, confidence: 0.65, reasoning: "Weak pair, checking back" };
    }
  }

  // ── STRONG DRAW (12+ outs) ───────────────────────────────────────────────
  else if (hand.tier === "strong_draw") {
    if (facingBet) {
      // Call with sufficient equity; semi-bluff raise in position
      if (equity > potOdds) {
        decision = inPosition
          ? { action: "RAISE", amount: betSize(pot + callAmount, 2.0), confidence: 0.75, reasoning: `Strong draw in position, semi-bluff raise (equity ${(equity * 100).toFixed(0)}% vs odds ${(potOdds * 100).toFixed(0)}%)` }
          : { action: "CALL", amount: null, confidence: 0.72, reasoning: `Strong draw OOP, calling with equity ${(equity * 100).toFixed(0)}%` };
      } else {
        decision = { action: "FOLD", amount: null, confidence: 0.70, reasoning: `Strong draw, negative equity (${(equity * 100).toFixed(0)}% vs ${(potOdds * 100).toFixed(0)}% needed)` };
      }
    } else {
      // Semi-bluff in position, check OOP
      decision = inPosition
        ? { action: "BET", amount: betSize(pot, betFraction), confidence: 0.75, reasoning: `Strong draw semi-bluff in position` }
        : { action: "CHECK", amount: null, confidence: 0.70, reasoning: `Strong draw OOP, check-call` };
    }
  }

  // ── STANDARD DRAW (flush draw or OESD, 8-9 outs) ───────────────────────
  else if (hand.tier === "draw") {
    if (facingBet && callAmount > 0) {
      if (equity > potOdds) {
        decision = { action: "CALL", amount: null, confidence: 0.70, reasoning: `Draw: equity ${(equity * 100).toFixed(0)}% > odds ${(potOdds * 100).toFixed(0)}%, calling` };
      } else {
        decision = { action: "FOLD", amount: null, confidence: 0.80, reasoning: `Draw: equity ${(equity * 100).toFixed(0)}% < odds ${(potOdds * 100).toFixed(0)}%, folding` };
      }
    } else {
      // No bet to call — check or semi-bluff in position on the flop
      decision = (inPosition && communityCards.length === 3)
        ? { action: "BET", amount: betSize(pot, 0.40), confidence: 0.68, reasoning: "Draw: small semi-bluff on flop in position" }
        : { action: "CHECK", amount: null, confidence: 0.65, reasoning: "Draw: check, looking for free card" };
    }
  }

  // ── WEAK DRAW (gutshot, 4 outs) ──────────────────────────────────────────
  else if (hand.tier === "weak_draw") {
    if (facingBet && callAmount > 0 && equity > potOdds) {
      decision = { action: "CALL", amount: null, confidence: 0.62, reasoning: `Gutshot: pot odds marginally positive` };
    } else if (facingBet) {
      decision = { action: "FOLD", amount: null, confidence: 0.72, reasoning: "Gutshot: poor pot odds, folding" };
    } else {
      decision = { action: "CHECK", amount: null, confidence: 0.60, reasoning: "Gutshot: check, not worth betting" };
    }
  }

  // ── AIR ──────────────────────────────────────────────────────────────────
  else {
    // air — river: check back or fold to bet
    if (communityCards.length === 5) {
      if (facingBet) return { action: "FOLD", amount: null, confidence: 0.80, reasoning: "River: air vs bet, folding" };
      return { action: "CHECK", amount: null, confidence: 0.75, reasoning: "River: air, checking back" };
    }
    if (facingBet) {
      decision = { action: "FOLD", amount: null, confidence: 0.72, reasoning: "Air vs bet, folding" };
    } else {
      decision = { action: "CHECK", amount: null, confidence: 0.62, reasoning: "Air, checking" };
    }
  }

  // ── Opponent exploit post-processing ──────────────────────────────────────
  const highCardOrWetBoard = board.highCards || board.wetScore >= 2;
  return applyExploitAdjustments(
    decision,
    opponentType,
    handsObserved,
    hand,
    facingBet,
    pot,
    callAmount,
    highCardOrWetBoard,
  );
}

// ── Multi-persona post-flop ────────────────────────────────────────────────────

export interface PersonaPostflopDecision {
  name: string;
  action: LocalDecision["action"];
  amount: number | null;
  reasoning: string;
}

function applyTagAdjust(base: LocalDecision, tier: HandTier): LocalDecision {
  // Fold medium pairs facing bets — GTO calls, TAG folds
  if (base.action === "CALL" && tier === "medium") {
    return { ...base, action: "FOLD", confidence: 0.72, reasoning: base.reasoning + " [TAG]" };
  }
  // Smaller sizing (−15%)
  if ((base.action === "BET" || base.action === "RAISE") && base.amount != null) {
    return { ...base, amount: Math.round(base.amount * 0.85 * 100) / 100 };
  }
  return base;
}

function applyLagAdjust(
  base: LocalDecision,
  input: RuleTreeInput,
  inPosition: boolean,
  tier: HandTier,
): LocalDecision {
  // Larger sizing (+25%)
  if ((base.action === "BET" || base.action === "RAISE") && base.amount != null) {
    return { ...base, amount: Math.round(base.amount * 1.25 * 100) / 100 };
  }
  // Probe-bet positional checks with non-air, non-river
  if (
    base.action === "CHECK" &&
    !input.facingBet &&
    inPosition &&
    input.communityCards.length < 5 &&
    tier !== "air"
  ) {
    const amount = Math.round(input.pot * 0.40 * 100) / 100;
    return {
      ...base,
      action: "BET",
      amount,
      confidence: Math.max(0.55, base.confidence - 0.08),
      reasoning: base.reasoning + " [LAG: probe]",
    };
  }
  return base;
}

/**
 * Run the post-flop rule tree for all 4 personas in one pass.
 * GTO is the shared base; TAG/LAG/Exploit are derived adjustments.
 */
export function applyRuleTreeAllPersonas(input: RuleTreeInput): PersonaPostflopDecision[] {
  // GTO base — no exploit layer
  const gto = applyRuleTree({ ...input, opponentType: undefined });

  // Shared context for adjustments (caches avoid re-computation)
  const hand = evaluateHand(input.heroCards, input.communityCards);
  const board = analyzeBoard(input.communityCards);
  const inPosition = ["BTN", "CO", "BTN/SB"].includes(input.position.toUpperCase());
  const highCardOrWetBoard = board.highCards || board.wetScore >= 2;

  const tag = applyTagAdjust(gto, hand.tier);
  const lag = applyLagAdjust(gto, input, inPosition, hand.tier);
  const exploit = applyExploitAdjustments(
    gto,
    input.opponentType,
    input.handsObserved ?? 0,
    hand,
    input.facingBet,
    input.pot,
    input.callAmount,
    highCardOrWetBoard,
  );

  return [
    { name: "GTO Grinder",  action: gto.action,    amount: gto.amount,    reasoning: gto.reasoning },
    { name: "TAG Shark",    action: tag.action,    amount: tag.amount,    reasoning: tag.reasoning },
    { name: "LAG Assassin", action: lag.action,    amount: lag.amount,    reasoning: lag.reasoning },
    { name: "Exploit Hawk", action: exploit.action, amount: exploit.amount, reasoning: exploit.reasoning },
  ];
}
