import { notFound } from "next/navigation";

import { BasketDetailView } from "@/components/baskets/basket-detail-view";
import { getBasketBySlug } from "@/server/repos/baskets";

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
  return <BasketDetailView basket={basket} />;
}
