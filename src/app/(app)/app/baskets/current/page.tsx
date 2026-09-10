import { BasketDetailView } from "@/components/baskets/basket-detail-view";
import { getCurrentBasket } from "@/server/repos/baskets";

export default async function CurrentBasketPage() {
  const basket = await getCurrentBasket();
  if (!basket) {
    return <p>This week’s basket is not available yet. Past baskets are in the archive.</p>;
  }
  return <BasketDetailView basket={basket} />;
}
