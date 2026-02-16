import type { Opponent } from "@/lib/ai/schema";

const PLAYER_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  TIGHT_PASSIVE: { label: "Tight Passive", color: "text-blue-400" },
  TIGHT_AGGRESSIVE: { label: "Tight Aggressive", color: "text-purple-400" },
  LOOSE_PASSIVE: { label: "Loose Passive", color: "text-yellow-400" },
  LOOSE_AGGRESSIVE: { label: "Loose Aggressive", color: "text-red-400" },
  UNKNOWN: { label: "Unknown", color: "text-zinc-500" },
};

interface OpponentTableProps {
  opponents: Partial<Opponent>[];
}

export function OpponentTable({ opponents }: OpponentTableProps) {
  if (opponents.length === 0) return null;

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-zinc-400">
        Opponents
      </h3>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50 text-xs text-zinc-500">
              <th className="px-3 py-2">Seat</th>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Position</th>
              <th className="px-3 py-2">Stack</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Type</th>
            </tr>
          </thead>
          <tbody>
            {opponents.map((opp, i) => {
              const typeInfo = opp.playerType
                ? PLAYER_TYPE_LABELS[opp.playerType]
                : undefined;

              return (
                <tr
                  key={opp.seat ?? i}
                  className="border-b border-zinc-800/50 last:border-b-0"
                >
                  <td className="px-3 py-2 font-mono text-zinc-400">
                    {opp.seat ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {opp.username || "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {opp.position || "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-300">
                    {opp.stack || "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {opp.currentAction || "—"}
                  </td>
                  <td className={`px-3 py-2 font-medium ${typeInfo?.color ?? "text-zinc-500"}`}>
                    {typeInfo?.label ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
