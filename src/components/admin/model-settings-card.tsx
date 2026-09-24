import { updateModelSettingsAction } from "@/app/(app)/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getModelSettings } from "@/server/services/model-settings";

// The model's sizing. Changing it re-sizes every historical leg in the model
// performance report and sizes the next published basket; it never touches the
// IB account, whose report always shows real fills.
export async function ModelSettingsCard() {
  const s = await getModelSettings();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model sizing</CardTitle>
        <p className="text-sm text-muted-foreground">
          The model selects and sizes its weekly basket from these settings. Model performance is recalculated from them on every view; the IB account report is real fills only.
        </p>
      </CardHeader>
      <CardContent>
        <form action={updateModelSettingsAction} className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">Model equity ($)<Input name="modelEquity" type="number" required min={1000} max={1000000000} step={1000} defaultValue={s.modelEquity} /></label>
          <label className="grid gap-2 text-sm">Percentage of account traded (%)<Input name="accountTradedPct" type="number" required min={0} max={100} step={1} defaultValue={s.accountTradedPct} /></label>
          <label className="grid gap-2 text-sm">Margin available (%)<Input name="marginAvailablePct" type="number" required min={100} max={1000} step={25} defaultValue={s.marginAvailablePct} /><span className="text-xs text-muted-foreground">400% backs four dollars of strike or spot notional per committed dollar. 100% reproduces the cash-backed sizing of the original track record.</span></label>
          <div className="grid gap-3 text-sm">
            <label className="flex items-center gap-3"><input type="checkbox" name="sellCalls" defaultChecked={s.sellCalls} />Sell calls</label>
            <label className="flex items-center gap-3"><input type="checkbox" name="sellPuts" defaultChecked={s.sellPuts} />Sell puts</label>
            <span className="text-xs text-muted-foreground">With both on, the call/put split in the IB settings sets the counts. One off routes the whole basket to the other side; GSRS 5+ still blocks new puts.</span>
          </div>
          <Button type="submit" className="sm:col-span-2">Save model settings</Button>
        </form>
      </CardContent>
    </Card>
  );
}
