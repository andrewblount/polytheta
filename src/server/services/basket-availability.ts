import { missingBasketAvailability } from "../../../shared/basket-availability.mjs";
import { getLatestPublishedBasketSummary } from "@/server/repos/baskets";
import { getBrokerSettings } from "./broker-settings";

export async function getBasketAvailability(now = new Date()) {
  const [settings, latestPublished] = await Promise.all([
    getBrokerSettings(), getLatestPublishedBasketSummary(now),
  ]);
  return { ...missingBasketAvailability(settings, now), latestPublished };
}
