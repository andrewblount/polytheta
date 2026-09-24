import { notFound } from "next/navigation";

import { BasketDetailView } from "@/components/baskets/basket-detail-view";
import { getBasketBySlug, getTradesForBasket } from "@/server/repos/baskets";
import { getBasketLegPaths } from "@/server/services/price-paths";

export default async function BasketDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const basket = await getBasketBySlug(slug);
  if (!basket) {
    notFound();
  }
  const [trades, legPaths] = await Promise.all([getTradesForBasket(basket.id), getBasketLegPaths(basket)]);
  return <BasketDetailView basket={basket} trades={trades} legPaths={legPaths} />;
}
