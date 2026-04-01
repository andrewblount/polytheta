import { getFeaturedPreviewBaskets } from "@/server/repos/baskets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EyeOff } from "lucide-react";

export default async function PreviewPage() {
  const baskets = await getFeaturedPreviewBaskets();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-10 px-4 py-16 sm:px-6 lg:px-8">
      <div className="space-y-4">
        <p className="eyebrow text-xs text-muted-foreground">Preview</p>
        <h1 className="text-5xl font-semibold tracking-tight">A measured look inside the product</h1>
        <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
          Preview cards below show the structure of the member experience without exposing
          the full protected recommendation payload.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {baskets.map((basket) => (
          <Card key={basket.id}>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <p className="eyebrow text-[10px] text-muted-foreground">{basket.status}</p>
                <CardTitle className="mt-3">{basket.title}</CardTitle>
              </div>
              <EyeOff className="size-5 text-accent" />
            </CardHeader>
            <CardContent className="grid gap-3">
              {basket.quickSummary.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-border/70 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">{metric.label}</p>
                    <span className="rounded-full bg-muted/70 px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      Preview
                    </span>
                  </div>
                  <div className="mt-3 h-3 w-2/3 rounded-full bg-muted/70" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
