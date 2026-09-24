import { getBasketBySlug } from "@/server/repos/baskets";
import { getBasketLegPaths } from "@/server/services/price-paths";

import { mobileAuthOk, unauthorized } from "../../../auth";

export const dynamic = "force-dynamic";

// The underlying price path of every leg in a basket (entry → expiry or now)
// with the strike / entry / breakeven levels and the per-leg analysis, so the
// app can chart each short option against its stock and read the post-mortem
// of any leg that expired in the money.
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!mobileAuthOk(request)) return unauthorized();
  const { slug } = await params;
  const basket = await getBasketBySlug(slug);
  if (!basket) return Response.json({ error: "not found" }, { status: 404 });
  const legs = await getBasketLegPaths(basket);
  return Response.json({ slug: basket.slug, weekOf: basket.weekOf, legs }, { headers: { "Cache-Control": "no-store" } });
}
