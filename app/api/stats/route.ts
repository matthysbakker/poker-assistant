/**
 * GET /api/stats?username=Player3
 *
 * Returns aggregated opponent stats computed from stored hand records.
 * Reads data/hands/**\/*.json, filters by username, and computes VPIP/AF/PFR.
 *
 * Response: { stats: OpponentStats | null, handsFound: number }
 *
 * Note: existing hand records use prose action strings (e.g. "FOLD", "CALL") without
 * street context. We derive approximate VPIP/PFR/AF from these strings.
 * New sessions populate `structuredActions` for more accurate future calculations.
 */

import { NextRequest, NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { OpponentStats } from "@/lib/poker/opponent-stats";
import { computeStats } from "@/lib/poker/opponent-stats";
import type { StructuredAction } from "@/lib/storage/sessions";

export const maxDuration = 10;

/** Convert a prose action string to a best-guess StructuredAction. */
function proseToStructured(action: string): StructuredAction | null {
  const upper = action.toUpperCase().trim();
  // Derive action type
  let actionType: StructuredAction["action"] | null = null;
  if (upper.startsWith("FOLD")) actionType = "FOLD";
  else if (upper.startsWith("CHECK")) actionType = "CHECK";
  else if (upper.startsWith("CALL")) actionType = "CALL";
  else if (upper.startsWith("RAISE") || upper.startsWith("BET ") || upper === "BET") {
    // Distinguish BET vs RAISE from prose (not always possible, default to RAISE)
    actionType = upper.startsWith("BET") ? "BET" : "RAISE";
  }

  if (!actionType) return null; // UNKNOWN or unrecognized

  // Without street context from prose, treat CALLs/RAISEs/BETs as potential VPIP
  const isVpip = actionType === "CALL" || actionType === "RAISE" || actionType === "BET";

  return {
    street: "PREFLOP", // default; prose doesn't tell us
    action: actionType,
    isVpip,
    timestamp: 0,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const username = url.searchParams.get("username");

  if (!username || username.trim().length === 0) {
    return NextResponse.json({ error: "username query param required" }, { status: 400 });
  }

  const sanitized = username.trim();
  const baseDir = join(process.cwd(), "data/hands");

  const allActions: StructuredAction[] = [];
  let handsFound = 0;

  try {
    const dates = await readdir(baseDir, { withFileTypes: true });
    const dateNames = dates
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort()
      .reverse();

    for (const d of dateNames) {
      const dirPath = join(baseDir, d);
      let files: string[];
      try {
        files = (await readdir(dirPath)).filter((f) => f.endsWith(".json"));
      } catch {
        continue;
      }

      for (const file of files) {
        try {
          const raw = await readFile(join(dirPath, file), "utf-8");
          const record = JSON.parse(raw);

          if (!record.opponentHistory) continue;

          // Find this username in the opponent history
          for (const opp of Object.values(record.opponentHistory) as Array<{
            username?: string;
            handsObserved?: number;
            actions?: string[];
            structuredActions?: StructuredAction[];
          }>) {
            if (opp.username !== sanitized) continue;

            // Prefer structuredActions if present (newer records)
            if (opp.structuredActions && opp.structuredActions.length > 0) {
              allActions.push(...opp.structuredActions);
              handsFound += opp.handsObserved ?? 1;
            } else if (opp.actions && opp.actions.length > 0) {
              // Fall back to prose actions
              for (const action of opp.actions) {
                const sa = proseToStructured(action);
                if (sa) allActions.push(sa);
              }
              handsFound += opp.handsObserved ?? 1;
            }
          }
        } catch {
          // Skip malformed records
        }
      }
    }
  } catch {
    // data/hands doesn't exist or is inaccessible
  }

  if (handsFound === 0) {
    return NextResponse.json({ stats: null, handsFound: 0 });
  }

  const stats: OpponentStats = computeStats(allActions, handsFound);
  return NextResponse.json({ stats, handsFound });
}
