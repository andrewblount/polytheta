import { getCurrentBasket } from "@/server/repos/baskets";
import { getBasketAvailability } from "@/server/services/basket-availability";

import { mobileAuthOk, unauthorized } from "../auth";
import { leanBasket } from "../serialize";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();

  const now = new Date();
  const basket = await getCurrentBasket(now);
  if (!basket) {
    return Response.json({ basket: null, availability: await getBasketAvailability(now) },
      { headers: { "Cache-Control": "private, no-store" } });
  }
  return Response.json({ basket: leanBasket(basket), availability: null },
    { headers: { "Cache-Control": "private, no-store" } });
}
