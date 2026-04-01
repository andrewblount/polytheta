"use client";

import { LogOut } from "lucide-react";
import { logout } from "@netlify/identity";

import { Button } from "@/components/ui/button";

export function LogoutButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={className}
      onClick={async () => {
        try {
          await logout();
        } finally {
          window.location.href = "/";
        }
      }}
    >
      <LogOut className="size-4" />
      Logout
    </Button>
  );
}
