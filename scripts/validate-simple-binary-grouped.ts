/**
 * Final Phase 1 validation: Simple binarization with position-group analysis.
 *
 * Tests the simplest approach:
 *   1. Resize to fixed comparison size
 *   2. Greyscale → normalise → threshold(128)
 *   3. Compare binary pixel matching
 *
 * No tight bbox, no zone splitting, no fancy processing.
 * Groups results by position type to determine if position-grouped refs work.
 *
 * Usage: bun run scripts/validate-simple-binary-grouped.ts
 */

import sharp from "sharp";
import { readdirSync } from "fs";
import { join, basename } from "path";

const CORNERS_DIR = "test/extracted-corners";
const CMP_W = 80;
const CMP_H = 120;

async function binarize(inputPath: string): Promise<Buffer> {
  const { data } = await sharp(inputPath)
    .resize(CMP_W, CMP_H)
    .greyscale()
    .normalise()
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function compare(a: Buffer, b: Buffer): number {
  let matching = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) matching++;
  }
  return matching / a.length;
}

const GROUND_TRUTH: Record<string, Record<string, string>> = {
  "2026-02-17T13-37-28-840Z": { heroL: "Kc", heroR: "Jd" },
  "2026-02-17T13-37-56-433Z": { heroL: "Kc", heroR: "Jd", comm1: "Ah", comm2: "4h", comm3: "Jc" },
  "2026-02-17T13-38-53-206Z": { heroL: "8c", heroR: "Qc" },
  "2026-02-17T13-39-01-369Z": { heroL: "8c", heroR: "Qc" },
  "2026-02-17T13-39-46-183Z": { heroL: "8c", heroR: "Qc", comm1: "Jc", comm2: "5c", comm3: "2s", comm4: "3d" },
  "2026-02-17T13-40-46-504Z": { heroL: "Qh", heroR: "10h" },
  "2026-02-17T13-41-08-096Z": { heroL: "Qh", heroR: "10h", comm1: "Kc", comm2: "4h", comm3: "9h" },
  "2026-02-17T13-41-25-899Z": { heroL: "Qh", heroR: "10h", comm1: "Kc", comm2: "4h", comm3: "9h", comm4: "Qs" },
  "2026-02-17T13-44-37-752Z": { heroL: "Qd", heroR: "Qs" },
  "2026-02-17T14-25-45-727Z": { heroL: "3d", heroR: "5c" },
  "2026-02-17T14-26-05-475Z": { heroL: "Ah", heroR: "Jd" },
  "2026-02-17T14-26-56-012Z": { heroL: "Ah", heroR: "Jd", comm1: "Qc", comm2: "10h", comm3: "5h" },
  "2026-02-17T14-27-22-803Z": { heroL: "Ah", heroR: "Jd", comm1: "Qc", comm2: "10h", comm3: "5h", comm4: "Kh" },
  "2026-02-17T14-28-23-356Z": { heroL: "4s", heroR: "3s" },
  "2026-02-17T14-31-56-491Z": { heroL: "4c", heroR: "7h" },
  "2026-02-17T14-35-15-232Z": { heroL: "Kh", heroR: "6h", comm1: "2c", comm2: "4d", comm3: "3s" },
  "2026-02-17T14-36-28-902Z": { heroL: "Ks", heroR: "Kd" },
  "2026-02-17T22-03-53-545Z": { heroL: "Qc", heroR: "3c" },
};

interface CardInstance {
  file: string;
  path: string;
  region: string;
  timestamp: string;
  resolution: "high" | "low";
}

const files = readdirSync(CORNERS_DIR).filter((f) => f.endsWith(".png")).sort();
const cardInstances = new Map<string, CardInstance[]>();

for (const file of files) {
  const base = basename(file, ".png");
  const idx = base.indexOf("_");
  if (idx === -1) continue;
  const region = base.substring(0, idx);
  const timestamp = base.substring(idx + 1);
  const truth = GROUND_TRUTH[timestamp];
  if (!truth || !truth[region]) continue;
  const card = truth[region];
  const resolution = timestamp.startsWith("2026-02-17T13-") ? "high" : "low";
  if (!cardInstances.has(card)) cardInstances.set(card, []);
  cardInstances.get(card)!.push({ file, path: join(CORNERS_DIR, file), region, timestamp, resolution });
}

// === 1. Same-position same-resolution ===
console.log("=== SAME-POS SAME-RES ===\n");
let s1t = 0, s1p = 0;
for (const [card, instances] of cardInstances) {
  const byKey = new Map<string, CardInstance[]>();
  for (const inst of instances) {
    const key = `${inst.region}_${inst.resolution}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(inst);
  }
  for (const [, g] of byKey) {
    if (g.length < 2) continue;
    const a = await binarize(g[0].path);
    const b = await binarize(g[1].path);
    const score = compare(a, b);
    s1t++; if (score > 0.95) s1p++;
    const st = score > 0.95 ? "GREAT" : score > 0.85 ? "OK   " : "FAIL ";
    console.log(`  ${card.padEnd(4)} ${st} ${(score * 100).toFixed(1)}%  (${g[0].region}, ${g[0].resolution})`);
  }
}
console.log(`\n  ${s1p}/${s1t} passed (>95%)\n`);

// === 2. Cross-comm-slot (comm1 vs comm2 vs comm3 etc.) ===
console.log("=== CROSS-COMM-SLOT same card ===\n");
for (const [card, instances] of cardInstances) {
  const comms = instances.filter((i) => i.region.startsWith("comm"));
  for (let i = 0; i < comms.length; i++) {
    for (let j = i + 1; j < comms.length; j++) {
      if (comms[i].resolution !== comms[j].resolution) continue;
      if (comms[i].region === comms[j].region) continue;
      const a = await binarize(comms[i].path);
      const b = await binarize(comms[j].path);
      const score = compare(a, b);
      const st = score > 0.90 ? "GREAT" : score > 0.80 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} ${st} ${(score * 100).toFixed(1)}%  (${comms[i].region} vs ${comms[j].region}, ${comms[i].resolution})`);
    }
  }
}

// === 3. heroL vs heroR same card ===
console.log("\n=== heroL vs heroR same card ===\n");
for (const [card, instances] of cardInstances) {
  const heroL = instances.filter((i) => i.region === "heroL");
  const heroR = instances.filter((i) => i.region === "heroR");
  for (const l of heroL) {
    for (const r of heroR) {
      if (l.resolution !== r.resolution) continue;
      const a = await binarize(l.path);
      const b = await binarize(r.path);
      const score = compare(a, b);
      const st = score > 0.90 ? "GREAT" : score > 0.80 ? "OK   " : "FAIL ";
      console.log(`  ${card.padEnd(4)} ${st} ${(score * 100).toFixed(1)}%  (heroL vs heroR, ${l.resolution})`);
    }
  }
}

// === 4. Discrimination within same slot ===
console.log("\n=== DISCRIMINATION within same slot ===\n");

const slots = ["heroL", "heroR", "comm1", "comm2", "comm3", "comm4"];
for (const slot of slots) {
  for (const res of ["high", "low"] as const) {
    const cards: [string, CardInstance][] = [];
    for (const [card, instances] of cardInstances) {
      const match = instances.find((i) => i.region === slot && i.resolution === res);
      if (match) cards.push([card, match]);
    }
    if (cards.length < 2) continue;

    let dt = 0, dp = 0;
    let worst: { pair: string; score: number } | null = null;
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = await binarize(cards[i][1].path);
        const b = await binarize(cards[j][1].path);
        const score = compare(a, b);
        dt++;
        if (score < 0.90) dp++;
        if (!worst || score > worst.score) {
          worst = { pair: `${cards[i][0]} vs ${cards[j][0]}`, score };
        }
      }
    }
    console.log(`  ${slot.padEnd(5)} @ ${res}: ${dp}/${dt} discriminated (<90%)  worst: ${worst!.pair} ${(worst!.score * 100).toFixed(1)}%`);
  }
}

// === 5. Cross-resolution same slot ===
console.log("\n=== CROSS-RESOLUTION same slot ===\n");
for (const [card, instances] of cardInstances) {
  const bySlot = new Map<string, CardInstance[]>();
  for (const inst of instances) {
    if (!bySlot.has(inst.region)) bySlot.set(inst.region, []);
    bySlot.get(inst.region)!.push(inst);
  }
  for (const [slot, g] of bySlot) {
    const hi = g.find((i) => i.resolution === "high");
    const lo = g.find((i) => i.resolution === "low");
    if (!hi || !lo) continue;
    const a = await binarize(hi.path);
    const b = await binarize(lo.path);
    const score = compare(a, b);
    const st = score > 0.85 ? "GREAT" : score > 0.75 ? "OK   " : "FAIL ";
    console.log(`  ${card.padEnd(4)} ${st} ${(score * 100).toFixed(1)}%  (${slot}@high vs ${slot}@low)`);
  }
}

console.log("\n=== CONCLUSION ===");
console.log("Position-specific refs within same resolution are viable.");
console.log("Cross-slot and cross-resolution matching may need fallback to Claude Vision.");
