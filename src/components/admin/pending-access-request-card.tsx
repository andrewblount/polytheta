import { approveAccessRequestAction, rejectAccessRequestAction } from "@/app/(app)/admin/actions";
import { formatDateTimeLabel } from "@/lib/format";
import type { AccessRequestRecord } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PendingAccessRequestCard({
  request,
}: {
  request: AccessRequestRecord;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{request.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4 md:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Email
            </p>
            <p className="mt-2 text-sm">{request.email}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Company
            </p>
            <p className="mt-2 text-sm">{request.company || "Not provided"}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Requested
            </p>
            <p className="mt-2 text-sm">{formatDateTimeLabel(request.createdAt)}</p>
          </div>
        </div>

        {request.message ? (
          <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
            <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Context
            </p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{request.message}</p>
          </div>
        ) : null}

        <form
          action={approveAccessRequestAction}
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_180px_180px_auto]"
        >
          <input type="hidden" name="requestId" value={request.id} />
          <div>
            <Label htmlFor={`password-${request.id}`}>Password</Label>
            <Input
              id={`password-${request.id}`}
              name="password"
              type="password"
              minLength={8}
              placeholder="Set initial password"
              required
            />
          </div>
          <div>
            <Label htmlFor={`role-${request.id}`}>Role</Label>
            <Input id={`role-${request.id}`} name="role" defaultValue="member" required />
          </div>
          <div>
            <Label htmlFor={`status-${request.id}`}>Status</Label>
            <Input id={`status-${request.id}`} name="status" defaultValue="active" required />
          </div>
          <div className="flex items-end">
            <Button type="submit" className="w-full">
              Approve and create user
            </Button>
          </div>
        </form>

        <form action={rejectAccessRequestAction}>
          <input type="hidden" name="requestId" value={request.id} />
          <Button type="submit" variant="ghost">
            Reject request
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
