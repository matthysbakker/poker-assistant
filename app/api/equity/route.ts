/**
 * POST /api/equity
 *
 * Compute hero equity vs a villain range using poker-odds-calculator.
 *
 * Body: { heroCards: string[], communityCards: string[], villainCombos?: string[] }
 * Response: { equity: number, confidence: number }
 *
 * Card format: our internal format (e.g. "10s", "Ah", "Kd")
 * Library format: "Ts", "Ah", "Kd" (T for ten) — conversion applied internally.
 */

import { NextRequest, NextResponse } from "next/server";
import { OddsCalculator, CardGroup } from "poker-odds-calculator";

export const maxDuration = 10;

// ── Card format conversion ─────────────────────────────────────────────────────

/** Convert our internal card format to library format (10→T). */
function toLib(card: string): string {
  return card.replace(/^10/, "T");
}

// ── Hand class expansion ────────────────────────────────────────────────────────

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["h", "d", "c", "s"];
const RANK_INDEX: Record<string, number> = {};
for (let i = 0; i < RANKS.length; i++) RANK_INDEX[RANKS[i]] = i;

/**
 * Expand a hand class notation (e.g. "AKs", "22", "T9o") into specific two-card combo strings.
 * Each combo is in library format (e.g. "AhKh").
 */
function expandHandClass(notation: string): string[] {
  const combos: string[] = [];

  // Pairs: e.g. "AA", "22"
  if (notation.length === 2 && notation[0] === notation[1]) {
    const r = notation[0];
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        combos.push(r + SUITS[i] + r + SUITS[j]);
      }
    }
    return combos;
  }

  // Suited: e.g. "AKs", "T9s"
  if (notation.endsWith("s") && notation.length === 3) {
    const r1 = notation[0];
    const r2 = notation[1];
    for (const s of SUITS) {
      combos.push(r1 + s + r2 + s);
    }
    return combos;
  }

  // Offsuit: e.g. "AKo", "T9o"
  if (notation.endsWith("o") && notation.length === 3) {
    const r1 = notation[0];
    const r2 = notation[1];
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = 0; j < SUITS.length; j++) {
        if (i !== j) combos.push(r1 + SUITS[i] + r2 + SUITS[j]);
      }
    }
    return combos;
  }

  return combos;
}

/**
 * Sample N unique hand combos from a pool, filtering out conflicts with known cards.
 */
function sampleVillainCombos(
  pool: string[],
  knownCards: Set<string>,
  n: number,
): string[] {
  const eligible = pool.filter((combo) => {
    const c1 = combo.slice(0, 2).toLowerCase();
    const c2 = combo.slice(2, 4).toLowerCase();
    return !knownCards.has(c1) && !knownCards.has(c2) && c1 !== c2;
  });

  if (eligible.length <= n) return eligible;

  // Fisher-Yates shuffle + take first N
  const arr = [...eligible];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: { heroCards: string[]; communityCards: string[]; villainCombos?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { heroCards, communityCards, villainCombos } = body;

  if (!heroCards || heroCards.length < 2) {
    return NextResponse.json({ error: "heroCards required (min 2)" }, { status: 400 });
  }
  if (!communityCards || communityCards.length < 3) {
    return NextResponse.json({ error: "communityCards required (min 3)" }, { status: 400 });
  }

  try {
    // Convert hero and board cards to library format
    const heroLib = heroCards.map(toLib);
    const boardLib = communityCards.map(toLib);

    // Set of known card strings (lowercase, library format) to detect conflicts
    const knownSet = new Set<string>([
      ...heroLib.map((c) => c.toLowerCase()),
      ...boardLib.map((c) => c.toLowerCase()),
    ]);

    // Build villain combo pool
    let villainPool: string[];
    if (villainCombos && villainCombos.length > 0) {
      // Deduplicate hand class strings and expand
      const uniqueClasses = [...new Set(villainCombos)];
      const expanded: string[] = [];
      for (const cls of uniqueClasses) {
        // Already a concrete combo (4 chars)?
        if (cls.length === 4) {
          expanded.push(toLib(cls));
        } else {
          expanded.push(...expandHandClass(cls));
        }
      }
      villainPool = expanded;
    } else {
      // Default: random hand — use all 1326 combos
      const all: string[] = [];
      for (let i = 0; i < RANKS.length; i++) {
        for (let j = i; j < RANKS.length; j++) {
          if (i === j) {
            // Pair
            for (let s1 = 0; s1 < SUITS.length; s1++) {
              for (let s2 = s1 + 1; s2 < SUITS.length; s2++) {
                all.push(RANKS[i] + SUITS[s1] + RANKS[j] + SUITS[s2]);
              }
            }
          } else {
            // Non-pair
            for (const s1 of SUITS) {
              for (const s2 of SUITS) {
                all.push(RANKS[i] + s1 + RANKS[j] + s2);
              }
            }
          }
        }
      }
      villainPool = all;
    }

    // Sample up to 30 villain combos (performance budget for localhost ~5-20ms each)
    const sampled = sampleVillainCombos(villainPool, knownSet, 30);

    if (sampled.length === 0) {
      return NextResponse.json({ equity: 0.5, confidence: 0 });
    }

    // Hero hand as CardGroup
    const heroGroup = CardGroup.fromString(heroLib.join(""));
    const boardGroup = CardGroup.fromString(boardLib.join(""));

    // Compute equity vs each sampled villain combo and average
    let totalEquity = 0;
    let successCount = 0;

    for (const combo of sampled) {
      try {
        const villainGroup = CardGroup.fromString(combo);
        const result = OddsCalculator.calculate([heroGroup, villainGroup], boardGroup);
        totalEquity += result.equities[0].getEquity() / 100;
        successCount++;
      } catch {
        // Skip invalid combos (board conflict detection may miss some edge cases)
      }
    }

    if (successCount === 0) {
      return NextResponse.json({ equity: 0.5, confidence: 0 });
    }

    const equity = totalEquity / successCount;
    // Confidence: based on sample size (30 samples = high confidence)
    const confidence = Math.min(1.0, successCount / 20);

    return NextResponse.json({ equity, confidence });
  } catch (err) {
    console.error("[/api/equity] Error:", err);
    return NextResponse.json({ error: "Equity calculation failed" }, { status: 500 });
  }
}
