import type { EntryPricingData } from "@/lib/types";
const money = (value: number) => Number.isFinite(value) ? value.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "Unavailable";
export function EntryPricingDetails({ pricing }: { pricing: EntryPricingData }) {
  return <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">Entry price calculation</summary>
    <dl className="mt-3 grid grid-cols-2 gap-3">{[
      ["Reference premium", money(pricing.referenceCredit)], ["Calendar days elapsed", pricing.elapsedCalendarDays.toFixed(2)],
      ["Reference stock price", money(pricing.referenceSpot)], ["Stock price at calculation", money(pricing.spot)],
      ["Time effect", money(pricing.timeEffect)], ["Underlying effect", money(pricing.underlyingEffect)],
      ["IV effect", money(pricing.ivEffect)], ["Adjusted estimate", money(pricing.credit)],
    ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{value}</dd></div>)}</dl>
    <p className="mt-3 text-xs text-muted-foreground">{pricing.ivSource} · IV {(pricing.iv * 100).toFixed(1)}%. Reference {new Date(pricing.observedAt).toLocaleString()}; estimated {new Date(pricing.estimatedAt).toLocaleString()}. Actual fill and fees are separate.</p>
  </details>;
}
