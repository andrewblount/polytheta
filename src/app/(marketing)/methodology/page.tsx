import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MethodologyPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-16 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <p className="eyebrow text-xs text-muted-foreground">Methodology</p>
        <h1 className="text-5xl font-semibold tracking-tight">How Polytheta works</h1>
        <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
          Polytheta packages each week as a complete basket: market context, structured
          call-side and put-side recommendations, operational rules, broker-ready order
          blocks, and ongoing performance tracking. Members can see not only what was
          published, but how the basket has evolved in observable terms over time.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {[
          {
            title: "1. Weekly basket construction",
            body: "Every basket includes market conditions, GSRS framing, radar status, thesis notes, alerts, stops, profit targets, and broker order blocks.",
          },
          {
            title: "2. Snapshot at publication",
            body: "When a basket is published, Polytheta stores the entry underlying price and attempts to capture the exact option contract baseline when free data supports it.",
          },
          {
            title: "3. Transparent performance updates",
            body: "Ongoing tracking distinguishes actual marks from modeled estimates. Expired positions show expiry-resolved outcomes, and manual fills can override modeled paths.",
          },
        ].map((item) => (
          <Card key={item.title}>
            <CardHeader>
              <CardTitle>{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm leading-7 text-muted-foreground">
              {item.body}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
