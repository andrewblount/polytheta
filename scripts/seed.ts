import { db } from "@/db";
import {
  basketMetrics,
  basketRules,
  baskets,
  brokerOrderBlocks,
  marketConditions,
  performanceSnapshots,
  positionAlerts,
  positions,
  syncJobs,
  userProfiles,
} from "@/db/schema";
import { demoBaskets, demoSyncJobs, demoUsers } from "@/lib/demo-data";

async function resetTables() {
  if (!db) {
    throw new Error("NETLIFY_DATABASE_URL or DATABASE_URL is required to seed.");
  }

  await db.delete(performanceSnapshots);
  await db.delete(positionAlerts);
  await db.delete(brokerOrderBlocks);
  await db.delete(basketRules);
  await db.delete(positions);
  await db.delete(marketConditions);
  await db.delete(basketMetrics);
  await db.delete(syncJobs);
  await db.delete(baskets);
  await db.delete(userProfiles);
}

async function seedUsers() {
  if (!db) {
    return;
  }

  await db.insert(userProfiles).values(
    demoUsers.map((user) => ({
      id: user.id,
      identityUserId: `demo-${user.role}-${user.id}`,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
      acknowledgedRiskAt: user.acknowledgedRiskAt ? new Date(user.acknowledgedRiskAt) : null,
      lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt) : null,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.createdAt),
    })),
  );
}

async function seedBaskets() {
  if (!db) {
    return;
  }

  for (const basket of demoBaskets) {
    await db.insert(baskets).values({
      id: basket.id,
      title: basket.title,
      slug: basket.slug,
      weekOf: basket.weekOf,
      publicationDate: new Date(basket.publicationDate),
      status: basket.status,
      gsrs: basket.gsrs.toString(),
      radarStatus: basket.radarStatus,
      cashNeeded: basket.cashNeeded,
      disclaimer: basket.disclaimer,
      quickSummary: basket.quickSummary as unknown as Record<string, unknown>[],
      commentary: basket.freeformNotes.join("\n"),
      adminNotes: basket.adminOnlyNotes?.join("\n") ?? null,
      lastRefreshAt: new Date(basket.lastRefreshAt),
      createdAt: new Date(basket.publicationDate),
      updatedAt: new Date(basket.lastRefreshAt),
    });

    await db.insert(marketConditions).values({
      basketId: basket.id,
      gsrsNote: basket.marketConditions.gsrsNote,
      vix: basket.marketConditions.vix.toString(),
      skew: basket.marketConditions.skew.toString(),
      hyOas: basket.marketConditions.hyOas.toString(),
      move: basket.marketConditions.move.toString(),
      putCallRatio: basket.marketConditions.putCallRatio.toString(),
      acquisitionRadarStatus: basket.marketConditions.acquisitionRadarStatus,
      downsideGapRadarStatus: basket.marketConditions.downsideGapRadarStatus,
      narrative: basket.marketConditions.narrative,
      createdAt: new Date(basket.publicationDate),
      updatedAt: new Date(basket.lastRefreshAt),
    });

    await db.insert(basketMetrics).values({
      basketId: basket.id,
      totalNames: basket.portfolioSummary.totalNames,
      callCount: basket.portfolioSummary.callCount,
      putCount: basket.portfolioSummary.putCount,
      totalMargin: basket.portfolioSummary.totalMargin,
      cashNeeded: basket.portfolioSummary.cashNeeded,
      totalEstimatedCredit: basket.portfolioSummary.totalEstimatedCredit,
      dailyTheta: basket.portfolioSummary.dailyTheta,
      concentrationNote: basket.portfolioSummary.concentrationNote,
      gsrsConstraintNote: basket.portfolioSummary.gsrsConstraintNote,
      createdAt: new Date(basket.publicationDate),
      updatedAt: new Date(basket.lastRefreshAt),
    });

    const allPositions = [...basket.callPositions, ...basket.putPositions];
    for (const [index, position] of allPositions.entries()) {
      await db.insert(positions).values({
        id: position.id,
        basketId: basket.id,
        side: position.side,
        ticker: position.ticker,
        companyName: position.companyName ?? null,
        sector: position.sector ?? null,
        entryUnderlyingPrice: position.entryUnderlyingPrice.toString(),
        ivRank: position.ivRank.toString(),
        shortInterestPctFloat: position.shortInterestPctFloat.toString(),
        fanScore: position.fanScore.toString(),
        glassdoorScore: position.glassdoorScore.toString(),
        buybackScore: position.buybackScore,
        strike: position.strike.toString(),
        optionType: position.optionType,
        expiry: position.expiry,
        delta: position.delta.toString(),
        estimatedEntryCredit: position.estimatedEntryCredit.toString(),
        contracts: position.contracts,
        margin: position.margin,
        breakAlert1: position.breakAlert1?.toString() ?? null,
        breakAlert2: position.breakAlert2?.toString() ?? null,
        atr14d: position.atr14d?.toString() ?? null,
        buffer: position.buffer ?? null,
        probabilityOfTouch: position.probabilityOfTouch?.toString() ?? null,
        thesisSummary: position.thesisSummary,
        thesisBullets: position.thesisBullets,
        cautionFlags: position.cautionFlags,
        entryTimestamp: new Date(position.entryTimestamp),
        notes: position.notes ?? null,
        manualClosePrice: position.manualClosePrice?.toString() ?? null,
        manualCloseDate: position.manualCloseDate ?? null,
        actualExitCredit: position.actualExitCredit?.toString() ?? null,
        sortOrder: index,
        createdAt: new Date(position.entryTimestamp),
        updatedAt: new Date(position.latestPerformance.observedAt),
      });

      await db.insert(performanceSnapshots).values(
        position.performanceHistory.map((snapshot) => ({
          id: snapshot.id,
          basketId: basket.id,
          positionId: position.id,
          observedAt: new Date(snapshot.observedAt),
          underlyingPrice: snapshot.underlyingPrice.toString(),
          optionMark: snapshot.optionMark?.toString() ?? null,
          estimatedOptionValue: snapshot.estimatedOptionValue?.toString() ?? null,
          impliedVolatility: snapshot.impliedVolatility?.toString() ?? null,
          confidence: snapshot.confidence,
          state: snapshot.state,
          underlyingMovePct: snapshot.underlyingMovePct.toString(),
          distanceToStrike: snapshot.distanceToStrike.toString(),
          safetyBufferPct: snapshot.safetyBufferPct.toString(),
          daysToExpiry: snapshot.daysToExpiry,
          creditCapturePct: snapshot.creditCapturePct.toString(),
          pnlAmount: snapshot.pnlAmount.toString(),
          pnlPercent: snapshot.pnlPercent.toString(),
          sourceLabel: snapshot.sourceLabel,
          createdAt: new Date(snapshot.observedAt),
          updatedAt: new Date(snapshot.observedAt),
        })),
      );
    }

    if (basket.orderBlocks.length) {
      await db.insert(brokerOrderBlocks).values(
        basket.orderBlocks.map((orderBlock) => ({
          id: orderBlock.id,
          basketId: basket.id,
          broker: orderBlock.broker,
          side: orderBlock.side,
          title: orderBlock.title,
          orderText: orderBlock.orderText,
          createdAt: new Date(basket.publicationDate),
          updatedAt: new Date(basket.publicationDate),
        })),
      );
    }

    if (basket.priceAlerts.length) {
      await db.insert(positionAlerts).values(
        basket.priceAlerts.map((alert, index) => ({
          id: alert.id,
          basketId: basket.id,
          positionId: alert.positionId ?? null,
          ticker: alert.ticker,
          side: alert.side,
          label: alert.label,
          thresholdValue: alert.thresholdValue.toString(),
          protocolNote: alert.protocolNote,
          sortOrder: index,
          createdAt: new Date(basket.publicationDate),
          updatedAt: new Date(basket.publicationDate),
        })),
      );
    }

    const rules = [
      ...basket.hardStops.map((rule, index) => ({
        id: rule.id,
        basketId: basket.id,
        category: "hard-stop" as const,
        title: rule.title,
        body: rule.body,
        sortOrder: index,
        createdAt: new Date(basket.publicationDate),
        updatedAt: new Date(basket.publicationDate),
      })),
      ...basket.profitTargets.map((rule, index) => ({
        id: rule.id,
        basketId: basket.id,
        category: "profit-target" as const,
        title: rule.title,
        body: rule.body,
        sortOrder: basket.hardStops.length + index,
        createdAt: new Date(basket.publicationDate),
        updatedAt: new Date(basket.publicationDate),
      })),
    ];

    if (rules.length) {
      await db.insert(basketRules).values(rules);
    }
  }
}

async function seedSyncJobs() {
  if (!db) {
    return;
  }

  await db.insert(syncJobs).values(
    demoSyncJobs.map((job) => ({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      startedAt: new Date(job.startedAt),
      completedAt: job.completedAt ? new Date(job.completedAt) : null,
      positionsProcessed: job.positionsProcessed,
      errorsCount: job.errorsCount,
      notes: job.notes ?? null,
      createdAt: new Date(job.startedAt),
      updatedAt: new Date(job.completedAt ?? job.startedAt),
    })),
  );
}

async function main() {
  await resetTables();
  await seedUsers();
  await seedBaskets();
  await seedSyncJobs();
  console.log("Polytheta seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
