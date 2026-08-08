import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, audiencePages, caseStudies } from "@outrival/db";
import { industryLabel } from "@outrival/shared";

/**
 * The ICP profile: who a competitor SAYS it sells to, and who its own stories PROVE
 * it sells to (Positioning Intelligence v2 P3).
 *
 * Two tables, one question. `audience_pages` is what they publish — a `/for/agencies`
 * page is a segment somebody decided to go after, stated in public. `case_studies` is
 * what they can show for it — a named customer in a named vertical. The gap between
 * the two is the read: a company with six industry pages and case studies in one of
 * them is aiming, not landing; a vertical proven with three stories and no page is one
 * they fell into.
 *
 * The intersection only means anything because BOTH sides went through the same
 * resolver. `audience_pages.slug` for kind=industry and `case_studies.customer_industry`
 * are both `@outrival/shared` industry-catalog output, so `/industries/fin-tech` and a
 * case study about "Fintech" are one slug. Without that, "declared vs proven" would
 * intersect two independent spellings and always come back empty.
 *
 * Deterministic end to end — nothing here is written by a model.
 */

/** How recent a first sighting has to be to still wear the `new` badge. */
export const AUDIENCE_NEW_WINDOW_DAYS = 30;

export interface AudienceSegment {
  slug: string;
  displayName: string;
  evidenceUrl: string | null;
  /** "YYYY-MM-DD" — when WE first saw the page; a sitemap carries no date. */
  firstSeenAt: string | null;
  /** First seen inside the badge window. */
  isNew: boolean;
}

/** A declared industry also carries whether its slug is comparable at all. */
export interface DeclaredIndustry extends AudienceSegment {
  isCanonical: boolean;
}

/** A vertical their case studies actually name, and how many say so. */
export interface ProvenIndustry {
  slug: string;
  label: string;
  count: number;
  isCanonical: boolean;
}

/** A vertical they publish a page for AND have stories in. The core of the read. */
export interface ProvenAndDeclared {
  slug: string;
  label: string;
  declaredName: string;
  evidenceUrl: string | null;
  provenCount: number;
}

export interface AudienceProfile {
  personas: AudienceSegment[];
  useCases: AudienceSegment[];
  industries: {
    declared: DeclaredIndustry[];
    proven: ProvenIndustry[];
    both: ProvenAndDeclared[];
  };
  /** Segments first seen inside the badge window, all kinds — the "what moved" count. */
  newCount: number;
  windowDays: number;
}

export async function audienceProfile(competitorId: string): Promise<AudienceProfile> {
  const cutoff = new Date(Date.now() - AUDIENCE_NEW_WINDOW_DAYS * 86_400_000);

  const [pages, proven] = await Promise.all([
    db
      .select({
        kind: audiencePages.kind,
        slug: audiencePages.slug,
        displayName: audiencePages.displayName,
        isCanonical: audiencePages.isCanonical,
        evidenceUrl: audiencePages.evidenceUrl,
        firstSeenAt: sql<string | null>`to_char(${audiencePages.firstSeenAt}, 'YYYY-MM-DD')`,
        // A typed comparison, not `sql`${col} >= ${cutoff}``: a Date interpolated into a
        // raw template carries no encoder and postgres-js rejects the whole query, so the
        // endpoint answered 500 on every competitor. PGlite accepts the bind, which is why
        // the suite below stayed green through it. Same trap `attributionWindow`
        // documents in signal-facts.ts.
        isNew: sql<boolean>`${gte(audiencePages.firstSeenAt, cutoff)}`,
      })
      .from(audiencePages)
      .where(eq(audiencePages.competitorId, competitorId))
      .orderBy(desc(audiencePages.firstSeenAt)),
    // Aggregated in SQL: the count IS the answer ("three stories in fintech"), and
    // pulling every story back to count them in JS would grow with their catalogue.
    // Anonymised stories count — a story with no customer name still names a market,
    // which is the whole reason `case_studies` keeps those rows.
    db
      .select({
        slug: caseStudies.customerIndustry,
        isCanonical: sql<number>`max(${caseStudies.isCanonicalIndustry})`,
        count: sql<number>`count(*)::int`,
      })
      .from(caseStudies)
      .where(
        and(
          eq(caseStudies.competitorId, competitorId),
          sql`${caseStudies.customerIndustry} is not null`,
        ),
      )
      .groupBy(caseStudies.customerIndustry)
      .orderBy(desc(sql`count(*)`)),
  ]);

  const segment = (row: (typeof pages)[number]): AudienceSegment => ({
    slug: row.slug,
    displayName: row.displayName,
    evidenceUrl: row.evidenceUrl,
    firstSeenAt: row.firstSeenAt,
    isNew: Boolean(row.isNew),
  });

  const personas = pages.filter((p) => p.kind === "persona").map(segment);
  const useCases = pages.filter((p) => p.kind === "use_case").map(segment);
  const declared: DeclaredIndustry[] = pages
    .filter((p) => p.kind === "industry")
    .map((p) => ({ ...segment(p), isCanonical: p.isCanonical === 1 }));

  const provenList: ProvenIndustry[] = proven
    .filter((p): p is typeof p & { slug: string } => typeof p.slug === "string")
    .map((p) => ({
      slug: p.slug,
      label: industryLabel(p.slug),
      count: Number(p.count),
      isCanonical: Number(p.isCanonical) === 1,
    }));

  const provenBySlug = new Map(provenList.map((p) => [p.slug, p]));
  const both: ProvenAndDeclared[] = declared
    .filter((d) => provenBySlug.has(d.slug))
    .map((d) => ({
      slug: d.slug,
      label: industryLabel(d.slug),
      declaredName: d.displayName,
      evidenceUrl: d.evidenceUrl,
      provenCount: provenBySlug.get(d.slug)!.count,
    }));

  return {
    personas,
    useCases,
    industries: { declared, proven: provenList, both },
    newCount: pages.filter((p) => Boolean(p.isNew)).length,
    windowDays: AUDIENCE_NEW_WINDOW_DAYS,
  };
}
