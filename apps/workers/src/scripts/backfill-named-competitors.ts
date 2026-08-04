// One-shot market map from the mentions we have already paid for (Positioning
// Intelligence v2 P2).
//
// Content P2 has been writing `content_items.competitors_named` since it shipped:
// every blog post a model read, and every rival that post named, is already in the
// database. Nothing ever queried that column. This walks it once and puts those
// names on the map, so the tab does not start empty and wait a quarter for the blog
// readers to come round again.
//
// Zero network, zero AI: it reads one table and writes another.
//
//   pnpm backfill:named-competitors                          # every competitor, dry run
//   pnpm backfill:named-competitors -- --apply               # write
//   pnpm backfill:named-competitors -- --apply --competitor <id>
//
// RULE, absolute: NO SIGNALS. `mergeNamedFromMentions` never touches `signalledAt`
// and never enqueues, so a catch-up over three years of posts cannot announce, three
// years late, that somebody opened a front. The comparison-page route keeps its own
// baseline marker, which this deliberately does not set: those rows come from the
// sitemap, and reading old posts says nothing about whether we have seen their
// comparison pages yet.
//
// Runs against whatever DATABASE_URL is loaded. On a shared environment, read
// .claude/rules/production.md first.

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, competitors, contentItems } from "@outrival/db";
import { mergeNamedFromMentions } from "../lib/named-competitors";
import { resolveSelfIdentity } from "../lib/self-identity";

const APPLY = process.argv.includes("--apply");
const idFlag = process.argv.indexOf("--competitor");
const ONLY = idFlag > -1 ? process.argv[idFlag + 1] : null;

async function main() {
  const targets = ONLY
    ? await db
        .select({
          id: competitors.id,
          name: competitors.name,
          url: competitors.url,
          orgId: competitors.orgId,
        })
        .from(competitors)
        .where(eq(competitors.id, ONLY))
    : await db
        .select({
          id: competitors.id,
          name: competitors.name,
          url: competitors.url,
          orgId: competitors.orgId,
        })
        .from(competitors)
        .where(isNull(competitors.deletedAt));

  console.log(`${APPLY ? "Applying" : "Dry run"} — ${targets.length} competitor(s)\n`);

  let totalMentions = 0;
  let totalWritten = 0;
  for (const competitor of targets) {
    const items = await db
      .select({
        sourceType: contentItems.sourceType,
        url: contentItems.url,
        mentions: contentItems.competitorsNamed,
      })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.competitorId, competitor.id),
          isNotNull(contentItems.competitorsNamed),
        ),
      );

    const usable = items
      .map((it) => ({
        sourceType: it.sourceType,
        url: it.url,
        mentions: (it.mentions ?? []).filter((m) => m.trim().length > 0),
      }))
      .filter((it) => it.mentions.length > 0);
    if (usable.length === 0) continue;

    const mentions = usable.reduce((n, it) => n + it.mentions.length, 0);
    totalMentions += mentions;
    const names = [...new Set(usable.flatMap((it) => it.mentions))];

    if (!APPLY) {
      console.log(
        `${competitor.name} — ${usable.length} item(s), ${mentions} mention(s): ` +
          `${names.slice(0, 6).join(", ")}${names.length > 6 ? ` (+${names.length - 6})` : ""}`,
      );
      continue;
    }

    const written = await mergeNamedFromMentions(competitor.id, usable, {
      self: await resolveSelfIdentity(competitor.orgId),
      owner: { name: competitor.name, url: competitor.url },
    });
    totalWritten += written;
    console.log(
      `${competitor.name} — ${usable.length} item(s), ${mentions} mention(s), ${written} new row(s)`,
    );
  }

  console.log(
    `\n${totalMentions} mention(s) read` +
      (APPLY ? `, ${totalWritten} row(s) written, 0 signals` : " (dry run)"),
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
