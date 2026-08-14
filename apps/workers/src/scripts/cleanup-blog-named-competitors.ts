// One-shot cleanup of the market map rows the old blog prompt produced (OUT-180).
//
// The rule, and why a row survives or not, lives in `../lib/blog-mention-cleanup`.
// This is the CLI around it.
//
// RULE, absolute: NOTHING ALREADY ANNOUNCED IS TOUCHED. A row carrying
// `signalled_at` is kept and counted, never deleted — that stamp is what stops a
// front announced two years ago from being announced again as news.
//
//   pnpm cleanup:blog-named-competitors                       # dry run
//   pnpm cleanup:blog-named-competitors -- --apply            # write
//   pnpm cleanup:blog-named-competitors -- --apply --competitor <id>
//
// Runs against whatever DATABASE_URL is loaded. On a shared environment, read
// .claude/rules/production.md first.

import { cleanupBlogMentions } from "../lib/blog-mention-cleanup";

const APPLY = process.argv.includes("--apply");
const idFlag = process.argv.indexOf("--competitor");
const ONLY = idFlag > -1 ? (process.argv[idFlag + 1] ?? null) : null;

async function main() {
  console.log(`${APPLY ? "Applying" : "Dry run"}${ONLY ? ` — competitor ${ONLY}` : ""}\n`);

  const report = await cleanupBlogMentions({ apply: APPLY, competitorId: ONLY });

  for (const { competitorName, names } of report.byCompetitor) {
    console.log(
      `${competitorName} — ${names.length} mention(s): ` +
        `${names.slice(0, 6).join(", ")}${names.length > 6 ? ` (+${names.length - 6})` : ""}`,
    );
  }

  console.log(
    `\n${report.deleted} row(s) ${APPLY ? "deleted" : "would be deleted"} across ` +
      `${report.byCompetitor.length} competitor(s), ${report.cleared} content item(s) ` +
      `${APPLY ? "cleared" : "would be cleared"}, ${report.announcedKept} announced row(s) kept` +
      `${APPLY ? ", 0 signals" : " (dry run)"}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
