import { and, eq, isNull } from "drizzle-orm";
import { db, competitors, organizations } from "@outrival/db";
import { hostOf, type SelfIdentity } from "@outrival/scrapers/content";

/**
 * Who this workspace is, as somebody else's page could refer to it: the names it
 * goes by and the domains it owns. Multi-SKU workspaces carry one self-competitor
 * per product, so all of them count — a page naming the second SKU is naming the
 * user just as much as one naming the first.
 *
 * Shared because two features now ask the same question and a divergence between
 * them is a bug with no symptom: the blog reader uses it to decide a `critical`
 * (Content P2), and the market map uses it to decide what NEVER enters the registry
 * (Positioning P2). If the second answered "not you" where the first answered "you",
 * a competitor's attack page would be filed as the reader competing with themselves.
 */
export async function resolveSelfIdentity(orgId: string): Promise<SelfIdentity> {
  const [org, selves] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { name: true, productUrl: true },
    }),
    db
      .select({ name: competitors.name, url: competitors.url })
      .from(competitors)
      .where(
        and(
          eq(competitors.orgId, orgId),
          eq(competitors.type, "self"),
          isNull(competitors.deletedAt),
        ),
      ),
  ]);

  const brands = [org?.name, ...selves.map((s) => s.name)].filter(
    (b): b is string => Boolean(b?.trim()),
  );
  const domains = [org?.productUrl, ...selves.map((s) => s.url)]
    .map((u) => hostOf(u))
    .filter((d): d is string => Boolean(d));
  return { brands, domains };
}
