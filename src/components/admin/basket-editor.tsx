"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Wand2 } from "lucide-react";

import { saveBasketAction } from "@/app/(app)/admin/actions";
import { parseBasketMarkdownToDraft } from "@/lib/markdown-import";
import { toSlug } from "@/lib/utils";
import type { PositionData } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EditablePosition = Partial<
  Omit<PositionData, "latestPerformance" | "performanceHistory" | "basketId">
> & {
  id?: string;
  side?: "call" | "put";
  optionType?: "call" | "put";
};

type Draft = {
  id?: string;
  title: string;
  slug: string;
  weekOf: string;
  publicationDate?: string;
  status: "draft" | "published" | "archived";
  gsrs: number;
  radarStatus: string;
  cashNeeded: number;
  disclaimer: string;
  quickSummary: Array<{ label: string; value: string; hint?: string }>;
  commentary: string;
  adminNotes: string;
  marketConditions: {
    gsrsNote: string;
    vix: number;
    skew: number;
    hyOas: number;
    move: number;
    putCallRatio: number;
    acquisitionRadarStatus: string;
    downsideGapRadarStatus: string;
    narrative: string;
  };
  portfolioSummary: {
    totalNames: number;
    callCount: number;
    putCount: number;
    totalMargin: number;
    cashNeeded: number;
    totalEstimatedCredit: number;
    dailyTheta: number;
    concentrationNote: string;
    gsrsConstraintNote: string;
  };
  callPositions: EditablePosition[];
  putPositions: EditablePosition[];
  orderBlocks: Array<{ id?: string; broker: string; side: string; title: string; orderText: string }>;
  priceAlerts: Array<{ id?: string; positionId?: string; ticker: string; side: "call" | "put"; label: string; thresholdValue: number; protocolNote: string }>;
  hardStops: Array<{ id?: string; title: string; body: string }>;
  profitTargets: Array<{ id?: string; title: string; body: string }>;
};

function makeBlankPosition(side: "call" | "put") {
  return {
    id: crypto.randomUUID(),
    side,
    optionType: side,
    ticker: "",
    entryUnderlyingPrice: 0,
    ivRank: 0,
    shortInterestPctFloat: 0,
    fanScore: 0,
    glassdoorScore: 0,
    buybackScore: side === "put" ? 1 : 0,
    strike: 0,
    expiry: "",
    delta: 0.15,
    estimatedEntryCredit: 0,
    contracts: 0,
    margin: side === "put" ? 10000 : 50000,
    breakAlert1: side === "call" ? 0 : undefined,
    breakAlert2: side === "call" ? 0 : undefined,
    atr14d: side === "put" ? 0 : undefined,
    buffer: side === "put" ? "" : undefined,
    probabilityOfTouch: side === "put" ? 0.3 : undefined,
    thesisSummary: "",
    thesisBullets: [],
    cautionFlags: [],
    entryTimestamp: new Date().toISOString(),
  };
}

const baseDisclaimer =
  "I am not a financial advisor. This system carries extreme risk of total or greater-than-account loss. Always verify every price, chain, margin requirement, and order live on your broker platform before submitting any real trade.";

export function BasketEditor({ initialDraft }: { initialDraft: Draft }) {
  const [draft, setDraft] = useState(initialDraft);
  const [markdown, setMarkdown] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const computed = useMemo(() => {
    const positions = [...draft.callPositions, ...draft.putPositions];
    const totalMargin = positions.reduce(
      (sum, position) => sum + Number(position.margin ?? 0),
      0,
    );
    const totalEstimatedCredit = positions.reduce(
      (sum, position) =>
        sum +
        Number(position.estimatedEntryCredit ?? 0) * 100 * Number(position.contracts ?? 0),
      0,
    );

    return {
      quickSummary: [
        { label: "GSRS", value: String(draft.gsrs), hint: draft.marketConditions.gsrsNote },
        { label: "Cash Needed", value: `$${draft.cashNeeded.toLocaleString()}` },
        { label: "Total Credit", value: `$${Math.round(totalEstimatedCredit).toLocaleString()}` },
        { label: "Daily Theta", value: `$${draft.portfolioSummary.dailyTheta.toLocaleString()}` },
      ],
      portfolioSummary: {
        ...draft.portfolioSummary,
        totalNames: positions.length,
        callCount: draft.callPositions.length,
        putCount: draft.putPositions.length,
        totalMargin,
        cashNeeded: draft.cashNeeded,
        totalEstimatedCredit: Math.round(totalEstimatedCredit),
      },
      priceAlerts: draft.callPositions.flatMap((position) => [
        position.breakAlert1
          ? {
              id: crypto.randomUUID(),
              ticker: String(position.ticker ?? ""),
              side: "call" as const,
              label: "Break #1",
              thresholdValue: Number(position.breakAlert1),
              protocolNote: "First technical break.",
            }
          : null,
        position.breakAlert2
          ? {
              id: crypto.randomUUID(),
              ticker: String(position.ticker ?? ""),
              side: "call" as const,
              label: "Break #2",
              thresholdValue: Number(position.breakAlert2),
              protocolNote: "Second technical break.",
            }
          : null,
      ]).filter(Boolean),
    };
  }, [draft]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Markdown import</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={markdown}
            onChange={(event) => setMarkdown(event.target.value)}
            placeholder="Paste a weekly basket markdown block to prefill the editor."
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const parsed = parseBasketMarkdownToDraft(markdown);
              setDraft((current) => ({
                ...current,
                title: parsed.title,
                slug: parsed.slug,
                weekOf: parsed.weekOf,
                gsrs: parsed.gsrs,
                radarStatus: parsed.radarStatus,
                cashNeeded: parsed.cashNeeded,
                commentary: parsed.commentary,
                callPositions: parsed.callPositions.map((position) => ({
                  ...makeBlankPosition("call"),
                  ...position,
                })),
                putPositions: parsed.putPositions.map((position) => ({
                  ...makeBlankPosition("put"),
                  ...position,
                })),
              }));
              setMessage("Markdown imported into the structured editor.");
            }}
          >
            <Wand2 className="size-4" />
            Parse markdown
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Basket header</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Title">
            <Input
              value={draft.title}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  title: event.target.value,
                  slug: toSlug(event.target.value),
                }))
              }
            />
          </Field>
          <Field label="Slug">
            <Input
              value={draft.slug}
              onChange={(event) =>
                setDraft((current) => ({ ...current, slug: event.target.value }))
              }
            />
          </Field>
          <Field label="Week of">
            <Input
              type="date"
              value={draft.weekOf}
              onChange={(event) =>
                setDraft((current) => ({ ...current, weekOf: event.target.value }))
              }
            />
          </Field>
          <Field label="Status">
            <Input
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as Draft["status"],
                }))
              }
            />
          </Field>
          <Field label="GSRS">
            <Input
              type="number"
              step="0.1"
              value={draft.gsrs}
              onChange={(event) =>
                setDraft((current) => ({ ...current, gsrs: Number(event.target.value) }))
              }
            />
          </Field>
          <Field label="Cash needed">
            <Input
              type="number"
              value={draft.cashNeeded}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  cashNeeded: Number(event.target.value),
                }))
              }
            />
          </Field>
          <Field label="Radar status" className="md:col-span-2">
            <Input
              value={draft.radarStatus}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  radarStatus: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Disclaimer" className="md:col-span-2">
            <Textarea
              value={draft.disclaimer}
              onChange={(event) =>
                setDraft((current) => ({ ...current, disclaimer: event.target.value }))
              }
            />
          </Field>
          <Field label="Member notes" className="md:col-span-2">
            <Textarea
              value={draft.commentary}
              onChange={(event) =>
                setDraft((current) => ({ ...current, commentary: event.target.value }))
              }
            />
          </Field>
          <Field label="Admin notes" className="md:col-span-2">
            <Textarea
              value={draft.adminNotes}
              onChange={(event) =>
                setDraft((current) => ({ ...current, adminNotes: event.target.value }))
              }
            />
          </Field>
        </CardContent>
      </Card>

      <PositionSection
        title="Call-side positions"
        positions={draft.callPositions}
        side="call"
        onAdd={() =>
          setDraft((current) => ({
            ...current,
            callPositions: [...current.callPositions, makeBlankPosition("call")],
          }))
        }
        onChange={(index, patch) =>
          setDraft((current) => ({
            ...current,
            callPositions: current.callPositions.map((position, currentIndex) =>
              currentIndex === index ? { ...position, ...patch } : position,
            ),
          }))
        }
      />

      <PositionSection
        title="Put-side positions"
        positions={draft.putPositions}
        side="put"
        onAdd={() =>
          setDraft((current) => ({
            ...current,
            putPositions: [...current.putPositions, makeBlankPosition("put")],
          }))
        }
        onChange={(index, patch) =>
          setDraft((current) => ({
            ...current,
            putPositions: current.putPositions.map((position, currentIndex) =>
              currentIndex === index ? { ...position, ...patch } : position,
            ),
          }))
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : <span />}
        <div className="flex gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await saveBasketAction(
                  JSON.stringify({
                    ...draft,
                    status: "draft",
                    disclaimer: draft.disclaimer || baseDisclaimer,
                    quickSummary: computed.quickSummary,
                    portfolioSummary: computed.portfolioSummary,
                    priceAlerts: computed.priceAlerts,
                  }),
                );
                setMessage("Draft saved.");
                if (result.id) {
                  router.push(`/admin/baskets/${result.id}`);
                }
              })
            }
          >
            Save draft
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await saveBasketAction(
                  JSON.stringify({
                    ...draft,
                    status: "published",
                    publicationDate: draft.publicationDate ?? new Date().toISOString(),
                    disclaimer: draft.disclaimer || baseDisclaimer,
                    quickSummary: computed.quickSummary,
                    portfolioSummary: computed.portfolioSummary,
                    priceAlerts: computed.priceAlerts,
                  }),
                );
                setMessage("Basket published.");
                if (result.id) {
                  router.push(`/admin/baskets/${result.id}`);
                }
              })
            }
          >
            Publish basket
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function PositionSection({
  title,
  side,
  positions,
  onAdd,
  onChange,
}: {
  title: string;
  side: "call" | "put";
  positions: EditablePosition[];
  onAdd: () => void;
  onChange: (index: number, patch: Record<string, unknown>) => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Button type="button" variant="secondary" onClick={onAdd}>
          <Plus className="size-4" />
          Add {side}
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        {positions.map((position, index) => (
          <div key={String(position.id ?? index)} className="rounded-3xl border border-border/70 p-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Ticker">
                <Input
                  value={String(position.ticker ?? "")}
                  onChange={(event) => onChange(index, { ticker: event.target.value })}
                />
              </Field>
              <Field label="Entry price">
                <Input
                  type="number"
                  value={Number(position.entryUnderlyingPrice ?? 0)}
                  onChange={(event) =>
                    onChange(index, { entryUnderlyingPrice: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="Strike">
                <Input
                  type="number"
                  value={Number(position.strike ?? 0)}
                  onChange={(event) => onChange(index, { strike: Number(event.target.value) })}
                />
              </Field>
              <Field label="Expiry">
                <Input
                  type="date"
                  value={String(position.expiry ?? "")}
                  onChange={(event) => onChange(index, { expiry: event.target.value })}
                />
              </Field>
              <Field label="Delta">
                <Input
                  type="number"
                  step="0.01"
                  value={Number(position.delta ?? 0)}
                  onChange={(event) => onChange(index, { delta: Number(event.target.value) })}
                />
              </Field>
              <Field label="Entry credit">
                <Input
                  type="number"
                  step="0.01"
                  value={Number(position.estimatedEntryCredit ?? 0)}
                  onChange={(event) =>
                    onChange(index, { estimatedEntryCredit: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="Contracts">
                <Input
                  type="number"
                  value={Number(position.contracts ?? 0)}
                  onChange={(event) =>
                    onChange(index, { contracts: Number(event.target.value) })
                  }
                />
              </Field>
              <Field label="Margin">
                <Input
                  type="number"
                  value={Number(position.margin ?? 0)}
                  onChange={(event) => onChange(index, { margin: Number(event.target.value) })}
                />
              </Field>
              {side === "call" ? (
                <Field label="Break #1">
                  <Input
                    type="number"
                    value={Number(position.breakAlert1 ?? 0)}
                    onChange={(event) =>
                      onChange(index, { breakAlert1: Number(event.target.value) })
                    }
                  />
                </Field>
              ) : (
                <Field label="ATR 14d">
                  <Input
                    type="number"
                    value={Number(position.atr14d ?? 0)}
                    onChange={(event) => onChange(index, { atr14d: Number(event.target.value) })}
                  />
                </Field>
              )}
              <Field label="Thesis summary" className="md:col-span-3">
                <Textarea
                  value={String(position.thesisSummary ?? "")}
                  onChange={(event) => onChange(index, { thesisSummary: event.target.value })}
                />
              </Field>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
