import { BasketEditor } from "@/components/admin/basket-editor";

export default function NewBasketPage() {
  return (
    <BasketEditor
      initialDraft={{
        title: "Weekly Basket",
        slug: "weekly-basket",
        weekOf: new Date().toISOString().slice(0, 10),
        status: "draft",
        gsrs: 0,
        radarStatus: "Clean",
        cashNeeded: 60000,
        disclaimer:
          "I am not a financial advisor. This system carries extreme risk of total or greater-than-account loss.",
        quickSummary: [],
        commentary: "",
        adminNotes: "",
        marketConditions: {
          gsrsNote: "",
          vix: 0,
          skew: 0,
          hyOas: 0,
          move: 0,
          putCallRatio: 0,
          acquisitionRadarStatus: "Clean",
          downsideGapRadarStatus: "Clean",
          narrative: "",
        },
        portfolioSummary: {
          totalNames: 0,
          callCount: 0,
          putCount: 0,
          totalMargin: 0,
          cashNeeded: 60000,
          totalEstimatedCredit: 0,
          dailyTheta: 0,
          concentrationNote: "",
          gsrsConstraintNote: "",
        },
        callPositions: [],
        putPositions: [],
        orderBlocks: [],
        priceAlerts: [],
        hardStops: [
          { title: "25% name-level stop", body: "Close the name at 25% loss." },
          {
            title: "30% portfolio drawdown",
            body: "Close all positions if portfolio drawdown reaches 30%.",
          },
        ],
        profitTargets: [
          {
            title: "50–70% credit capture",
            body: "Take profits when 50–70% of collected credit has been captured.",
          },
        ],
      }}
    />
  );
}
