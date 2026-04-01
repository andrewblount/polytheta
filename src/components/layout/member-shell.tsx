import Link from "next/link";

import type { AppUserProfile } from "@/lib/types";
import { adminNavigation, memberNavigation } from "@/lib/brand";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Wordmark } from "@/components/layout/wordmark";
import { LogoutButton } from "@/components/auth/logout-button";

export function MemberShell({
  children,
  user,
  admin = false,
}: {
  children: React.ReactNode;
  user: AppUserProfile;
  admin?: boolean;
}) {
  const navigation = admin ? adminNavigation : memberNavigation;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen max-w-[1600px] lg:grid-cols-[280px_1fr]">
        <aside className="hidden border-r border-border/60 px-5 py-6 lg:block">
          <Wordmark href={admin ? "/admin" : "/app/dashboard"} />
          <div className="mt-8 space-y-2">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center rounded-2xl px-4 py-3 text-sm text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="mt-8 rounded-3xl border border-border/70 bg-muted/30 p-4">
            <p className="eyebrow text-[10px] text-muted-foreground">Access</p>
            <p className="mt-2 text-sm font-medium">{user.fullName}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
            <div className="mt-3 flex items-center gap-2">
              <Badge variant={user.role === "admin" ? "accent" : "default"}>
                {user.role}
              </Badge>
              <Badge variant={user.status === "active" ? "success" : "danger"}>
                {user.status}
              </Badge>
            </div>
          </div>
        </aside>
        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
              <div className="flex items-center gap-3">
                <div className="lg:hidden">
                  <Wordmark href={admin ? "/admin" : "/app/dashboard"} />
                </div>
                <div className="hidden lg:block">
                  <p className="eyebrow text-[10px] text-muted-foreground">
                    {admin ? "Admin Workspace" : "Member Workspace"}
                  </p>
                  <h1 className="text-lg font-semibold tracking-tight">
                    {admin ? "Operations & publishing" : "Weekly basket intelligence"}
                  </h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                <div className="hidden items-center gap-3 rounded-full border border-border/70 bg-muted/30 px-3 py-2 sm:flex">
                  <Avatar className="size-8">
                    <AvatarFallback>
                      {user.fullName
                        .split(" ")
                        .map((part) => part[0])
                        .join("")
                        .slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-right">
                    <p className="text-xs font-medium">{user.fullName}</p>
                    <p className="text-[11px] text-muted-foreground">{user.email}</p>
                  </div>
                </div>
                <LogoutButton />
              </div>
            </div>
            <div className="flex gap-2 overflow-auto px-4 pb-4 lg:hidden">
              {navigation.map((item) => (
                <Button key={item.href} variant="secondary" size="sm" asChild>
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
            </div>
          </header>
          <main className={cn("flex-1 px-4 py-6 sm:px-6 lg:px-8")}>{children}</main>
        </div>
      </div>
    </div>
  );
}
