import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { HandAnalysis } from "@/lib/ai/schema";
import type { Position } from "@/lib/card-detection/types";
import type { TableTemperature } from "@/lib/poker/table-temperature";

export interface HandRecord {
  id: string;
  timestamp: string;
  captureMode: "manual" | "continuous";

  // Linkage — groups records into sessions and hands
  sessionId: string | null;
  pokerHandId: string | null;

  // What the AI saw (inputs)
  screenshotFile: string;
  detectedText: string | null;
  /** Raw card detection matches for hero cards. Null when detection was skipped. */
  heroCardMatches: Array<{ card: string; confidence: string }> | null;
  /** Raw card detection matches for community cards. Null when detection was skipped. */
  communityCardMatches: Array<{ card: string; confidence: string }> | null;
  handContext: string | null;
  opponentHistory:
    | Record<
        number,
        {
          username?: string;
          handsObserved: number;
          actions: string[];
          inferredType: string;
        }
      >
    | null;
  systemPromptVariant: "standard" | "with-detected-cards";

  // Table context at time of decision
  tableTemperature: TableTemperature | null;
  /** Number of opponents with a classified player type that informed the temperature. */
  tableReads: number | null;
  heroPosition: Position | null;
  personaSelected: {
    personaId: string;
    personaName: string;
    action: string;
    temperature: TableTemperature | null;
  } | null;

  // What the AI produced (outputs)
  analysis: HandAnalysis;
}

/**
 * Lists hand record files from data/hands/. Returns records sorted newest-first.
 * @param options.date - Filter by date string YYYY-MM-DD (optional)
 * @param options.limit - Max records to return (default 20, max 100)
 * @param options.offset - Skip first N records (for pagination)
 */
export async function readHandRecords(
  options: {
    date?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<HandRecord[]> {
  const { date, limit = 20, offset = 0 } = options;
  const clampedLimit = Math.min(limit, 100);
  const baseDir = join(process.cwd(), "data/hands");

  try {
    // Get date directories, sorted newest-first
    let dates: string[];
    if (date) {
      dates = [date];
    } else {
      const entries = await readdir(baseDir, { withFileTypes: true });
      dates = entries
        .filter(
          (e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name),
        )
        .map((e) => e.name)
        .sort()
        .reverse();
    }

    const records: HandRecord[] = [];

    for (const d of dates) {
      if (records.length >= clampedLimit + offset) break;
      const dirPath = join(baseDir, d);
      try {
        const files = await readdir(dirPath);
        const jsonFiles = files
          .filter((f) => f.endsWith(".json"))
          .sort()
          .reverse();

        for (const file of jsonFiles) {
          if (records.length >= clampedLimit + offset) break;
          try {
            const content = await readFile(join(dirPath, file), "utf-8");
            const record = JSON.parse(content) as HandRecord;
            records.push(record);
          } catch {
            // Skip malformed records
          }
        }
      } catch {
        // Skip inaccessible date directories
      }
    }

    return records.slice(offset, offset + clampedLimit);
  } catch {
    // data/hands/ doesn't exist yet
    return [];
  }
}

/**
 * Reads a single hand record by ID. Searches across all date directories.
 */
export async function readHandRecord(id: string): Promise<HandRecord | null> {
  // Validate ID to prevent path traversal
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  const baseDir = join(process.cwd(), "data/hands");

  try {
    const dates = await readdir(baseDir, { withFileTypes: true });
    for (const d of dates.filter((e) => e.isDirectory())) {
      const filePath = join(baseDir, d.name, `${id}.json`);
      try {
        const content = await readFile(filePath, "utf-8");
        return JSON.parse(content) as HandRecord;
      } catch {
        // Not in this date directory
      }
    }
  } catch {
    // data/hands/ doesn't exist
  }
  return null;
}

export async function writeHandRecord(
  record: HandRecord,
  imageBuffer?: Buffer,
): Promise<void> {
  const date = record.timestamp.slice(0, 10);
  const dir = join(process.cwd(), "data/hands", date);
  await mkdir(dir, { recursive: true });

  const writes: Promise<void>[] = [
    writeFile(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2)),
  ];
  if (imageBuffer && imageBuffer.length > 0) {
    writes.push(writeFile(join(dir, `${record.id}.png`), imageBuffer));
  }
  await Promise.all(writes);
}
