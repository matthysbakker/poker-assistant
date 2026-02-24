import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export interface DecisionRecord {
  id: string;
  timestamp: string;
  action: string;
  amount?: string | null;
  confidence: number;
  reasoning: string;
  street: string;
  source: string;
  heroCards?: string | null;
  communityCards?: string | null;
  position?: string | null;
}

export async function writeDecisionRecord(record: DecisionRecord): Promise<void> {
  const date = record.timestamp.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) throw new Error("Invalid timestamp");
  const dir = join(process.cwd(), "data/decisions", date);
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, `${record.id}.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2));
}
