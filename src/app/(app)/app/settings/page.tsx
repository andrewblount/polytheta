import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppUser } from "@/server/auth/user";
import { formatDateTimeLabel } from "@/lib/format";

export default async function SettingsPage() {
  const user = await requireAppUser();

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
