import { formatCurrency } from "@/lib/format";
import type { PerformanceSnapshotData, PositionData } from "@/lib/types";

// The whole point of an archive is reading the thesis and the result on
// one screen. This is the result half: what the underlying actually did
// against the strike, what that cost or kept, said in one line.

export function resolvedSnapshot(
  position: PositionData,
): PerformanceSnapshotData | null {
  return (
    position.performanceHistory.find(
      (snapshot) => snapshot.confidence === "Expiry-Resolved",
    ) ??
    (position.latestPerformance?.confidence === "Expiry-Resolved"
      ? position.latestPerformance
      : null)
  );
}

export function SettledOutcome({ position }: { position: PositionData }) {
  const settled = resolvedSnapshot(position);
  if (!settled) {
    return null;
  }

  const settlePrice = settled.underlyingPrice;
  const wasBreached =
    position.optionType === "call"
      ? settlePrice > position.strike
      : settlePrice < position.strike;
  const distance = Math.abs(settlePrice - position.strike);
  const won = settled.pnlAmount >= 0;

  const story = wasBreached
    ? `Settled ${formatCurrency(settlePrice)}, through the ${formatCurrency(
        position.strike,
      )} strike by ${formatCurrency(distance)}. Gave back more than the ${formatCurrency(
        position.estimatedEntryCredit,
      )} collected.`
    : `Settled ${formatCurrency(settlePrice)}, ${formatCurrency(
        distance,
      )} clear of the ${formatCurrency(position.strike)} strike. Kept the full ${formatCurrency(
        position.estimatedEntryCredit,
      )} credit.`;

  return (
    <div
      className={`rounded-2xl border p-3 text-sm ${
        won
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-red-500/40 bg-red-500/5"
      }`}
    >
      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        Settled outcome
      </p>
      <p className="mt-2">{story}</p>
      <p className={`mt-1 font-semibold ${won ? "text-emerald-500" : "text-red-500"}`}>
        {won ? "+" : "−"}
        {formatCurrency(Math.abs(settled.pnlAmount))} modeled
      </p>
    </div>
  );
}
