/**
 * Arbitration between GTO lookup (Phase 3) and equity bucket (Feature A).
 *
 * Logic:
 *   freq ≥ 0.70 → use GTO action, equity-adjust sizing
 *   freq 0.40–0.70 → use equity bucket to pick between GTO and equity
 *   freq < 0.40 or miss → use equity bucket directly
 */

import type { GtoEntry } from "./types";
import type { EquityBucket } from "../equity/buckets";
import type { BoardTexture } from "../board-analyzer";

export type DecisionSource = "gto" | "equity" | "ruletree";

export interface ArbitratedDecision {
  action: string;
  sizingFraction: number;
  source: DecisionSource;
  reasoning: string;
}

/**
 * Map equity bucket to a base action when no GTO hint is available.
 */
function equityBucketAction(
  bucket: EquityBucket,
  facingBet: boolean,
  inPosition: boolean,
  street: BoardTexture["street"],
): { action: string; sizingFraction: number } {
  if (facingBet) {
    switch (bucket) {
      case "dominating": return { action: "RAISE", sizingFraction: 2.5 };
      case "ahead":      return { action: "CALL",  sizingFraction: 0 };
      case "marginal":   return { action: "CALL",  sizingFraction: 0 };
      case "drawing":    return { action: "CALL",  sizingFraction: 0 };
      case "behind":     return { action: "FOLD",  sizingFraction: 0 };
    }
  }

  // Not facing bet
  switch (bucket) {
    case "dominating":
      return { action: "BET", sizingFraction: street === "river" ? 0.75 : inPosition ? 0.50 : 0.33 };
    case "ahead":
      return { action: "BET", sizingFraction: 0.33 };
    case "marginal":
      return { action: "CHECK", sizingFraction: 0 };
    case "drawing":
      return { action: inPosition ? "BET" : "CHECK", sizingFraction: 0.50 };
    case "behind":
      return street === "river"
        ? { action: "CHECK", sizingFraction: 0 }
        : { action: "CHECK", sizingFraction: 0 };
  }
}

export function arbitrate(
  gtoHint: GtoEntry | null | undefined,
  equityBucket: EquityBucket,
  board: BoardTexture,
  facingBet: boolean,
  position: string,
): ArbitratedDecision {
  const inPosition = position === "BTN" || position === "CO" || position === "BTN/SB";

  // No GTO hint — fall through to equity bucket
  if (!gtoHint) {
    const eq = equityBucketAction(equityBucket, facingBet, inPosition, board.street);
    return { ...eq, source: "equity", reasoning: `equity bucket: ${equityBucket}` };
  }

  // High-confidence GTO action (freq ≥ 0.70): use GTO action, equity-adjusted sizing
  if (gtoHint.frequency >= 0.70) {
    let sizingFraction = gtoHint.sizingFraction;
    // Equity override: dominating hands can bet slightly larger
    if (equityBucket === "dominating" && gtoHint.action === "BET" && sizingFraction < 0.66) {
      sizingFraction = Math.min(0.75, sizingFraction + 0.17);
    }
    return {
      action: gtoHint.action,
      sizingFraction,
      source: "gto",
      reasoning: `GTO ${gtoHint.action} (freq ${(gtoHint.frequency * 100).toFixed(0)}%)`,
    };
  }

  // Mixed GTO strategy (0.40–0.70): use equity bucket to resolve
  if (gtoHint.frequency >= 0.40) {
    const eq = equityBucketAction(equityBucket, facingBet, inPosition, board.street);
    // If equity and GTO agree on direction, blend sizing
    if (eq.action === gtoHint.action) {
      const blendedSizing = (eq.sizingFraction + gtoHint.sizingFraction) / 2;
      return {
        action: eq.action,
        sizingFraction: blendedSizing,
        source: "equity",
        reasoning: `equity ${equityBucket} / GTO mixed (freq ${(gtoHint.frequency * 100).toFixed(0)}%)`,
      };
    }
    // Disagreement: equity bucket wins
    return { ...eq, source: "equity", reasoning: `equity bucket ${equityBucket} overrides GTO mixed` };
  }

  // Low-frequency GTO hit (< 0.40) — equity bucket takes over
  const eq = equityBucketAction(equityBucket, facingBet, inPosition, board.street);
  return { ...eq, source: "equity", reasoning: `equity bucket ${equityBucket} (GTO freq too low)` };
}
