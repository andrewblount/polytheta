import { updateModelSettingsAction } from "@/app/(app)/app/actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadPerformanceSource } from "@/server/repos/performance";
import { getModelSettings } from "@/server/services/model-settings";
import { ModelSettingsForm } from "./model-settings-form";

// The model's sizing. Changing it re-sizes every historical leg in the model
// performance report and sizes the next published basket; it never touches the
// IB account, whose report always shows real fills.
export async function ModelSettingsCard() {
  const [s, source] = await Promise.all([getModelSettings(), loadPerformanceSource()]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model sizing</CardTitle>
        <p className="text-sm text-muted-foreground">
          The model selects and sizes its weekly basket from these settings. The track record preview recalculates as the sliders move; the IB account report is real fills only.
        </p>
      </CardHeader>
      <CardContent>
        <ModelSettingsForm initial={s} source={source ?? []} action={updateModelSettingsAction} />
      </CardContent>
    </Card>
  );
}
