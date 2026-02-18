import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import type { HandAnalysis } from "@/lib/ai/schema";
import type { CardMatch, DetectionResult } from "@/lib/card-detection/types";

export interface DetectionDetail {
  card: string;
  group: "hero" | "community";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  matchScore: number;
  gap: number;
}

export interface HandRecord {
  id: string;
  timestamp: string;
  captureMode: "manual" | "continuous";

  // What the AI saw (inputs)
  screenshotFile: string;
  detectedText: string | null;
  detectionDetails: DetectionDetail[];
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

  // What the AI produced (outputs)
  analysis: HandAnalysis;
}

function mapMatchToDetail(
  match: CardMatch,
  group: "hero" | "community",
): DetectionDetail {
  return {
    card: match.card ?? "unknown",
    group,
    confidence: match.confidence,
    matchScore: match.matchScore,
    gap: match.gap,
  };
}

export function buildDetectionDetails(
  detection: DetectionResult | null,
): DetectionDetail[] {
  if (!detection) return [];

  const details: DetectionDetail[] = [];
  for (const match of detection.heroCards) {
    details.push(mapMatchToDetail(match, "hero"));
  }
  for (const match of detection.communityCards) {
    details.push(mapMatchToDetail(match, "community"));
  }
  return details;
}

export async function writeHandRecord(
  record: HandRecord,
  imageBuffer: Buffer,
): Promise<void> {
  const date = record.timestamp.slice(0, 10);
  const dir = join(process.cwd(), "data/hands", date);
  await mkdir(dir, { recursive: true });

  await Promise.all([
    writeFile(join(dir, `${record.id}.json`), JSON.stringify(record, null, 2)),
    writeFile(join(dir, `${record.id}.jpg`), imageBuffer),
  ]);
}
