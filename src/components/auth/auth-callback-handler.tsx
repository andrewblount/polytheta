"use client";

import Link from "next/link";
import { handleAuthCallback } from "@netlify/identity";
import { useEffect, useState } from "react";

export function AuthCallbackHandler() {
  const [message, setMessage] = useState("Confirming your session...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      try {
        const result = await handleAuthCallback();
        if (!result) {
          setMessage("No auth callback was found in this link.");
          return;
        }

        if (result.type === "recovery") {
          window.location.href = "/reset-password";
          return;
        }

        if (result.type === "invite") {
          setMessage("Invitation accepted. Set a password to continue.");
          return;
        }

        window.location.href = "/app/dashboard";
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to complete authentication.");
      }
    };

    void run();
  }, []);

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p className="rounded-2xl border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
        <Link href="/login" className="text-accent">
          Return to login
        </Link>
      </div>
    );
  }

  return <p className="text-center text-sm text-muted-foreground">{message}</p>;
}
