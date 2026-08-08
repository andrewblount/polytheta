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
      className={cn("inline-flex items-center gap-2.5 text-foreground sm:gap-3", className)}
    >
      <span className="flex size-9 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-sm font-semibold text-accent sm:size-10">
        P
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[0.1em] uppercase sm:text-[17px] sm:tracking-[0.12em]">
          Polytheta
        </span>
        <span className="mt-1 hidden text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground sm:block">
          Members-only intelligence
        </span>
      </span>
    </Link>
  );
}
