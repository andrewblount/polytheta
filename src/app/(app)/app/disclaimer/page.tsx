import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { userProfiles } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppUser } from "@/server/auth/user";

async function acknowledgeRiskAction() {
  "use server";

  const user = await requireAppUser();
  if (db) {
    await db
      .update(userProfiles)
      .set({
        acknowledgedRiskAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.id, user.id));
  }
  redirect("/app/dashboard");
}

export default async function DisclaimerPage() {
  const user = await requireAppUser();
  if (user.acknowledgedRiskAt) {
    redirect("/app/dashboard");
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Card>
        <CardHeader>
          <p className="eyebrow text-[10px] text-muted-foreground">Required acknowledgement</p>
          <CardTitle className="mt-3 text-4xl">Risk disclosure</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm leading-7 text-muted-foreground">
            Polytheta publishes information only. Options trading, especially naked
            strategies, can lead to rapid losses that exceed the initial capital committed.
            You are responsible for your own review, broker verification, execution, and
            compliance obligations.
          </p>
          <form action={acknowledgeRiskAction}>
            <Button type="submit">I understand and want to continue</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
