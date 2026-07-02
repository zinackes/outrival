import { task, logger, AbortTaskRunError } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  db,
  battleCards,
  competitors,
  products,
  organizations,
  monitors,
  snapshots,
  reviews,
  signals,
  techStackEntries,
  selfProfileLastEditedAt,
  insertAiQualityCheck,
  type SelfProfile,
} from "@outrival/db";
import { generateBattleCard, reviseBattleCard, AI_CONFIG } from "@outrival/ai";
import { uploadToR2, getFromR2 } from "@outrival/shared";
import { isCloudflareChallenge } from "@outrival/scrapers/block-detection";
import { htmlToText } from "../lib/html-to-text";
import {
  logAiRun,
  getLatestTrial,
  getLatestPricingTiers,
  getLatestReviewScore,
} from "../lib/analytics";
import { refreshCompetitorSummaryJob } from "./refresh-competitor-summary.job";

// Pull the latest homepage capture as clean text so the card grounds feature
// claims on what a product ACTUALLY says about itself — the biggest lever against
// stale parametric comparisons. Best-effort: null on no monitor / no snapshot / R2
// miss / anti-bot shell (mirrors refresh-competitor-summary's guard).
async function loadHomepageExcerpt(
  competitorId: string,
  maxChars = 3500,
): Promise<string | null> {
  const homepageMonitor = await db.query.monitors.findFirst({
    where: and(eq(monitors.competitorId, competitorId), eq(monitors.sourceType, "homepage")),
  });
  if (!homepageMonitor) return null;
  const latest = await db.query.snapshots.findFirst({
    where: eq(snapshots.monitorId, homepageMonitor.id),
    orderBy: desc(snapshots.scrapedAt),
  });
  if (!latest) return null;
  try {
    const html = await getFromR2(`${latest.r2Key}.html`);
    if (isCloudflareChallenge(html)) return null;
    return htmlToText(html).slice(0, maxChars);
  } catch (err) {
    logger.warn("Failed to load homepage snapshot for battle card", { err: String(err) });
    return null;
  }
}

const InputSchema = z.object({
  competitorId: z.string(),
  orgId: z.string(),
  // patch-28 — which product (SKU) this card defends. Optional: defaults to the
  // org's primary product (so single-product orgs and legacy callers are unchanged).
  productId: z.string().optional(),
});

export const generateBattleCardJob = task({
  id: "generate-battle-card",
  // Launches Chromium to render the PDF — too tight on the default 0.5 GB.
  machine: "small-2x",
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

    // patch-28 — resolve the product this card is for (the given one, else the org's
    // primary) and source "my product" from its self-competitor profile, so each
    // (product, competitor) couple gets a product-specific card. Falls back to the
    // org productProfile for a legacy org with no product row yet.
    const product = input.productId
      ? await db.query.products.findFirst({
          where: and(eq(products.id, input.productId), eq(products.orgId, org.id)),
        })
      : await db.query.products.findFirst({
          where: and(
            eq(products.orgId, org.id),
            eq(products.isPrimary, true),
            ne(products.status, "archived"),
          ),
        });
    const productSelf = product
      ? await db.query.competitors.findFirst({
          where: eq(competitors.id, product.selfCompetitorId),
        })
      : null;
    const sp = (productSelf?.selfProfile ?? null) as SelfProfile | null;
    const myCategory = sp?.category?.value ?? org.productProfile?.category ?? null;
    const myValueProp = sp?.valueProp?.value ?? org.productProfile?.valueProp ?? "";
    if (!myCategory) {
      throw new AbortTaskRunError(
        `No product profile for org ${input.orgId} — onboarding incomplete`,
      );
    }
    const otherProducts = product
      ? await db.query.products.findMany({
          where: and(
            eq(products.orgId, org.id),
            ne(products.id, product.id),
            ne(products.status, "archived"),
          ),
          columns: { name: true },
        })
      : [];

    const recentSignals = await db.query.signals.findMany({
      where: eq(signals.competitorId, competitor.id),
      orderBy: desc(signals.createdAt),
      limit: 8,
    });

    // Latest detected free-trial state (patch-33) — a concrete acquisition lever for
    // the card. Best-effort: null when no pricing captured / pre-detection.
    const competitorTrial = await getLatestTrial(competitor.id);

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

    // Battle cards are grounded against the competitor's evidence (summary + reviews
    // + signals). A freshly added competitor has none of it, so the grounded model
    // drops every assertion and the card comes back all-empty. Generate the AI summary
    // first (built from the homepage snapshot) so the card has real material to ground
    // on — matching what already happens once a summary exists.
    let competitorSummary = competitor.aiSummary ?? competitor.description ?? null;
    if (!competitor.aiSummary) {
      logger.log("No AI summary yet — generating it before the battle card", {
        competitorId: competitor.id,
      });
      const summaryRun = await refreshCompetitorSummaryJob.triggerAndWait({
        competitorId: competitor.id,
      });
      if (summaryRun.ok && summaryRun.output.ok && summaryRun.output.summary) {
        competitorSummary = summaryRun.output.summary;
      }
    }

    // Real, current facts for BOTH sides — the fix for stale parametric comparisons.
    // Each is best-effort (empty/null when never captured) so the model abstains on a
    // dimension rather than inventing it. The competitor's evidence:
    const competitorPricingTiers = await getLatestPricingTiers(competitor.id);
    const competitorTechRows = await db.query.techStackEntries.findMany({
      where: and(
        eq(techStackEntries.competitorId, competitor.id),
        eq(techStackEntries.isActive, true),
      ),
      orderBy: desc(techStackEntries.lastDetectedAt),
      limit: 20,
    });
    const competitorReviews = await getLatestReviewScore(competitor.id);
    const competitorHomepageExcerpt = await loadHomepageExcerpt(competitor.id);

    // Our own product's evidence — features / tech / pricing come from the self
    // profile (extract-self-profile keeps them current), homepage from its snapshot.
    const myFeatures = sp?.features?.value ?? [];
    const myTechStack = sp?.techStack?.value ?? [];
    const myPricingTiers = (sp?.pricingTiers?.value ?? []).map((t) => ({
      planName: t.plan_name,
      price: t.price,
      currency: t.currency,
      billingPeriod: t.billing_period,
    }));
    const myAudience = sp?.audience?.value ?? null;
    const myHomepageExcerpt = productSelf ? await loadHomepageExcerpt(productSelf.id) : null;

    const battleCardInput = {
      myProduct: {
        name: product?.name,
        category: myCategory,
        valueProp: myValueProp,
        audience: myAudience,
        features: myFeatures,
        techStack: myTechStack,
        pricingTiers: myPricingTiers,
        homepageExcerpt: myHomepageExcerpt,
      },
      competitorName: competitor.name,
      competitorSummary,
      competitorHomepageExcerpt,
      competitorTrial: competitorTrial
        ? {
            hasTrial: competitorTrial.has_trial,
            days: competitorTrial.days,
            requiresCreditCard: competitorTrial.requires_credit_card,
          }
        : null,
      competitorPricingTiers,
      competitorTechStack: competitorTechRows.map((t) => ({
        name: t.techName,
        category: t.category,
        importance: t.importance,
      })),
      competitorReviews,
      reviewPraises: praisesRows.map((r) => r.content ?? "").filter(Boolean),
      reviewComplaints: complaintsRows.map((r) => r.content ?? "").filter(Boolean),
      recentSignals: recentSignals.map((s) => ({
        category: s.category,
        severity: s.severity,
        insight: s.insight,
      })),
      otherProductNames: otherProducts.map((p) => p.name),
    };

    // Ops quality logging (patch-02): success / parse_failed (null) / error.
    const { provider, model } = AI_CONFIG.insights;
    let content;
    try {
      content = await generateBattleCard(battleCardInput);
    } catch (err) {
      await logAiRun("battle_card", provider, model, "error");
      throw err;
    }
    await logAiRun("battle_card", provider, model, content ? "success" : "parse_failed");

    if (!content) {
      throw new AbortTaskRunError("Battle card generation returned null");
    }

    // Phase 2A — verification pass with teeth: re-read the draft against the same
    // evidence and drop every claim that isn't traceable to it (removes the stale
    // one-sided comparisons the self-check only used to flag). Best-effort: on a
    // parse miss we keep the grounded draft rather than lose the card.
    try {
      const revised = await reviseBattleCard(battleCardInput, content);
      await logAiRun("battle_card_revise", provider, model, revised ? "success" : "parse_failed");
      if (revised) content = revised;
    } catch (err) {
      // A verification failure (rate limit / breaker) must never sink the card —
      // patch-22 graceful degradation. Keep the draft; log the miss.
      await logAiRun("battle_card_revise", provider, model, "error");
      logger.warn("Battle card revise pass skipped", { err: String(err) });
    }

    // Safety net: a grounded card with no evidence comes back with every section
    // empty (the schema permits empty arrays). Never persist a blank document — abort
    // with a clear reason so the UI surfaces a failure instead of a card full of "—".
    const isEmpty =
      content.their_strengths.length === 0 &&
      content.our_strengths.length === 0 &&
      content.their_weaknesses.length === 0 &&
      content.common_objections.length === 0 &&
      content.when_we_win.length === 0 &&
      content.when_we_lose.length === 0;
    if (isEmpty) {
      throw new AbortTaskRunError(
        "Battle card came back empty — no competitor summary, reviews or signals to ground on yet",
      );
    }

    const generatedAt = new Date();

    // Snapshot the inputs this card is based on (patch-22 staleness). The latest
    // competitor signal is recentSignals[0] (already ordered desc); the user's last
    // self-profile edit comes from this product's self-competitor (patch-28). Clear
    // the patch-21 "not useful" flag — a fresh generation supersedes it.
    const basedOnUserUpdateAt =
      selfProfileLastEditedAt(productSelf?.selfProfile) ?? productSelf?.updatedAt ?? null;
    const basedOnCompetitorSignalAt = recentSignals[0]?.createdAt ?? null;

    const existing = product
      ? await db.query.battleCards.findFirst({
          where: and(
            eq(battleCards.productId, product.id),
            eq(battleCards.competitorId, competitor.id),
          ),
        })
      : await db.query.battleCards.findFirst({
          where: eq(battleCards.competitorId, competitor.id),
        });

    let battleCardId: string;
    if (existing) {
      await db
        .update(battleCards)
        .set({
          content,
          generatedAt,
          updatedAt: generatedAt,
          basedOnUserUpdateAt,
          basedOnCompetitorSignalAt,
          flaggedForRegenerationAt: null,
        })
        .where(eq(battleCards.id, existing.id));
      battleCardId = existing.id;
    } else {
      const [created] = await db
        .insert(battleCards)
        .values({
          competitorId: competitor.id,
          productId: product?.id ?? null,
          orgId: org.id,
          content,
          generatedAt,
          updatedAt: generatedAt,
          basedOnUserUpdateAt,
          basedOnCompetitorSignalAt,
        })
        .returning();
      if (!created) throw new Error("Failed to insert battle card");
      battleCardId = created.id;
    }

    // Anti-hallucination (patch-24): battle cards always get a systematic self-check
    // (the most visible critical output). Persist its envelope so a failed check
    // surfaces a warning on the card and lands in the ops review queue. Best-effort.
    await insertAiQualityCheck({
      aiTask: "generate_battle_card",
      targetType: "battle_card",
      targetId: battleCardId,
      orgId: org.id,
      quality: content._quality,
    });

    // Lazy-import to avoid loading playwright/Chromium bindings at module parse
    // time (trigger.dev warns on >1 s import — playwright is the culprit).
    const [{ chromium }, { renderBattleCardHtml }] = await Promise.all([
      import("playwright"),
      import("../lib/battle-card-html.js"),
    ]);

    const html = renderBattleCardHtml({
      competitorName: competitor.name,
      myProductCategory: myCategory,
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
