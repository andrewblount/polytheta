"use client";

import Link from "next/link";
import { requestPasswordRecovery } from "@netlify/identity";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForgotPasswordForm() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        setMessage(null);
        const formData = new FormData(event.currentTarget);
        try {
          await requestPasswordRecovery(String(formData.get("email") ?? ""));
          setMessage("Recovery instructions were sent if the address exists in Identity.");
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Unable to send recovery email.");
        } finally {
          setLoading(false);
        }
      }}
    >
      {message ? (
        <p className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" placeholder="you@firm.com" required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Sending..." : "Send reset link"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="text-accent">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
