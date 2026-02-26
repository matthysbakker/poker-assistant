/**
 * Opponent stats module — compute VPIP/PFR/AF from structured action log.
 *
 * Used by /api/stats and the extension to build villain ranges for equity calc.
 */

import type { StructuredAction } from "../storage/sessions";
import { vpipToRange, sampleConfidence, DEFAULT_VILLAIN_RANGE, type VillainRange } from "./villain-range";

export interface OpponentStats {
  vpip: number;       // 0–1 (voluntarily put money in preflop %)
  pfr: number;        // 0–1 (preflop raise %)
  af: number;         // aggression factor: (bets+raises) / max(1, calls+checks)
  handsObserved: number;
  confidence: number; // from sampleConfidence()
}

/**
 * Compute VPIP, PFR, and AF from a structured action log.
 *
 * @param actions         All structured actions for this opponent
 * @param handsObserved   Total hands observed (denominator for VPIP/PFR)
 */
export function computeStats(
  actions: StructuredAction[],
  handsObserved: number,
): OpponentStats {
  if (handsObserved <= 0 || actions.length === 0) {
    return { vpip: 0, pfr: 0, af: 0, handsObserved, confidence: 0 };
  }

  const vpipActions = actions.filter((a) => a.isVpip).length;
  const pfrActions  = actions.filter((a) => a.street === "PREFLOP" && a.action === "RAISE").length;

  const aggressive = actions.filter((a) => a.action === "BET" || a.action === "RAISE").length;
  const passive     = actions.filter((a) => a.action === "CALL" || a.action === "CHECK").length;
  const af = aggressive / Math.max(1, passive);

  const vpip = vpipActions / handsObserved;
  const pfr  = pfrActions  / handsObserved;

  return {
    vpip,
    pfr,
    af,
    handsObserved,
    confidence: sampleConfidence(handsObserved),
  };
}

/**
 * Convert opponent stats to a villain range for the equity engine.
 *
 * Minimum sample gate: below 8 hands, falls back to default random range.
 */
export function statsToVillainRange(stats: OpponentStats): VillainRange {
  if (stats.handsObserved < 8 || stats.confidence < 0.3) {
    return DEFAULT_VILLAIN_RANGE;
  }

  // Convert VPIP (0–1) to percentage (0–100)
  const vpipPct = Math.round(stats.vpip * 100);
  const clampedVpip = Math.max(5, Math.min(100, vpipPct));

  return vpipToRange(clampedVpip, stats.confidence);
}
