import Link from "next/link";

import { appNavigation } from "@/lib/brand";

import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";
import { Button } from "@/components/ui/button";

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:gap-6 sm:px-6 lg:px-8">
        <Wordmark />
        <nav className="hidden items-center gap-6 lg:flex">
          {appNavigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[15px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button asChild variant="ghost" className="hidden sm:inline-flex">
            <Link href="/login">Member Login</Link>
          </Button>
          <Button asChild className="px-4 sm:px-5">
            <Link href="/contact">Request Access</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
