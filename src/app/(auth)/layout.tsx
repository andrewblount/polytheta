import Link from "next/link";

import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Wordmark } from "@/components/layout/wordmark";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-4 px-4 py-6 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <Wordmark />
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back to site
          </Link>
          <ThemeToggle />
        </div>
      </div>
      <div className="mx-auto flex min-h-[calc(100vh-96px)] max-w-6xl items-center justify-center px-4 pb-12 sm:px-6 lg:px-8">
        {children}
      </div>
    </div>
  );
}
