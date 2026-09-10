import Link from "next/link";
import { BasketDetailView } from "@/components/baskets/basket-detail-view";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentBasket } from "@/server/repos/baskets";
import { getBasketAvailability } from "@/server/services/basket-availability";

export default async function CurrentBasketPage() {
  const now = new Date();
  const basket = await getCurrentBasket(now);
  if (!basket) {
    const availability = await getBasketAvailability(now);
    const next = availability.nextScheduled;
    return (
      <div className="max-w-3xl space-y-6">
        <h1 className="text-3xl font-semibold">Current Basket</h1>
        <Card>
          <CardHeader><CardTitle>{availability.title}</CardTitle></CardHeader>
          <CardContent><p className="text-sm leading-7 text-muted-foreground">{availability.message}</p></CardContent>
        </Card>
        {next && <Card>
          <CardHeader><CardTitle>{next.title}</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <dl className="space-y-3">
              <div><dt className="text-muted-foreground">Research starts</dt><dd>{next.preparationLabel}</dd></div>
              <div><dt className="text-muted-foreground">Final refresh starts</dt><dd>{next.finalRefreshLabel}</dd></div>
              <div><dt className="text-muted-foreground">Entry window</dt><dd>{next.entryLabel}</dd></div>
            </dl>
            <p className="text-muted-foreground">{next.note}</p>
          </CardContent>
        </Card>}
        {availability.latestPublished && <Link className="block underline underline-offset-4"
          href={`/app/baskets/${availability.latestPublished.slug}`}>
          Last published basket: week of {availability.latestPublished.weekOf} (archive)
        </Link>}
        <Link className="block text-sm underline underline-offset-4" href="/app/baskets">Browse the basket archive</Link>
      </div>
    );
  }
  return <BasketDetailView basket={basket} />;
}
