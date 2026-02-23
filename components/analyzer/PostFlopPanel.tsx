"use client";

interface PostFlopPanelProps {
  boardTexture?: string;
  draws?: string;
  equityEstimate?: string;
  spr?: string;
  potOdds?: string;
  facingAction?: string;
}

export function PostFlopPanel({
  boardTexture,
  draws,
  equityEstimate,
  spr,
  potOdds,
  facingAction,
}: PostFlopPanelProps) {
  return (
    <div className="rounded-lg border border-indigo-800/40 bg-indigo-950/20 p-4">
      <h3 className="mb-3 text-sm font-semibold text-indigo-300">
        Post-Flop Analysis
      </h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {boardTexture && (
          <div className="col-span-2">
            <span className="text-zinc-500">Board texture:</span>{" "}
            <span className="text-zinc-200">{boardTexture}</span>
          </div>
        )}
        {facingAction && (
          <div className="col-span-2">
            <span className="text-zinc-500">Facing:</span>{" "}
            <span className="text-zinc-200">{facingAction}</span>
          </div>
        )}
        {draws && (
          <div className="col-span-2">
            <span className="text-zinc-500">Draws:</span>{" "}
            <span className="text-zinc-200">{draws}</span>
          </div>
        )}
        {equityEstimate && (
          <div>
            <span className="text-zinc-500">Equity:</span>{" "}
            <span className="text-zinc-200">{equityEstimate}</span>
          </div>
        )}
        {spr && (
          <div>
            <span className="text-zinc-500">SPR:</span>{" "}
            <span className="text-zinc-200">{spr}</span>
          </div>
        )}
        {potOdds && (
          <div className="col-span-2">
            <span className="text-zinc-500">Pot odds:</span>{" "}
            <span className="text-zinc-200">{potOdds}</span>
          </div>
        )}
      </div>
    </div>
  );
}
