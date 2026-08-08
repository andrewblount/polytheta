import Link from "next/link";

import { siteConfig } from "@/lib/brand";

export function PublicFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="space-y-3">
          <p className="eyebrow text-sm text-muted-foreground">Polytheta</p>
          <p className="max-w-md text-base leading-7 text-muted-foreground">
            Premium weekly options baskets, transparent performance tracking, and a
            calmer operating surface for serious users.
          </p>
        </div>
        <div className="space-y-2 text-[15px] text-muted-foreground">
          <Link href="/methodology" className="block hover:text-foreground">
            Methodology
          </Link>
          <Link href="/preview" className="block hover:text-foreground">
            Preview
          </Link>
          <Link href="/faq" className="block hover:text-foreground">
            FAQ
          </Link>
        </div>
        <div className="space-y-2 text-[15px] text-muted-foreground">
          <Link href="/privacy" className="block hover:text-foreground">
            Privacy Policy
          </Link>
          <Link href="/terms" className="block hover:text-foreground">
            Terms
          </Link>
          <a href={`mailto:${siteConfig.supportEmail}`} className="block hover:text-foreground">
            {siteConfig.supportEmail}
          </a>
        </div>
      </div>
    </footer>
  );
}
