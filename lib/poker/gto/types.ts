/** GTO lookup table types. */

export type GtoAction = "BET" | "CHECK" | "CALL" | "FOLD" | "RAISE";

export interface GtoEntry {
  key: string;            // normalized lookup key (for debugging)
  action: GtoAction;
  frequency: number;      // 0.0–1.0 (how often GTO takes this action)
  sizingFraction: number; // fraction of pot (0 if CHECK/FOLD/CALL)
  source: string;         // citation from gto-postflop-rule-engine.md
}

export type GtoTableLookupResult =
  | { hit: true; entry: GtoEntry }
  | { hit: false };
