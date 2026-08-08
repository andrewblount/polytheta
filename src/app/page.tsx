import Link from "next/link";
import { ArrowRight, Lock, ShieldCheck, Sparkles } from "lucide-react";

import { PublicShell } from "@/components/layout/public-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getFeaturedPreviewBaskets } from "@/server/repos/baskets";

export default async function HomePage() {
  const previewBaskets = await getFeaturedPreviewBaskets();

  return (
    <PublicShell>
      <section className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-24">
        <div className="space-y-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-4 py-2 text-sm text-accent">
            <ShieldCheck className="size-4" />
            Members-only weekly options intelligence
          </div>
          <div className="space-y-5">
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
              Serious options baskets, tracked with transparent performance.
            </h1>
            <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
              Polytheta publishes premium weekly recommendation baskets, preserves the
              operating context around each idea, and tracks observed versus estimated
              option outcomes over time. The result is a calmer, higher-signal workflow
              for members who care about both the thesis and the follow-through.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/contact">
                Request Access
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/login">Member Login</Link>
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                label: "Weekly cadence",
                value: "Fresh baskets each Monday",
              },
              {
                label: "Tracking confidence",
                value: "Actual, Estimated, Expiry-Resolved",
              },
              {
                label: "Protected delivery",
                value: "Server-protected member app",
              },
            ].map((item) => (
              <Card key={item.label} className="bg-card/60">
                <CardHeader>
                  <p className="eyebrow text-xs text-muted-foreground">{item.label}</p>
                  <CardTitle className="mt-3 text-lg">{item.value}</CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
        <div className="data-grid rounded-[40px] border border-border/70 p-3">
          <div className="glass-panel rounded-[32px] border border-border/70 p-6">
            <div className="mb-6 flex items-start justify-between">
              <div>
                <p className="eyebrow text-xs text-muted-foreground">Current member view</p>
                <h2 className="mt-3 text-2xl font-semibold">Latest basket snapshot</h2>
              </div>
              <Lock className="size-5 text-accent" />
            </div>
            <div className="grid gap-4">
              {previewBaskets.map((basket) => (
                <Card key={basket.id} className="bg-background/40">
                  <CardHeader>
                    <p className="eyebrow text-xs text-muted-foreground">
                      {basket.status}
                    </p>
                    <CardTitle className="mt-2 text-xl">{basket.title}</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-2">
                    {basket.quickSummary.slice(0, 4).map((metric) => (
                      <div
                        key={metric.label}
                        className="rounded-2xl border border-border/70 bg-background/40 p-3"
                      >
                        <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                          {metric.label}
                        </p>
                        <p className="mt-2 text-lg font-semibold">{metric.value}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>
      <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-3 lg:px-8">
        {[
          {
            icon: Sparkles,
            title: "Calm surface design",
            body: "A premium dark-first member app with purposeful spacing, clear hierarchy, and responsive tables that adapt instead of shrinking.",
          },
          {
            icon: ShieldCheck,
            title: "Protected research delivery",
            body: "Recommendations stay server-protected behind authenticated member routes, with a risk acknowledgement gate on first access.",
          },
          {
            icon: Lock,
            title: "Transparent tracking",
            body: "Every position distinguishes actual marks from modeled estimates and expiry-resolved outcomes, with clear timestamps and source labels.",
          },
        ].map((item) => (
          <Card key={item.title}>
            <CardHeader>
              <item.icon className="size-5 text-accent" />
              <CardTitle className="mt-4">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 text-sm leading-7 text-muted-foreground">
              {item.body}
            </CardContent>
          </Card>
        ))}
      </section>
    </PublicShell>
  );
}
