import { saveManualOverrideAction } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listBaskets } from "@/server/repos/baskets";

export default async function AdminOverridesPage() {
  const baskets = await listBaskets();
  const positions = baskets.flatMap((basket) => [...basket.callPositions, ...basket.putPositions]);

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow text-[10px] text-muted-foreground">Overrides</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Manual close and fill overrides</h1>
      </div>
      <div className="grid gap-4">
        {positions.slice(0, 8).map((position) => (
          <Card key={position.id}>
            <CardHeader>
              <CardTitle>
                {position.ticker} · {position.side}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={saveManualOverrideAction} className="grid gap-4 md:grid-cols-4">
                <input type="hidden" name="positionId" value={position.id} />
                <div>
                  <Label>Actual exit credit</Label>
                  <Input name="actualExitCredit" type="number" step="0.01" />
                </div>
                <div>
                  <Label>Actual close value</Label>
                  <Input name="actualCloseValue" type="number" step="0.01" />
                </div>
                <div>
                  <Label>Close date</Label>
                  <Input name="actualCloseDate" type="date" />
                </div>
                <div className="md:col-span-4">
                  <Label>Note</Label>
                  <Textarea name="note" />
                </div>
                <div className="md:col-span-4">
                  <Button type="submit">Save override</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
