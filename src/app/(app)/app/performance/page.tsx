import { saveModelSettingsAction } from "@/app/(app)/app/actions";
import { AccountPerformanceSection } from "@/components/performance/account-performance-section";
import { ModelSizingExplorer } from "@/components/performance/model-sizing-explorer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppUser } from "@/server/auth/user";
import { getAccountPerformanceReport } from "@/server/repos/account-performance";
import { getPerformanceReport } from "@/server/repos/performance";
import { getModelSettings } from "@/server/services/model-settings";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  const user = await requireAppUser();
  const [report, accountReport, model] = await Promise.all([getPerformanceReport(), getAccountPerformanceReport(), getModelSettings()]);

  if (!report || report.source.every((week) => week.legs.every((leg) => leg.pnl == null))) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No settled baskets yet. Performance appears here once a basket reaches expiry.
          </p>
        </CardContent>
      </Card>
    );
  }

  const canSave = user.role === "admin";
  return (
    <div className="space-y-8">
      {/* The model track record: re-sized in the browser as the sliders move; the
          IB account section below is real fills and never changes with them. */}
      <ModelSizingExplorer source={report.source} initial={model} canSave={canSave} save={canSave ? saveModelSettingsAction : undefined} />
      <AccountPerformanceSection report={accountReport} />
    </div>
  );
}
