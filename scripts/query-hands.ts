/**
 * Query and summarize saved hand records.
 *
 * Usage:
 *   bun run scripts/query-hands.ts
 *   bun run scripts/query-hands.ts --json             # raw JSON output
 *   bun run scripts/query-hands.ts --street FLOP      # filter by street
 *   bun run scripts/query-hands.ts --group-by-hand    # session → hand → street view
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
        const record = JSON.parse(readFileSync(join(dirPath, file), "utf-8")) as HandRecord;
        records.push(record);
      } catch (err) {
        console.warn(`Skipping malformed record ${file}: ${err instanceof Error ? err.message : String(err)}`);
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

function groupByHand(records: HandRecord[]): void {
  // Group records by sessionId, then by pokerHandId
  const sessions = new Map<string, Map<string, HandRecord[]>>();

  for (const record of records) {
    const sessionKey = record.sessionId ?? "unknown-session";
    const handKey = record.pokerHandId ?? record.id; // fallback: one record = one hand

    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, new Map());
    }
    const hands = sessions.get(sessionKey);
    if (!hands) continue;
    if (!hands.has(handKey)) {
      hands.set(handKey, []);
    }
    const streetList = hands.get(handKey);
    if (streetList) streetList.push(record);
  }

  const STREET_ORDER: Record<string, number> = {
    PREFLOP: 1,
    FLOP: 2,
    TURN: 3,
    RIVER: 4,
  };

  console.log("Hand Session View");
  console.log("─".repeat(60));

  for (const [sessionId, hands] of sessions) {
    const firstRecord = [...hands.values()][0][0];
    const sessionDate = firstRecord.timestamp.slice(0, 16).replace("T", " ");
    const handCount = hands.size;
    const shortSession = sessionId === "unknown-session" ? sessionId : sessionId.slice(0, 8);

    console.log(`\nSession ${shortSession}… (${sessionDate}, ${handCount} hand${handCount !== 1 ? "s" : ""})`);

    for (const [handId, streetRecords] of hands) {
      const shortHand = handId.slice(0, 8);
      const sorted = [...streetRecords].sort(
        (a, b) => (STREET_ORDER[a.analysis.street ?? ""] ?? 0) - (STREET_ORDER[b.analysis.street ?? ""] ?? 0),
      );

      console.log(`  Hand ${shortHand}…`);

      for (const r of sorted) {
        const street = (r.analysis.street ?? "?").padEnd(7);
        const pos = (r.heroPosition ?? r.analysis.heroPosition ?? "?").padEnd(3);
        const temp = (r.tableTemperature ?? "?").padEnd(16);
        const action = r.analysis.action ?? "?";
        const amount = r.analysis.amount ? ` ${r.analysis.amount}` : "";
        const conf = r.analysis.confidence ? ` [${r.analysis.confidence}]` : "";
        const persona = r.personaSelected ? `  persona:${r.personaSelected.personaId}` : "";
        console.log(`    ${street}  ${pos}  ${temp}  → ${action}${amount}${conf}${persona}`);
      }
    }
  }

  console.log(`\nTotal: ${records.length} records across ${sessions.size} session(s)`);
}

function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes("--json");
  const groupByHandMode = args.includes("--group-by-hand");
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

  if (groupByHandMode) {
    groupByHand(records);
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

  // Table temperature (new field — may be null in older records)
  const withTemperature = records.filter((r) => r.tableTemperature != null);
  if (withTemperature.length > 0) {
    console.log(`\nTable temperature (${withTemperature.length}/${records.length} records):`);
    console.log(
      formatDistribution(
        count(withTemperature, (r) => r.tableTemperature!),
        withTemperature.length,
      ),
    );
  }

  // Persona selection coverage
  const withPersona = records.filter((r) => r.personaSelected != null);
  if (withPersona.length > 0) {
    console.log(`\nPersona selected (${withPersona.length}/${records.length} records):`);
    console.log(
      formatDistribution(
        count(withPersona, (r) => r.personaSelected!.personaId),
        withPersona.length,
      ),
    );
  }

  // Detection accuracy breakdown
  const allMatches = records.flatMap((r) => [
    ...(r.heroCardMatches ?? []),
    ...(r.communityCardMatches ?? []),
  ]);
  if (allMatches.length > 0) {
    console.log("\nCard detection:");
    const byConf = count(allMatches, (m) => m.confidence);
    const total = allMatches.length;
    console.log(`  Total cards detected: ${total}`);
    for (const conf of ["HIGH", "MEDIUM", "LOW", "NONE"]) {
      const n = byConf[conf] ?? 0;
      if (n > 0) {
        console.log(`  ${conf}: ${n} (${((n / total) * 100).toFixed(1)}%)`);
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
