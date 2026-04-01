import { toSlug } from "@/lib/utils";
import type { BasketData, PositionData } from "@/lib/types";

type DraftPayload = {
  title: string;
  slug: string;
  weekOf: string;
  gsrs: number;
  radarStatus: string;
  cashNeeded: number;
  commentary: string;
  callPositions: Array<Partial<PositionData>>;
  putPositions: Array<Partial<PositionData>>;
};

function parsePositions(markdown: string, side: "call" | "put") {
  const section = side === "call" ? "CALL SIDE" : "PUT SIDE";
  const blockMatch = markdown.match(
    new RegExp(`## ${section}[\\s\\S]*?\\n\\|([\\s\\S]*?)(?:\\n\\n|$)`, "i"),
  );
  if (!blockMatch) {
    return [];
  }

  const rows = blockMatch[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"))
    .slice(2);

  return rows.map((row) => {
    const cells = row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);

    const ticker = cells[0];
    const price = Number(cells[1]?.replace(/[^0-9.]/g, "")) || 0;
    const ivRank = Number(cells[2]?.replace(/[^0-9.]/g, "")) || 0;
    const shortInterest = Number(cells[3]?.replace(/[^0-9.]/g, "")) || 0;
    const fanScore = Number(cells[4]?.replace(/[^0-9.]/g, "")) || 0;
    const glassdoor = Number(cells[5]?.replace(/[^0-9.]/g, "")) || 0;
    const buybackScore =
      side === "put" ? Number(cells[6]?.replace(/[^0-9+-]/g, "")) || 0 : 0;
    const strikeMatch = cells[7]?.match(/\$?([0-9.]+)/);
    const expiryMatch = cells[7]?.match(/([A-Z][a-z]{2} \d{1,2})/);
    const delta = Number(cells[8]?.replace(/[^0-9.]/g, "")) || 0;
    const credit = Number(cells[9]?.replace(/[^0-9.]/g, "")) || 0;
    const contracts = Number(cells[10]?.replace(/[^0-9]/g, "")) || 0;
    const margin = Number(cells[11]?.replace(/[^0-9]/g, "")) || 0;

    return {
      ticker,
      side,
      optionType: side,
      entryUnderlyingPrice: price,
      ivRank,
      shortInterestPctFloat: shortInterest,
      fanScore,
      glassdoorScore: glassdoor,
      buybackScore,
      strike: Number(strikeMatch?.[1] ?? "0"),
      expiry: expiryMatch ? `${new Date().getFullYear()}-${expiryMatch[1]}` : "",
      delta: delta > 1 ? delta / 100 : delta,
      estimatedEntryCredit: credit,
      contracts,
      margin,
      thesisSummary: "",
      thesisBullets: [],
      cautionFlags: [],
      entryTimestamp: new Date().toISOString(),
    } satisfies Partial<PositionData>;
  });
}

export function parseBasketMarkdownToDraft(markdown: string): DraftPayload {
  const titleMatch = markdown.match(/^# (.+)$/m);
  const gsrsMatch = markdown.match(/GSRS:\s*([0-9.]+)/i);
  const cashMatch = markdown.match(/Cash Needed:\s*~?\$([0-9,]+)/i);
  const dateMatch = markdown.match(/March \d{1,2}, \d{4}|April \d{1,2}, \d{4}/i);
  const radarStatus = /Radars:\s*Clean/i.test(markdown) ? "Clean" : "Watch";

  const title = titleMatch?.[1] ?? "Imported basket";
  return {
    title,
    slug: toSlug(title),
    weekOf: dateMatch ? new Date(dateMatch[0]).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    gsrs: Number(gsrsMatch?.[1] ?? "0"),
    radarStatus,
    cashNeeded: Number((cashMatch?.[1] ?? "0").replace(/,/g, "")),
    commentary: markdown,
    callPositions: parsePositions(markdown, "call"),
    putPositions: parsePositions(markdown, "put"),
  };
}

export function createDraftFromBasket(basket: BasketData) {
  return {
    id: basket.id,
    title: basket.title,
    slug: basket.slug,
    weekOf: basket.weekOf,
    publicationDate: basket.publicationDate,
    status: basket.status,
    gsrs: basket.gsrs,
    radarStatus: basket.radarStatus,
    cashNeeded: basket.cashNeeded,
    disclaimer: basket.disclaimer,
    quickSummary: basket.quickSummary,
    commentary: basket.freeformNotes.join("\n"),
    adminNotes: basket.adminOnlyNotes?.join("\n") ?? "",
    marketConditions: basket.marketConditions,
    portfolioSummary: basket.portfolioSummary,
    callPositions: basket.callPositions,
    putPositions: basket.putPositions,
    orderBlocks: basket.orderBlocks,
    priceAlerts: basket.priceAlerts,
    hardStops: basket.hardStops,
    profitTargets: basket.profitTargets,
  };
}
