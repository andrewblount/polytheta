"use client";

import Link from "next/link";
import { hydrateSession } from "@netlify/identity";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ disabled }: { disabled?: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setLoading(true);
        setError(null);
        const formData = new FormData(event.currentTarget);
        const email = String(formData.get("email") ?? "");
        const password = String(formData.get("password") ?? "");
        try {
          const body = new URLSearchParams({
            grant_type: "password",
            username: email,
            password,
          });

          const tokenResponse = await fetch("/.netlify/identity/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
          });

          if (!tokenResponse.ok) {
            const errorBody = (await tokenResponse.json().catch(() => null)) as
              | { msg?: string; error_description?: string }
              | null;

            throw new Error(
              errorBody?.msg ??
                errorBody?.error_description ??
                `Login failed (${tokenResponse.status})`,
            );
          }

          const tokenData = (await tokenResponse.json()) as {
            access_token: string;
            refresh_token?: string;
          };

          document.cookie = `nf_jwt=${encodeURIComponent(tokenData.access_token)}; path=/; secure; samesite=lax`;

          if (tokenData.refresh_token) {
            document.cookie = `nf_refresh=${encodeURIComponent(tokenData.refresh_token)}; path=/; secure; samesite=lax`;
          }

          await hydrateSession();
          window.location.href = "/app/dashboard";
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "Unable to log in.");
        } finally {
          setLoading(false);
        }
      }}
    >
      {disabled ? (
        <p className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          Your account is inactive. Contact Polytheta support if you need access restored.
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
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/forgot-password" className="text-sm text-accent">
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" required />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in..." : "Sign in"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Need access?{" "}
        <Link href="/contact" className="text-accent">
          Request membership
        </Link>
      </p>
    </form>
  );
}
