import { updateMyTrackingAction } from "@/app/(app)/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDateTimeLabel } from "@/lib/format";
import { requireAppUser } from "@/server/auth/user";
import { getMemberPerformance } from "@/server/services/member-performance";

export default async function SettingsPage() {
  const user = await requireAppUser();
  const performance = await getMemberPerformance(user);
  const prefs = user.notificationPrefs ?? {};

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow text-[10px] text-muted-foreground">Settings</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Account settings</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <SettingRow label="Full name" value={user.fullName} />
          <SettingRow label="Email" value={user.email} />
          <SettingRow label="Role" value={user.role} />
          <SettingRow
            label="Risk acknowledgement"
            value={
              user.acknowledgedRiskAt
                ? formatDateTimeLabel(user.acknowledgedRiskAt)
                : "Pending"
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Portfolio tracking</CardTitle>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            Set the amount you follow the baskets with and when you started. Your
            dashboard compounds each settled week&apos;s return over this base —
            everyone sees the same weekly percentages, scaled to their own capital.
          </p>
        </CardHeader>
        <CardContent>
          {performance ? (
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <SettingRow label="Current value" value={formatCurrency(performance.currentValue)} />
              <SettingRow
                label="Total return"
                value={`${performance.totalReturn >= 0 ? "+" : "−"}${formatCurrency(Math.abs(performance.totalReturn))} (${performance.totalReturnPct >= 0 ? "+" : ""}${performance.totalReturnPct}%)`}
              />
              <SettingRow label="Settled weeks tracked" value={String(performance.weeksTracked)} />
            </div>
          ) : null}
          <form action={updateMyTrackingAction} className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Starting amount (USD)</Label>
              <Input
                name="startingCapital"
                inputMode="decimal"
                placeholder="e.g. 250000"
                defaultValue={user.startingCapital != null ? String(user.startingCapital) : ""}
              />
            </div>
            <div>
              <Label>Tracking start date</Label>
              <Input
                name="trackingStartDate"
                type="date"
                defaultValue={user.trackingStartDate ?? ""}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Weeks before this date are excluded. Leave blank to include the full history.
              </p>
            </div>
            <div className="md:col-span-2 grid gap-3 rounded-2xl border border-border/70 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Briefing emails
              </p>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="briefing_open_email"
                  defaultChecked={prefs.briefing_open_email === true}
                  className="h-4 w-4"
                />
                Morning open briefing (9:45 ET)
              </label>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  name="briefing_close_email"
                  defaultChecked={prefs.briefing_close_email === true}
                  className="h-4 w-4"
                />
                Evening close briefing (4:10 ET)
              </label>
              <p className="text-xs text-muted-foreground">
                Briefings include the system scorecard plus your own tracked value and return.
              </p>
            </div>
            <div className="flex items-end">
              <Button type="submit">Save</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 p-4">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
