import { getCurrentBasket } from "@/server/repos/baskets";

import { mobileAuthOk, unauthorized } from "../auth";
import { leanBasket } from "../serialize";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();

  const basket = await getCurrentBasket();
  if (!basket) {
    return Response.json({ basket: null });
  }
  return Response.json({ basket: leanBasket(basket) });
}
