import Link from "next/link";

import { cn } from "@/lib/utils";

export function Wordmark({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-3 text-foreground", className)}
    >
      <span className="flex size-10 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-sm font-semibold text-accent">
        P
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-base font-semibold tracking-[0.18em] uppercase">
          Polytheta
        </span>
        <span className="text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
          Members-only intelligence
        </span>
      </span>
    </Link>
  );
}
