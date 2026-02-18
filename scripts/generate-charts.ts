/**
 * Generate static preflop persona charts from compact range definitions.
 *
 * Outputs lib/poker/personas.ts with full 169-hand charts for 4 personas x 6 positions.
 *
 * Usage: bun run scripts/generate-charts.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";

type PersonaAction = "RAISE" | "CALL" | "FOLD";
type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";

const RANKS = "AKQJT98765432";
const POSITIONS: Position[] = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

// ─── Hand key generation ───

function allHandKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
      if (i === j) {
        keys.push(`${RANKS[i]}${RANKS[j]}`);
      } else {
        keys.push(`${RANKS[i]}${RANKS[j]}s`);
        keys.push(`${RANKS[i]}${RANKS[j]}o`);
      }
    }
  }
  return keys;
}

const ALL_HANDS = allHandKeys();

// ─── Range expansion helpers ───

/** Expand "88+" to ["AA", "KK", "QQ", "JJ", "TT", "99", "88"] */
function expandPairsPlus(minRank: string): string[] {
  const idx = RANKS.indexOf(minRank);
  return RANKS.slice(0, idx + 1).split("").map((r) => `${r}${r}`);
}

/** Expand "22-66" to pairs in that range */
function expandPairsRange(lowRank: string, highRank: string): string[] {
  const hi = RANKS.indexOf(highRank);
  const lo = RANKS.indexOf(lowRank);
  return RANKS.slice(hi, lo + 1).split("").map((r) => `${r}${r}`);
}

/** Expand "ATs+" to all suited combos from AT to AK: ATs, AJs, AQs, AKs */
function expandSuitedPlus(highRank: string, minLowRank: string): string[] {
  const hiIdx = RANKS.indexOf(highRank);
  const loIdx = RANKS.indexOf(minLowRank);
  const result: string[] = [];
  for (let i = hiIdx + 1; i <= loIdx; i++) {
    result.push(`${highRank}${RANKS[i]}s`);
  }
  return result;
}

/** Expand "ATo+" to all offsuit combos from AT to AK */
function expandOffsuitPlus(highRank: string, minLowRank: string): string[] {
  const hiIdx = RANKS.indexOf(highRank);
  const loIdx = RANKS.indexOf(minLowRank);
  const result: string[] = [];
  for (let i = hiIdx + 1; i <= loIdx; i++) {
    result.push(`${highRank}${RANKS[i]}o`);
  }
  return result;
}

/** Expand "A2s-A5s" to suited combos in that range */
function expandSuitedRange(
  highRank: string,
  lowRankFrom: string,
  lowRankTo: string,
): string[] {
  const fromIdx = RANKS.indexOf(lowRankFrom);
  const toIdx = RANKS.indexOf(lowRankTo);
  const [hi, lo] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
  const result: string[] = [];
  for (let i = hi; i <= lo; i++) {
    result.push(`${highRank}${RANKS[i]}s`);
  }
  return result;
}

/** Parse compact notation into hand keys */
function parseRange(notation: string): string[] {
  const hands: string[] = [];

  for (const part of notation.split(",").map((s) => s.trim())) {
    if (!part) continue;

    // Pairs plus: "88+"
    const pairsPlus = part.match(/^([AKQJT2-9])\1\+$/);
    if (pairsPlus) {
      hands.push(...expandPairsPlus(pairsPlus[1]));
      continue;
    }

    // Pairs range: "22-66"
    const pairsRange = part.match(
      /^([AKQJT2-9])\1-([AKQJT2-9])\2$/,
    );
    if (pairsRange) {
      hands.push(...expandPairsRange(pairsRange[1], pairsRange[2]));
      continue;
    }

    // Suited plus: "ATs+"
    const suitedPlus = part.match(/^([AKQJT2-9])([AKQJT2-9])s\+$/);
    if (suitedPlus) {
      hands.push(...expandSuitedPlus(suitedPlus[1], suitedPlus[2]));
      continue;
    }

    // Offsuit plus: "ATo+"
    const offsuitPlus = part.match(/^([AKQJT2-9])([AKQJT2-9])o\+$/);
    if (offsuitPlus) {
      hands.push(...expandOffsuitPlus(offsuitPlus[1], offsuitPlus[2]));
      continue;
    }

    // Suited range: "A2s-A5s"
    const suitedRange = part.match(
      /^([AKQJT2-9])([AKQJT2-9])s-\1([AKQJT2-9])s$/,
    );
    if (suitedRange) {
      hands.push(
        ...expandSuitedRange(suitedRange[1], suitedRange[2], suitedRange[3]),
      );
      continue;
    }

    // Offsuit range: "A8o-ATo" → rewrite as expandOffsuitPlus variant
    const offsuitRange = part.match(
      /^([AKQJT2-9])([AKQJT2-9])o-\1([AKQJT2-9])o$/,
    );
    if (offsuitRange) {
      const highRank = offsuitRange[1];
      const fromIdx = RANKS.indexOf(offsuitRange[3]);
      const toIdx = RANKS.indexOf(offsuitRange[2]);
      const [hi, lo] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
      for (let i = hi; i <= lo; i++) {
        hands.push(`${highRank}${RANKS[i]}o`);
      }
      continue;
    }

    // Literal hand: "AKs", "AA", "AKo"
    if (ALL_HANDS.includes(part)) {
      hands.push(part);
      continue;
    }

    console.warn(`[warn] Unrecognized range notation: "${part}"`);
  }

  return hands;
}

function buildChart(
  raiseNotation: string,
  callNotation: string,
): Record<string, PersonaAction> {
  const chart: Record<string, PersonaAction> = {};

  // Default everything to FOLD
  for (const hand of ALL_HANDS) {
    chart[hand] = "FOLD";
  }

  // Apply CALL first (RAISE overwrites if overlap)
  for (const hand of parseRange(callNotation)) {
    chart[hand] = "CALL";
  }

  // Apply RAISE
  for (const hand of parseRange(raiseNotation)) {
    chart[hand] = "RAISE";
  }

  return chart;
}

// ─── Persona Range Definitions ───
// Based on Sklansky-Malmuth groups + standard opening range theory.
// VPIP targets are documented in the brainstorm.

interface RangeDef {
  raise: string;
  call: string;
}

type PersonaRanges = Record<Position, RangeDef>;

// ── Steady Sal (Nit) ~10% VPIP ──
// Very tight, mostly raises, rarely just calls.
const SAL: PersonaRanges = {
  UTG: {
    raise: "TT+, AKs, AQs, AKo",
    call: "99, AJs",
  },
  MP: {
    raise: "99+, AKs, AQs, AJs, AKo",
    call: "88, ATs, AQo",
  },
  CO: {
    raise: "88+, AJs+, ATs, KQs, AKo, AQo",
    call: "77, A9s, KJs, AJo",
  },
  BTN: {
    raise: "77+, ATs+, A5s-A4s, KQs, KJs, QJs, AKo, AQo, AJo",
    call: "66, A9s, KTs, QTs, ATo",
  },
  SB: {
    raise: "99+, AJs+, KQs, AKo, AQo",
    call: "88, ATs, KJs",
  },
  BB: {
    raise: "TT+, AKs, AQs, AKo",
    call: "88-99, AJs, ATs, KQs, KJs, QJs, AQo",
  },
};

// ── Sharp Eddie (TAG) ~20% VPIP ──
// Selective but aggressive. Widens significantly in late position.
const EDDIE: PersonaRanges = {
  UTG: {
    raise: "77+, ATs+, KQs, AKo, AQo",
    call: "66, A9s, KJs, AJo",
  },
  MP: {
    raise: "66+, A9s+, KJs+, QJs, AKo, AQo, AJo",
    call: "55, A8s, KTs, QTs, KQo",
  },
  CO: {
    raise: "55+, A7s+, K9s+, QTs+, JTs, T9s, ATo+, KQo, KJo",
    call: "44, A5s-A6s, K8s, Q9s, J9s, QJo",
  },
  BTN: {
    raise: "33+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, A8o+, KTo+, QJo, QTo",
    call: "22, K5s-K6s, Q8s, J8s, T8s, 97s, 76s, A7o, K9o, JTo",
  },
  SB: {
    raise: "66+, A8s+, KTs+, QJs, ATo+, KQo, KJo",
    call: "55, A5s-A7s, K9s, QTs, JTs, AJo, QJo",
  },
  BB: {
    raise: "88+, ATs+, KQs, AKo, AQo",
    call: "22-77, A2s-A9s, K8s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KJo+, QJo",
  },
};

// ── Wild Maya (LAG) ~30% VPIP ──
// Wide ranges, raises a lot. Puts constant pressure.
const MAYA: PersonaRanges = {
  UTG: {
    raise: "55+, A7s+, K9s+, QTs+, JTs, T9s, ATo+, KJo+",
    call: "44, A5s-A6s, K8s, Q9s, J9s, 98s, KTo, QJo",
  },
  MP: {
    raise: "44+, A4s+, K8s+, Q9s+, J9s+, T9s, 98s, A9o+, KTo+, QJo",
    call: "33, A2s-A3s, K7s, Q8s, J8s, T8s, 87s, A8o, K9o, QTo, JTo",
  },
  CO: {
    raise: "33+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, A7o+, K9o+, QTo+, JTo",
    call: "22, K2s-K4s, Q5s-Q7s, J7s, T7s, 96s, 86s, 75s, 65s, A5o-A6o, K8o, Q9o, J9o",
  },
  BTN: {
    raise: "22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K7o+, Q9o+, J9o+, T9o",
    call: "Q2s-Q4s, J5s-J6s, T6s, 95s, 85s, 74s, 64s, 53s, K5o-K6o, Q8o, J8o, T8o, 98o",
  },
  SB: {
    raise: "44+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, A8o+, KTo+, QJo",
    call: "33, K4s-K6s, Q7s-Q8s, J8s, T8s, 97s, 76s, 65s, A5o-A7o, K9o, QTo, JTo",
  },
  BB: {
    raise: "77+, A8s+, KTs+, QJs, ATo+, KJo+",
    call: "22-66, A2s-A7s, K4s-K9s, Q7s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A2o-A9o, K8o+, Q9o+, J9o+, T9o",
  },
};

// ── Curious Carl (Calling Station) ~45% VPIP ──
// Sees lots of flops, mostly by calling. Large VPIP-PFR gap.
const CARL: PersonaRanges = {
  UTG: {
    raise: "88+, ATs+, KQs, AKo",
    call: "22-77, A2s-A9s, K8s+, Q9s+, J9s+, T9s, 98s, 87s, A9o+, KTo+, QJo",
  },
  MP: {
    raise: "99+, ATs+, KQs, AKo, AQo",
    call: "22-88, A2s-A9s, K5s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, A7o+, K9o+, QTo+, JTo",
  },
  CO: {
    raise: "88+, ATs+, KQs, AKo, AQo",
    call: "22-77, A2s-A9s, K2s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 65s, 54s, A2o+, K7o+, Q9o+, J9o+, T9o",
  },
  BTN: {
    raise: "77+, A9s+, KJs+, AKo, AQo, AJo",
    call: "22-66, A2s-A8s, K2s+, Q2s+, J5s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K2o+, Q7o+, J8o+, T8o+, 98o",
  },
  SB: {
    raise: "88+, ATs+, KQs, AKo, AQo",
    call: "22-77, A2s-A9s, K6s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, A5o+, K9o+, QTo+, JTo, T9o",
  },
  BB: {
    raise: "TT+, AQs+, AKo",
    call: "22-99, A2s-AJs, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K5o+, Q8o+, J8o+, T8o+, 97o+, 87o, 76o",
  },
};

// ─── Build and write ───

interface PersonaDef {
  id: string;
  name: string;
  tagline: string;
  playerType: string;
  ranges: PersonaRanges;
}

const PERSONA_DEFS: PersonaDef[] = [
  {
    id: "steady_sal",
    name: "Steady Sal",
    tagline: "Only plays the nuts",
    playerType: "TIGHT_PASSIVE",
    ranges: SAL,
  },
  {
    id: "sharp_eddie",
    name: "Sharp Eddie",
    tagline: "Selective but strikes hard",
    playerType: "TIGHT_AGGRESSIVE",
    ranges: EDDIE,
  },
  {
    id: "wild_maya",
    name: "Wild Maya",
    tagline: "Wide ranges, relentless pressure",
    playerType: "LOOSE_AGGRESSIVE",
    ranges: MAYA,
  },
  {
    id: "curious_carl",
    name: "Curious Carl",
    tagline: "Can't resist seeing a flop",
    playerType: "LOOSE_PASSIVE",
    ranges: CARL,
  },
];

// Validate chart completeness
let totalHands = 0;
let totalRaise = 0;
let totalCall = 0;

const personaOutput: string[] = [];

for (const persona of PERSONA_DEFS) {
  const chartsEntries: string[] = [];

  for (const pos of POSITIONS) {
    const range = persona.ranges[pos];
    const chart = buildChart(range.raise, range.call);

    // Validate 169 entries
    const count = Object.keys(chart).length;
    if (count !== 169) {
      console.error(
        `ERROR: ${persona.name} ${pos} has ${count} entries (expected 169)`,
      );
      process.exit(1);
    }

    // Count stats
    const raiseCount = Object.values(chart).filter((a) => a === "RAISE").length;
    const callCount = Object.values(chart).filter((a) => a === "CALL").length;
    const vpip = ((raiseCount + callCount) / 169 * 100).toFixed(1);
    console.log(
      `  ${persona.name} ${pos}: ${raiseCount}R ${callCount}C ${169 - raiseCount - callCount}F (${vpip}% VPIP)`,
    );
    totalHands += count;
    totalRaise += raiseCount;
    totalCall += callCount;

    // Serialize chart compactly — one line per entry
    const entries = Object.entries(chart)
      .map(([hand, action]) => `"${hand}":"${action}"`)
      .join(",");
    chartsEntries.push(`    ${pos}: {${entries}}`);
  }

  personaOutput.push(`  {
    id: "${persona.id}",
    name: "${persona.name}",
    tagline: "${persona.tagline}",
    playerType: "${persona.playerType}",
    charts: {
${chartsEntries.join(",\n")}
    }
  }`);
}

const output = `/**
 * Static preflop persona charts — auto-generated by scripts/generate-charts.ts
 *
 * 4 personas × 6 positions × 169 hands = ${totalHands} data points.
 * Do not edit manually — modify the generation script instead.
 */

export type PersonaAction = "RAISE" | "CALL" | "FOLD";
export type ChartPosition = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";

export interface Persona {
  id: string;
  name: string;
  tagline: string;
  playerType: "TIGHT_PASSIVE" | "TIGHT_AGGRESSIVE" | "LOOSE_AGGRESSIVE" | "LOOSE_PASSIVE";
  charts: Record<ChartPosition, Record<string, PersonaAction>>;
}

export const PERSONAS: Persona[] = [
${personaOutput.join(",\n")}
];
`;

const outPath = join(process.cwd(), "lib/poker/personas.ts");
writeFileSync(outPath, output);

console.log(`\nGenerated ${outPath}`);
console.log(`Total: ${totalHands} entries, ${totalRaise} RAISE, ${totalCall} CALL, ${totalHands - totalRaise - totalCall} FOLD`);
