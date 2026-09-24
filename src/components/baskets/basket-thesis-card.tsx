import type { BasketData } from "@/lib/types";
import { formatDateTimeLabel } from "@/lib/format";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// The trading thesis: what the model saw and why the rules selected these
// contracts, generated from the numbers the model actually used
// (shared/basket-thesis.mjs). Provenance is shown next to it so a rebuilt or
// reconstructed week is never mistaken for a live one.
export function BasketThesisCard({ basket }: { basket: BasketData }) {
  const { thesis, model } = basket;
  const provenanceLabel =
    model.provenance === "reconstructed"
      ? "Reconstructed"
      : model.provenance === "rebuilt-from-snapshot"
        ? "Rebuilt from snapshot"
        : "Live model";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <p className="eyebrow text-[10px] text-muted-foreground">Trading thesis</p>
          <Badge variant={model.provenance === "live-snapshot" ? "success" : "accent"}>{provenanceLabel}</Badge>
          {model.late ? <Badge variant="default">Late model entry, +{model.lateMinutes} min</Badge> : null}
          {model.modelEquity != null ? (
            <Badge variant="default">Model equity ${model.modelEquity.toLocaleString("en-US")}</Badge>
          ) : null}
        </div>
        <CardTitle className="mt-3 text-2xl">
          {thesis?.headline ?? "Thesis not generated for this basket"}
        </CardTitle>
        {model.entryTimestamp ? (
          <p className="text-sm text-muted-foreground">
            Model entry {formatDateTimeLabel(model.entryTimestamp)}
            {model.entryWindow
              ? ` · execution window ${formatDateTimeLabel(model.entryWindow.start)} to ${formatDateTimeLabel(model.entryWindow.end)}`
              : ""}
          </p>
        ) : null}
      </CardHeader>
      {thesis ? (
        <CardContent className="grid gap-6">
          {model.reconstructionNote ? (
            <p className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm leading-6">
              {model.reconstructionNote}
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {[
              ["Market regime", thesis.regime],
              ["Selection", thesis.selection],
              ["Risk and exits", thesis.risk],
              ["Model versus execution", thesis.execution],
            ].map(([label, text]) => (
              <div key={label} className="rounded-2xl border border-border/70 p-4">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                <p className="mt-3 text-sm leading-6">{text}</p>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Why each name</p>
            <ul className="mt-3 grid gap-3">
              {thesis.picks.map((pick) => (
                <li key={`${pick.ticker}-${pick.side}-${pick.strike}`} className="rounded-2xl border border-border/70 p-4">
                  <p className="text-sm font-semibold">
                    {pick.ticker} · {pick.side === "call" ? "short call" : "short put"} {pick.strike}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{pick.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      ) : (
        <CardContent className="text-sm leading-6 text-muted-foreground">
          This basket predates thesis generation. Run <code>scripts/backfill_thesis.mjs</code> to write one from its stored selection data.
        </CardContent>
      )}
    </Card>
  );
}
