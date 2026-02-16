export function LoadingState() {
  return (
    <div className="w-full animate-pulse space-y-4 rounded-xl border border-card-border bg-card-bg p-6">
      {/* Action badge skeleton */}
      <div className="flex items-center gap-3">
        <div className="h-8 w-20 rounded-full bg-zinc-700" />
        <div className="h-4 w-32 rounded bg-zinc-700" />
      </div>

      {/* Game state skeleton */}
      <div className="grid grid-cols-2 gap-3">
        <div className="h-4 w-full rounded bg-zinc-800" />
        <div className="h-4 w-full rounded bg-zinc-800" />
        <div className="h-4 w-3/4 rounded bg-zinc-800" />
        <div className="h-4 w-2/3 rounded bg-zinc-800" />
      </div>

      {/* Reasoning skeleton */}
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-zinc-800" />
        <div className="h-4 w-full rounded bg-zinc-800" />
        <div className="h-4 w-5/6 rounded bg-zinc-800" />
        <div className="h-4 w-4/5 rounded bg-zinc-800" />
      </div>

      {/* Tip skeleton */}
      <div className="h-16 w-full rounded-lg bg-zinc-800" />

      <p className="text-center text-sm text-zinc-500">
        Analyzing your hand...
      </p>
    </div>
  );
}
