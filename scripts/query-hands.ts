/**
 * Query and summarize saved hand records.
 *
 * Usage:
 *   bun run scripts/query-hands.ts
 *   bun run scripts/query-hands.ts --json          # raw JSON output
 *   bun run scripts/query-hands.ts --street FLOP   # filter by street
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import type { HandRecord } from "../lib/storage/hand-records";

const HANDS_DIR = join(process.cwd(), "data", "hands");

function loadAllRecords(): HandRecord[] {
  const records: HandRecord[] = [];

  let dateDirs: string[];
  try {
    dateDirs = readdirSync(HANDS_DIR).filter((d) =>
      statSync(join(HANDS_DIR, d)).isDirectory(),
    );
  } catch {
    return records;
  }

  for (const dateDir of dateDirs.sort()) {
    const dirPath = join(HANDS_DIR, dateDir);
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      try {
        const raw = readFileSync(join(dirPath, file), "utf-8");
        records.push(JSON.parse(raw) as HandRecord);
      } catch (err) {
        console.warn(`[skip] Failed to parse ${dateDir}/${file}:`, err);
      }
    }
  }

  return records.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function count<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function formatDistribution(dist: Record<string, number>, total: number): string {
  return Object.entries(dist)
    .sort(([, a], [, b]) => b - a)
    .map(([key, n]) => `  ${key}: ${n}  (${((n / total) * 100).toFixed(1)}%)`)
    .join("\n");
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const streetFilter = args.includes("--street")
    ? args[args.indexOf("--street") + 1]?.toUpperCase()
    : null;

  let records = loadAllRecords();

  if (records.length === 0) {
    console.log("No hand records found in data/hands/.");
    console.log("Set SAVE_HANDS=true in .env.local and analyze some hands.");
    return;
  }

  if (streetFilter) {
    records = records.filter((r) => r.analysis.street === streetFilter);
  }

  if (jsonMode) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  const dates = [...new Set(records.map((r) => r.timestamp.slice(0, 10)))].sort();

  console.log("Hand Records Summary");
  console.log("─".repeat(40));
  console.log(`Total records: ${records.length}`);
  console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);
  if (streetFilter) console.log(`Filter: street = ${streetFilter}`);

  console.log("\nBy capture mode:");
  console.log(
    formatDistribution(count(records, (r) => r.captureMode), records.length),
  );

  console.log("\nBy street:");
  console.log(
    formatDistribution(
      count(records, (r) => r.analysis.street ?? "unknown"),
      records.length,
    ),
  );

  console.log("\nBy recommended action:");
  console.log(
    formatDistribution(
      count(records, (r) => r.analysis.action ?? "unknown"),
      records.length,
    ),
  );

  console.log("\nBy confidence:");
  console.log(
    formatDistribution(
      count(records, (r) => r.analysis.confidence ?? "unknown"),
      records.length,
    ),
  );

  console.log("\nSystem prompt variants:");
  console.log(
    formatDistribution(
      count(records, (r) => r.systemPromptVariant),
      records.length,
    ),
  );

  // Detection accuracy breakdown
  const allDetails = records.flatMap((r) => r.detectionDetails);
  if (allDetails.length > 0) {
    console.log("\nCard detection:");
    const byConf = count(allDetails, (d) => d.confidence);
    const total = allDetails.length;
    console.log(`  Total cards detected: ${total}`);
    for (const conf of ["HIGH", "MEDIUM", "LOW", "NONE"] as const) {
      const n = byConf[conf] ?? 0;
      if (n > 0) {
        const subset = allDetails.filter((d) => d.confidence === conf);
        const avgScore = subset.reduce((s, d) => s + d.matchScore, 0) / n;
        const avgGap = subset.reduce((s, d) => s + d.gap, 0) / n;
        console.log(
          `  ${conf}: ${n} (${((n / total) * 100).toFixed(1)}%)  avg score: ${(avgScore * 100).toFixed(1)}%  avg gap: ${(avgGap * 100).toFixed(1)}%`,
        );
      }
    }
  }

  // Opponent analysis coverage
  const withOpponents = records.filter(
    (r) => r.analysis.opponents && r.analysis.opponents.length > 0,
  );
  console.log(
    `\nOpponent analysis: ${withOpponents.length}/${records.length} hands have opponent reads`,
  );

  if (withOpponents.length > 0) {
    const playerTypes = withOpponents.flatMap(
      (r) => r.analysis.opponents?.map((o) => o.playerType) ?? [],
    );
    console.log("  Player type distribution:");
    console.log(
      formatDistribution(
        count(playerTypes, (t) => t ?? "unknown"),
        playerTypes.length,
      ),
    );
  }
}

main();
