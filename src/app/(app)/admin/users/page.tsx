import { updateUserAccessAction } from "@/app/(app)/admin/actions";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { PendingAccessRequestCard } from "@/components/admin/pending-access-request-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTimeLabel } from "@/lib/format";
import { listAdminUsers, listPendingAccessRequests } from "@/server/repos/baskets";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const [users, pendingAccessRequests] = await Promise.all([
    listAdminUsers(),
    listPendingAccessRequests(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow text-[10px] text-muted-foreground">Users</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Manage access and roles</h1>
      </div>
      {params?.created ? (
        <p className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          User created successfully.
        </p>
      ) : null}
      {params?.approved ? (
        <p className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          Access request approved and user created successfully.
        </p>
      ) : null}
      {params?.rejected ? (
        <p className="rounded-2xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          Access request rejected.
        </p>
      ) : null}
      <div className="space-y-4">
        <div>
          <p className="eyebrow text-[10px] text-muted-foreground">Pending requests</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Review and approve access</h2>
        </div>
        {pendingAccessRequests.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground">
              No pending access requests right now.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {pendingAccessRequests.map((request) => (
              <PendingAccessRequestCard key={request.id} request={request} />
            ))}
          </div>
        )}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Create user</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateUserForm />
        </CardContent>
      </Card>
      <div className="grid gap-4">
        {users.map((user) => (
          <Card key={user.id}>
            <CardHeader>
              <CardTitle>{user.fullName}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 md:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Last login
                  </p>
                  <p className="mt-2 text-sm">
                    {user.lastLoginAt ? formatDateTimeLabel(user.lastLoginAt) : "Never"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Created
                  </p>
                  <p className="mt-2 text-sm">{formatDateTimeLabel(user.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Identity status
                  </p>
                  <p className="mt-2 text-sm">
                    {user.identityConfirmedAt ? formatDateTimeLabel(user.identityConfirmedAt) : "Confirmed externally"}
                  </p>
                </div>
              </div>
              <form action={updateUserAccessAction} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_180px_180px_1fr_auto]">
                <input type="hidden" name="userId" value={user.id} />
                <div>
                  <Label>Full name</Label>
                  <Input name="fullName" defaultValue={user.fullName} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input value={user.email} readOnly />
                </div>
                <div>
                  <Label>Role</Label>
                  <Input name="role" defaultValue={user.role} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Input name="status" defaultValue={user.status} />
                </div>
                <div>
                  <Label>New password</Label>
                  <Input name="password" type="password" placeholder="Leave blank to keep current" />
                </div>
                <div className="flex items-end">
                  <Button type="submit">Save</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
