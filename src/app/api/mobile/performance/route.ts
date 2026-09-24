import { getPerformanceReport } from "@/server/repos/performance";
import { getAccountPerformanceReport } from "@/server/repos/account-performance";

import { mobileAuthOk, unauthorized } from "../auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!mobileAuthOk(request)) return unauthorized();
  const [report, account] = await Promise.all([getPerformanceReport(), getAccountPerformanceReport()]);
  return Response.json({ ...(report ?? { weeks: [], cumulative: [], stats: null }), account });
}
