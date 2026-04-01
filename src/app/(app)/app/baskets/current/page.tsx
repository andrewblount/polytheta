import { BasketDetailView } from "@/components/baskets/basket-detail-view";
import { getCurrentBasket } from "@/server/repos/baskets";

export default async function CurrentBasketPage() {
  const basket = await getCurrentBasket();
  if (!basket) {
    return null;
  }
  return <BasketDetailView basket={basket} />;
}
