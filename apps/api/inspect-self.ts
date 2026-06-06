import { db, competitors, monitors, snapshots, changes, selfProductChanges } from "@outrival/db";
import { eq, desc, inArray } from "drizzle-orm";

const selfs = await db.query.competitors.findMany({
  where: eq(competitors.type, "self"),
});
console.log(`\n=== SELF COMPETITORS (${selfs.length}) ===`);
for (const s of selfs) {
  console.log(`\n# ${s.name} (${s.id}) org=${s.orgId} url=${s.url ?? "—"}`);
  const profile = (s.selfProfile ?? {}) as Record<string, any>;
  console.log("  selfProfile fields:");
  for (const [k, v] of Object.entries(profile)) {
    if (v && typeof v === "object" && "isFromAutoDetect" in v) {
      const edited = v.isFromAutoDetect === false;
      console.log(
        `    ${k}: ${edited ? "USER-EDITED" : "auto"} = ${JSON.stringify(v.value)?.slice(0, 80)}`,
      );
    } else {
      console.log(`    ${k}: (raw) ${JSON.stringify(v)?.slice(0, 80)}`);
    }
  }

  const mons = await db.query.monitors.findMany({ where: eq(monitors.competitorId, s.id) });
  const monIds = mons.map((m) => m.id);
  console.log(`  monitors (${mons.length}):`);
  for (const m of mons) {
    const snaps = await db.query.snapshots.findMany({
      where: eq(snapshots.monitorId, m.id),
      orderBy: desc(snapshots.scrapedAt),
      limit: 4,
    });
    console.log(
      `    [${m.sourceType}] active=${m.isActive} lastRun=${m.lastRunAt?.toISOString() ?? "—"} lastChanged=${m.lastChangedAt?.toISOString() ?? "—"} snaps=${snaps.length}`,
    );
    for (const sn of snaps) {
      console.log(
        `        snap ${sn.scrapedAt.toISOString()} hash=${sn.contentHash?.slice(0, 10)} size=${sn.contentSize} status=${sn.status}`,
      );
    }
  }

  if (monIds.length) {
    const chs = await db.query.changes.findMany({
      where: inArray(changes.monitorId, monIds),
      orderBy: desc(changes.detectedAt),
      limit: 8,
    });
    console.log(`  changes (${chs.length} recent):`);
    for (const ch of chs) {
      console.log(
        `    ${ch.detectedAt.toISOString()} type=${ch.diffType} rel=${ch.relevanceScore} summary=${(ch.summary ?? "").slice(0, 70)}`,
      );
    }
  }

  const spc = await db.query.selfProductChanges.findMany({
    where: eq(selfProductChanges.selfCompetitorId, s.id),
    orderBy: desc(selfProductChanges.detectedAt),
    limit: 10,
  });
  console.log(`  self_product_changes (${spc.length}):`);
  for (const p of spc) {
    console.log(
      `    ${p.detectedAt.toISOString()} field=${p.fieldPath} status=${p.status} changeId=${p.changeId ?? "null(profile)"} sev=${p.severity} :: ${(p.summary ?? "").slice(0, 60)}`,
    );
  }
}

process.exit(0);
