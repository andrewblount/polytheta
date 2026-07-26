import { getPerformanceReport } from "@/server/repos/performance";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  const report = await getPerformanceReport();
  return Response.json(report ?? { weeks: [], cumulative: [], stats: null });
}
