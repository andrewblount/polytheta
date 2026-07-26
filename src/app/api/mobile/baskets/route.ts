import { listBaskets } from "@/server/repos/baskets";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  const baskets = await listBaskets();
  return Response.json({
    baskets: baskets.map((b) => ({
      slug: b.slug,
      title: b.title,
      weekOf: b.weekOf,
      status: b.status,
      gsrs: b.gsrs,
      totalMargin: b.portfolioSummary.totalMargin,
      totalEstimatedCredit: b.portfolioSummary.totalEstimatedCredit,
      names: b.portfolioSummary.totalNames,
    })),
  });
}
