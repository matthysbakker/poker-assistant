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
// All 4 personas represent profitable archetypes — strategies that make money
// over many sessions. Based on modern poker theory and GTO research.
// See docs/brainstorms/2026-02-19-profitable-poker-personas-brainstorm.md

interface RangeDef {
  raise: string;
  call: string;
}

type PersonaRanges = Record<Position, RangeDef>;

// ── GTO Grinder ~23% VPIP ──
// Solver-balanced ranges with proper bluff:value ratios.
// Includes blocker aces (A5s/A4s) that other styles skip.
const GTO_GRINDER: PersonaRanges = {
  UTG: {
    raise: "77+, ATs+, A5s-A4s, KQs, KJs, QJs, JTs, AKo, AQo",
    call: "",
  },
  MP: {
    raise: "66+, A8s+, A5s-A4s, KTs+, QTs+, JTs, T9s, AKo, AQo, AJo",
    call: "",
  },
  CO: {
    raise: "44+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo",
    call: "",
  },
  BTN: {
    raise: "22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, QTo+, JTo",
    call: "",
  },
  SB: {
    raise: "55+, A7s+, A5s-A4s, KTs+, QTs+, JTs, T9s, 98s, ATo+, KJo+, QJo",
    call: "",
  },
  BB: {
    raise: "88+, ATs+, KQs, AKo, AQo",
    call: "22-77, A2s-A9s, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, A9o-ATo, KTo+, QJo, JTo",
  },
};

// ── TAG Shark ~20% VPIP ──
// Tight, linear, value-heavy. Every hand played is strong.
// The baseline winning style — consistent and disciplined.
const TAG_SHARK: PersonaRanges = {
  UTG: {
    raise: "77+, ATs+, KQs, AKo, AQo",
    call: "",
  },
  MP: {
    raise: "66+, A9s+, KJs+, QJs, AKo, AQo, AJo",
    call: "",
  },
  CO: {
    raise: "44+, A7s+, K9s+, QTs+, JTs, T9s, ATo+, KJo+, QJo",
    call: "",
  },
  BTN: {
    raise: "22+, A2s+, K7s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, A8o+, KTo+, QTo+, JTo",
    call: "",
  },
  SB: {
    raise: "66+, A8s+, KTs+, QJs, JTs, ATo+, KQo",
    call: "",
  },
  BB: {
    raise: "99+, AJs+, KQs, AKo",
    call: "22-88, A2s-ATs, K9s+, Q9s+, J9s+, T9s, 98s, 87s, A9o-AJo, KTo+, QJo, JTo",
  },
};

// ── LAG Assassin ~30% VPIP ──
// Wide ranges, relentless pressure. Raises or folds — almost never calls.
// Includes suited gappers and connectors other styles skip.
const LAG_ASSASSIN: PersonaRanges = {
  UTG: {
    raise: "55+, A5s+, K9s+, QTs+, JTs, T9s, 98s, ATo+, KJo+",
    call: "",
  },
  MP: {
    raise: "33+, A3s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, A9o+, KTo+, QJo",
    call: "",
  },
  CO: {
    raise: "22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, K9o+, QTo+, JTo",
    call: "",
  },
  BTN: {
    raise: "22+, A2s+, K2s+, Q4s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, 43s, A2o+, K7o+, Q9o+, J9o+, T9o",
    call: "",
  },
  SB: {
    raise: "33+, A2s+, K7s+, Q9s+, J9s+, T9s, 98s, 87s, A8o+, KTo+, QJo",
    call: "",
  },
  BB: {
    raise: "77+, A9s+, KJs+, QJs, AKo, AQo, AJo",
    call: "22-66, A2s-A8s, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A2o+, K9o+, QTo+, JTo, T9o",
  },
};

// ── Exploit Hawk ~22% VPIP ──
// TAG core with much wider steals in CO/BTN/SB.
// Tight EP (no marginal opens), wide LP (exploits fold-heavy blinds).
const EXPLOIT_HAWK: PersonaRanges = {
  UTG: {
    raise: "77+, ATs+, KQs, AKo, AQo",
    call: "",
  },
  MP: {
    raise: "66+, A9s+, KJs+, QJs, AKo, AQo, AJo",
    call: "",
  },
  CO: {
    raise: "33+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, A9o+, KTo+, QJo, JTo",
    call: "",
  },
  BTN: {
    raise: "22+, A2s+, K4s+, Q6s+, J7s+, T7s+, 96s+, 85s+, 75s+, 65s, 54s, A5o+, K9o+, QTo+, J9o+, T9o",
    call: "",
  },
  SB: {
    raise: "44+, A4s+, K8s+, QTs+, JTs, T9s, 98s, 87s, A9o+, KTo+, QJo",
    call: "",
  },
  BB: {
    raise: "88+, ATs+, KQs, AKo, AQo",
    call: "22-77, A2s-A9s, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, A8o-ATo, KTo+, QJo, JTo",
  },
};

// ─── Build and write ───

interface PersonaDef {
  id: string;
  name: string;
  tagline: string;
  style: string;
  ranges: PersonaRanges;
}

const PERSONA_DEFS: PersonaDef[] = [
  {
    id: "gto_grinder",
    name: "GTO Grinder",
    tagline: "Balanced ranges, no exploitable leaks",
    style: "gto",
    ranges: GTO_GRINDER,
  },
  {
    id: "tag_shark",
    name: "TAG Shark",
    tagline: "Premium hands, maximum aggression",
    style: "tag",
    ranges: TAG_SHARK,
  },
  {
    id: "lag_assassin",
    name: "LAG Assassin",
    tagline: "Wide ranges, relentless pressure",
    style: "lag",
    ranges: LAG_ASSASSIN,
  },
  {
    id: "exploit_hawk",
    name: "Exploit Hawk",
    tagline: "Adapts to the table, steals relentlessly",
    style: "exploit",
    ranges: EXPLOIT_HAWK,
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
    style: "${persona.style}",
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
  style: string;
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
