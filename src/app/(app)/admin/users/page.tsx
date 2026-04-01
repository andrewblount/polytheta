import { updateUserAccessAction } from "@/app/(app)/admin/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listAdminUsers } from "@/server/repos/baskets";

export default async function AdminUsersPage() {
  const users = await listAdminUsers();

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow text-[10px] text-muted-foreground">Users</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Manage access and roles</h1>
      </div>
      <div className="grid gap-4">
        {users.map((user) => (
          <Card key={user.id}>
            <CardHeader>
              <CardTitle>{user.fullName}</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateUserAccessAction} className="grid gap-4 md:grid-cols-[1.2fr_0.8fr_0.8fr_auto]">
                <input type="hidden" name="userId" value={user.id} />
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
