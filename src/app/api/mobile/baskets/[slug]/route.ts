import { getBasketBySlug } from "@/server/repos/baskets";

import { mobileAuthOk, unauthorized } from "../../auth";
import { leanBasket } from "../../serialize";

export const dynamic = "force-dynamic";

// A single historical basket with full positions — powers the Archive
// drill-down so a past trade can be read back with the thesis that produced
// it. Same shape as /api/mobile/summary's `basket`.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (!mobileAuthOk(request)) return unauthorized();
  const { slug } = await params;
  const basket = await getBasketBySlug(slug);
  if (!basket) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ basket: leanBasket(basket) });
}
