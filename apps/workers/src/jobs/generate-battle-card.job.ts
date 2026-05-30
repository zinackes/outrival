import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  battleCards,
  competitors,
  organizations,
  reviews,
  signals,
} from "@outrival/db";
import { generateBattleCard } from "@outrival/ai";
import { uploadToR2 } from "@outrival/shared";

const InputSchema = z.object({
  competitorId: z.string(),
  orgId: z.string(),
});

export const generateBattleCardJob = task({
  id: "generate-battle-card",
  maxDuration: 180,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const input = InputSchema.parse(payload);
    logger.log("Starting generate-battle-card", input);

    const competitor = await db.query.competitors.findFirst({
      where: and(eq(competitors.id, input.competitorId), eq(competitors.orgId, input.orgId)),
    });
    if (!competitor) throw new AbortTaskRunError(`Competitor ${input.competitorId} not found`);

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, input.orgId),
    });
    if (!org) throw new AbortTaskRunError(`Organization ${input.orgId} not found`);

    const profile = org.productProfile;
    if (!profile) {
      throw new AbortTaskRunError(
        `Organization ${input.orgId} has no productProfile — onboarding incomplete`,
      );
    }

    const recentSignals = await db.query.signals.findMany({
      where: eq(signals.competitorId, competitor.id),
      orderBy: desc(signals.createdAt),
      limit: 8,
    });

    const praisesRows = await db.query.reviews.findMany({
      where: and(eq(reviews.competitorId, competitor.id), eq(reviews.author, "praise")),
      orderBy: desc(reviews.detectedAt),
      limit: 8,
    });
    const complaintsRows = await db.query.reviews.findMany({
      where: and(eq(reviews.competitorId, competitor.id), eq(reviews.author, "complaint")),
      orderBy: desc(reviews.detectedAt),
      limit: 8,
    });

    const content = await generateBattleCard({
      myProduct: { category: profile.category, valueProp: profile.valueProp },
      competitorName: competitor.name,
      competitorSummary: competitor.aiSummary ?? competitor.description ?? null,
      reviewPraises: praisesRows.map((r) => r.content ?? "").filter(Boolean),
      reviewComplaints: complaintsRows.map((r) => r.content ?? "").filter(Boolean),
      recentSignals: recentSignals.map((s) => ({
        category: s.category,
        severity: s.severity,
        insight: s.insight,
      })),
    });

    if (!content) {
      throw new AbortTaskRunError("Battle card generation returned null");
    }

    const generatedAt = new Date();

    const existing = await db.query.battleCards.findFirst({
      where: eq(battleCards.competitorId, competitor.id),
    });

    let battleCardId: string;
    if (existing) {
      await db
        .update(battleCards)
        .set({ content, generatedAt, updatedAt: generatedAt })
        .where(eq(battleCards.id, existing.id));
      battleCardId = existing.id;
    } else {
      const [created] = await db
        .insert(battleCards)
        .values({
          competitorId: competitor.id,
          orgId: org.id,
          content,
          generatedAt,
          updatedAt: generatedAt,
        })
        .returning();
      if (!created) throw new Error("Failed to insert battle card");
      battleCardId = created.id;
    }

    // Lazy-import to avoid loading playwright/Chromium bindings at module parse
    // time (trigger.dev warns on >1 s import — playwright is the culprit).
    const [{ chromium }, { renderBattleCardHtml }] = await Promise.all([
      import("playwright"),
      import("../lib/battle-card-html"),
    ]);

    const html = renderBattleCardHtml({
      competitorName: competitor.name,
      myProductCategory: profile.category,
      generatedAt,
      content,
    });

    const browser = await chromium.launch({ headless: true });
    let pdfBuffer: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      pdfBuffer = Buffer.from(
        await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } }),
      );
    } finally {
      await browser.close();
    }

    const r2Key = `battle-cards/${competitor.id}/${generatedAt.toISOString()}.pdf`;
    await uploadToR2(r2Key, pdfBuffer, "application/pdf");

    await db
      .update(battleCards)
      .set({ pdfR2Key: r2Key, updatedAt: new Date() })
      .where(eq(battleCards.id, battleCardId));

    logger.log("Completed generate-battle-card", {
      battleCardId,
      pdfR2Key: r2Key,
      pdfBytes: pdfBuffer.length,
    });

    return { ok: true, battleCardId, pdfR2Key: r2Key };
  },
});
