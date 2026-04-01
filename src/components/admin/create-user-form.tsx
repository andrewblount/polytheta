"use client";

import { useActionState } from "react";

import { createUserAction } from "@/app/(app)/admin/actions";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: { error?: string } = {};

export function CreateUserForm() {
  const [state, formAction, pending] = useActionState(createUserAction, initialState);

  return (
    <form action={formAction} className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_180px_180px_auto]">
      <div>
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" name="fullName" placeholder="Jane Doe" required />
      </div>
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="jane@polytheta.com" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" minLength={8} required />
      </div>
      <div>
        <Label htmlFor="role">Role</Label>
        <Input id="role" name="role" defaultValue="member" required />
      </div>
      <div>
        <Label htmlFor="status">Status</Label>
        <Input id="status" name="status" defaultValue="active" required />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Creating..." : "Create user"}
        </Button>
      </div>
      {state.error ? (
        <p className="md:col-span-2 xl:col-span-6 rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
