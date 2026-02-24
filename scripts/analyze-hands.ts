import { readdir, readFile } from "fs/promises";
import { join } from "path";

interface DetectionDetail {
  card: string;
  group: "hero" | "community";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  matchScore: number;
  gap: number;
}

interface HandRecord {
  id: string;
  timestamp: string;
  captureMode: "manual" | "continuous";
  sessionId: string | null;
  pokerHandId: string | null;
  screenshotFile: string;
  detectedText: string | null;
  detectionDetails: DetectionDetail[];
  handContext: string | null;
  opponentHistory: Record<number, { username?: string; handsObserved: number; actions: string[]; inferredType: string }> | null;
  systemPromptVariant: "standard" | "with-detected-cards";
  tableTemperature: string | null;
  tableReads: number | null;
  heroPosition: string | null;
  personaSelected: { personaId: string; personaName: string; action: string; temperature: string | null } | null;
  analysis: {
    cardReadingNotes?: string;
    heroCards: string;
    communityCards: string;
    heroPosition: string;
    potSize: string;
    heroStack: string;
    street: string;
    opponents: Array<{ seat: number; username?: string; position: string; stack: string; currentAction: string; playerType: string; notes: string }>;
    exploitAnalysis: string;
    action: string;
    amount: string;
    confidence: string;
    reasoning: string;
    concept: string;
    tip: string;
  };
}

async function loadAllRecords(): Promise<HandRecord[]> {
  const base = join(process.cwd(), "data/hands");
  const dateDirs = await readdir(base);
  const records: HandRecord[] = [];

  for (const date of dateDirs.sort()) {
    const files = (await readdir(join(base, date))).filter(f => f.endsWith(".json"));
    for (const file of files) {
      try {
        const raw = await readFile(join(base, date, file), "utf-8");
        records.push(JSON.parse(raw));
      } catch {}
    }
  }

  return records.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function parsePot(potStr: string): number {
  return parseFloat(potStr.replace(/[€$£,]/g, "")) || 0;
}

function parseStack(stackStr: string): number {
  return parseFloat(stackStr.replace(/[€$£,]/g, "")) || 0;
}

function counter<T extends string>(items: T[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const i of items) c[i] = (c[i] || 0) + 1;
  return c;
}

function pct(n: number, total: number) {
  return total === 0 ? "0%" : `${((n / total) * 100).toFixed(1)}%`;
}

function topN(obj: Record<string, number>, n = 5): [string, number][] {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function avg(nums: number[]): number {
  return nums.length === 0 ? 0 : nums.reduce((a, b) => a + b, 0) / nums.length;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

const records = await loadAllRecords();
const total = records.length;

console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  POKER ASSISTANT — DEEP DATA ANALYSIS");
console.log(`  ${total} hand records across ${new Set(records.map(r => r.timestamp.slice(0, 10))).size} sessions`);
console.log("═══════════════════════════════════════════════════════════════\n");

// ─── 1. DATE DISTRIBUTION ─────────────────────────────────────────────────
const byDate = counter(records.map(r => r.timestamp.slice(0, 10)));
console.log("── 1. SESSIONS BY DATE ─────────────────────────────────────────");
for (const [date, count] of Object.entries(byDate).sort()) {
  console.log(`  ${date}  ${count} records`);
}

// ─── 2. CAPTURE MODE ──────────────────────────────────────────────────────
const byMode = counter(records.map(r => r.captureMode));
console.log("\n── 2. CAPTURE MODE ─────────────────────────────────────────────");
for (const [mode, count] of Object.entries(byMode)) {
  console.log(`  ${mode.padEnd(12)} ${count}  (${pct(count, total)})`);
}

// ─── 3. STREETS ───────────────────────────────────────────────────────────
const byStreet = counter(records.map(r => r.analysis.street || "UNKNOWN"));
console.log("\n── 3. STREET DISTRIBUTION ──────────────────────────────────────");
for (const [street, count] of Object.entries(byStreet).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${street.padEnd(12)} ${count}  (${pct(count, total)})`);
}

// ─── 4. ACTIONS ───────────────────────────────────────────────────────────
const byAction = counter(records.map(r => r.analysis.action || "UNKNOWN"));
console.log("\n── 4. AI-RECOMMENDED ACTIONS ───────────────────────────────────");
for (const [action, count] of Object.entries(byAction).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${action.padEnd(12)} ${count}  (${pct(count, total)})`);
}

// ─── 5. CONFIDENCE ────────────────────────────────────────────────────────
const byConf = counter(records.map(r => r.analysis.confidence || "UNKNOWN"));
console.log("\n── 5. AI CONFIDENCE ────────────────────────────────────────────");
for (const [conf, count] of Object.entries(byConf).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${conf.padEnd(12)} ${count}  (${pct(count, total)})`);
}

// ─── 6. HERO POSITIONS ────────────────────────────────────────────────────
const byPos = counter(records.map(r => r.analysis.heroPosition || r.heroPosition || "UNKNOWN"));
console.log("\n── 6. HERO POSITION ────────────────────────────────────────────");
for (const [pos, count] of Object.entries(byPos).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pos.padEnd(12)} ${count}  (${pct(count, total)})`);
}

// ─── 7. POT SIZES ─────────────────────────────────────────────────────────
const pots = records.map(r => parsePot(r.analysis.potSize)).filter(p => p > 0);
const potBuckets: Record<string, number> = { "€0–0.50": 0, "€0.50–1": 0, "€1–2": 0, "€2–5": 0, "€5+": 0 };
for (const p of pots) {
  if (p < 0.5) potBuckets["€0–0.50"]++;
  else if (p < 1) potBuckets["€0.50–1"]++;
  else if (p < 2) potBuckets["€1–2"]++;
  else if (p < 5) potBuckets["€2–5"]++;
  else potBuckets["€5+"]++;
}
console.log("\n── 7. POT SIZES ────────────────────────────────────────────────");
console.log(`  avg: €${avg(pots).toFixed(2)}  min: €${Math.min(...pots).toFixed(2)}  max: €${Math.max(...pots).toFixed(2)}`);
for (const [bucket, count] of Object.entries(potBuckets)) {
  console.log(`  ${bucket.padEnd(12)} ${count}  (${pct(count, pots.length)})`);
}

// ─── 8. HERO STACKS ───────────────────────────────────────────────────────
const stacks = records.map(r => parseStack(r.analysis.heroStack)).filter(s => s > 0);
console.log("\n── 8. HERO STACKS ──────────────────────────────────────────────");
console.log(`  avg: €${avg(stacks).toFixed(2)}  min: €${Math.min(...stacks).toFixed(2)}  max: €${Math.max(...stacks).toFixed(2)}`);

// ─── 9. DETECTION QUALITY ─────────────────────────────────────────────────
const allDetections = records.flatMap(r => r.detectionDetails || []);
const confByGroup = { hero: counter(records.flatMap(r => r.detectionDetails?.filter(d => d.group === "hero").map(d => d.confidence) || [])), community: counter(records.flatMap(r => r.detectionDetails?.filter(d => d.group === "community").map(d => d.confidence) || [])) };
const avgScore = avg(allDetections.map(d => d.matchScore));
const avgGap = avg(allDetections.map(d => d.gap));
const noDetection = records.filter(r => (r.detectionDetails || []).length === 0).length;
const heroMissing = records.filter(r => {
  const heroCards = r.detectionDetails?.filter(d => d.group === "hero") || [];
  return heroCards.length < 2;
}).length;

console.log("\n── 9. CARD DETECTION QUALITY ───────────────────────────────────");
console.log(`  total detections: ${allDetections.length}  avg score: ${(avgScore * 100).toFixed(1)}%  avg gap: ${(avgGap * 100).toFixed(1)}%`);
console.log(`  records with NO detection: ${noDetection}  (${pct(noDetection, total)})`);
console.log(`  records with < 2 hero cards: ${heroMissing}  (${pct(heroMissing, total)})`);
console.log("  hero card confidence:");
for (const [conf, count] of Object.entries(confByGroup.hero).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${conf.padEnd(10)} ${count}`);
}
console.log("  community card confidence:");
for (const [conf, count] of Object.entries(confByGroup.community).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${conf.padEnd(10)} ${count}`);
}

// ─── 10. CONCEPTS TAUGHT ──────────────────────────────────────────────────
const concepts = counter(records.map(r => r.analysis.concept || "none"));
console.log("\n── 10. CONCEPTS TAUGHT (top 15) ────────────────────────────────");
for (const [concept, count] of topN(concepts, 15)) {
  console.log(`  ${concept.padEnd(35)} ${count}`);
}

// ─── 11. ACTION × STREET ──────────────────────────────────────────────────
console.log("\n── 11. ACTION BY STREET ────────────────────────────────────────");
const streets = ["PREFLOP", "FLOP", "TURN", "RIVER"];
const actions = Object.keys(byAction).sort();
const header = "               " + actions.map(a => a.padEnd(9)).join("");
console.log(header);
for (const street of streets) {
  const streetRecords = records.filter(r => r.analysis.street === street);
  if (streetRecords.length === 0) continue;
  const ac = counter(streetRecords.map(r => r.analysis.action || "UNKNOWN"));
  const row = [street.padEnd(15), ...actions.map(a => String(ac[a] || 0).padEnd(9))].join("");
  console.log("  " + row + `  n=${streetRecords.length}`);
}

// ─── 12. OPPONENT ANALYSIS ────────────────────────────────────────────────
const allOpponents = records.flatMap(r => r.analysis.opponents || []);
const playerTypes = counter(allOpponents.map(o => o.playerType || "UNKNOWN"));
const uniqueUsernames = new Set(allOpponents.map(o => o.username).filter(Boolean));
console.log("\n── 12. OPPONENT PROFILES ───────────────────────────────────────");
console.log(`  unique usernames encountered: ${uniqueUsernames.size}`);
console.log("  player type distribution:");
for (const [type, count] of Object.entries(playerTypes).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${type.padEnd(25)} ${count}  (${pct(count, allOpponents.length)})`);
}

// Username frequency
const usernameFreq = counter(allOpponents.map(o => o.username || "").filter(Boolean));
console.log("  most observed opponents:");
for (const [name, count] of topN(usernameFreq, 8)) {
  const types = allOpponents.filter(o => o.username === name).map(o => o.playerType);
  const latestType = types[types.length - 1];
  console.log(`    ${name.padEnd(20)} seen ${count}x  type: ${latestType}`);
}

// ─── 13. TABLE TEMPERATURE ────────────────────────────────────────────────
const temps = records.map(r => r.tableTemperature).filter(Boolean) as string[];
if (temps.length > 0) {
  const byTemp = counter(temps);
  console.log("\n── 13. TABLE TEMPERATURE ───────────────────────────────────────");
  for (const [temp, count] of Object.entries(byTemp).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${temp.padEnd(15)} ${count}  (${pct(count, temps.length)})`);
  }
}

// ─── 14. PERSONA USAGE ────────────────────────────────────────────────────
const personas = records.map(r => r.personaSelected?.personaName).filter(Boolean) as string[];
if (personas.length > 0) {
  const byPersona = counter(personas);
  console.log("\n── 14. PERSONA USAGE ───────────────────────────────────────────");
  for (const [persona, count] of Object.entries(byPersona).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${persona.padEnd(30)} ${count}  (${pct(count, personas.length)})`);
  }
}

// ─── 15. SYSTEM PROMPT VARIANT ────────────────────────────────────────────
const byVariant = counter(records.map(r => r.systemPromptVariant || "standard"));
console.log("\n── 15. SYSTEM PROMPT VARIANT ───────────────────────────────────");
for (const [variant, count] of Object.entries(byVariant)) {
  console.log(`  ${variant.padEnd(25)} ${count}  (${pct(count, total)})`);
}

// ─── 16. HERO CARDS ───────────────────────────────────────────────────────
const heroHands = records.map(r => r.analysis.heroCards).filter(h => h && !h.includes("unreadable") && h.trim().length > 0);
const ranks = heroHands.flatMap(h => h.split(" ").map(c => c.charAt(0))).filter(r => r && r !== "[");
const rankFreq = counter(ranks);
console.log("\n── 16. HERO CARD RANKS (detected) ──────────────────────────────");
console.log(`  readable hero hands: ${heroHands.length} / ${total}`);
for (const [rank, count] of topN(rankFreq, 13)) {
  console.log(`  ${rank.padEnd(5)} ${count}`);
}

// ─── 17. AI CARD READING ACCURACY ─────────────────────────────────────────
const detectAndAnalyze = records.filter(r => (r.detectionDetails || []).length > 0);
const agreeCount = detectAndAnalyze.filter(r => {
  const detectedCards = (r.detectionDetails || []).map(d => d.card?.toLowerCase()).filter(Boolean);
  const aiCards = [...(r.analysis.heroCards || "").split(" "), ...(r.analysis.communityCards || "").split(" ")]
    .map(c => c.toLowerCase().trim()).filter(c => c && !c.includes("[") && !c.includes("unreadable"));
  return detectedCards.some(dc => aiCards.includes(dc));
}).length;

console.log("\n── 17. DETECTION vs AI AGREEMENT ───────────────────────────────");
console.log(`  records with detection:  ${detectAndAnalyze.length}`);
console.log(`  at least 1 card agreed:  ${agreeCount}  (${pct(agreeCount, detectAndAnalyze.length)})`);

// ─── 18. RECENT SESSION SUMMARY (last 20 records) ─────────────────────────
const recent = records.slice(-20);
const recentActions = counter(recent.map(r => r.analysis.action || "?"));
const recentStreets = counter(recent.map(r => r.analysis.street || "?"));
console.log("\n── 18. LAST 20 RECORDS (most recent session) ───────────────────");
console.log(`  date range: ${recent[0].timestamp.slice(0, 16)} → ${recent[recent.length-1].timestamp.slice(0, 16)}`);
console.log("  actions: " + Object.entries(recentActions).map(([a, n]) => `${a}:${n}`).join("  "));
console.log("  streets: " + Object.entries(recentStreets).map(([s, n]) => `${s}:${n}`).join("  "));
const recentPots = recent.map(r => parsePot(r.analysis.potSize)).filter(p => p > 0);
console.log(`  avg pot: €${avg(recentPots).toFixed(2)}`);

console.log("\n═══════════════════════════════════════════════════════════════\n");
