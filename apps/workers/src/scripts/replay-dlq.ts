// Replay every job parked in `outrival-dlq` back onto the queue it died on.
//
// The dead-letter queue has no consumer by design (heartbeat.ts skips it): a job
// lands there so a human can look at it, and nothing ever takes it out again. That
// is the right default right up until an incident parks a thousand jobs in it.
// OUT-237 parked 982 changes over twelve days because the AI pool refused to fail
// over a 402, and once the pool is fixed those changes are still unclassified and
// their signals still unwritten. Dropping them loses twelve days of monitoring;
// re-sending them by hand is a thousand statements against the queue database.
//
// A job reaches this queue by two roads, and they name its origin in two different
// places. A handler that throws `DeadLetter` goes through our own wrapper, which
// wraps the payload in a `__dlq` envelope carrying that name. Retry exhaustion goes
// through pg-boss itself, which copies `data` verbatim and records the origin in the
// job's `source_name` column instead. The envelope is therefore absent on exactly
// the jobs an incident produces: read only the envelope and a backlog of 982 reads
// as 982 jobs nobody can route.
//
// Send first, complete second, in that order: a crash mid-run can replay a job
// twice, never lose one. Handlers are idempotent by rule (.claude/rules/jobs.md) —
// content hashes and the unique constraint on signals.change_id absorb a duplicate,
// and nothing absorbs a change that was silently dropped.
//
//   pnpm replay:dlq                            # count what is parked, write nothing
//   pnpm replay:dlq -- --apply                 # replay all of it
//   pnpm replay:dlq -- --apply --limit 200     # replay a wave
//
// --limit exists because the pool's free providers have a DAILY token quota, so a
// backlog larger than one day's worth will not all classify today. It is a comfort
// knob, not a safety one, and the bias should be toward replaying MORE at a time:
// a dead-lettered job carries a `keep_until` of fourteen days and maintenance
// deletes it on that date without a word, whereas a job that fails again lands back
// here with a fresh fourteen days on it. Waiting costs the backlog; retrying does
// not.
//
// Runs against whatever QUEUE_DATABASE_URL is loaded. On a shared environment, read
// .claude/rules/production.md first.

import { startQueue, stopQueue, getBoss, deadLetterQueue, jobData } from "@outrival/queue";

const apply = process.argv.includes("--apply");
const limitFlag = process.argv.indexOf("--limit");
const rawLimit = limitFlag > -1 ? Number(process.argv[limitFlag + 1]) : Number.NaN;
const limit =
  Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : Number.POSITIVE_INFINITY;

/** What `deadLetterPayload` wrote around the original job data. */
type Parked = { __dlq?: { queue?: string; reason?: string; jobId?: string } };

async function main(): Promise<void> {
  await startQueue({ mode: "sender" });
  const boss = getBoss();

  const dlq = await boss.getQueue(deadLetterQueue.name);
  if (!dlq) {
    console.log(`${deadLetterQueue.name} does not exist on this queue database.`);
    return;
  }

  console.log(`${deadLetterQueue.name}: ${dlq.queuedCount} parked`);
  if (!apply) {
    console.log("dry run — pass --apply to replay");
    return;
  }

  const replayed = new Map<string, number>();
  const queueExists = new Map<string, boolean>();
  let done = 0;
  let skipped = 0;

  // A skipped job is deliberately NOT completed: it stays locked for the rest of
  // this run, then returns to the queue on its own once the fetch lock expires. A
  // job nobody can route is evidence, and evidence is not ours to delete.
  while (done + skipped < limit) {
    const batch = await boss.fetch<Parked>(deadLetterQueue.name, {
      batchSize: Math.min(100, limit - done - skipped),
      // For `sourceName`: the only record of where a job pg-boss dead-lettered on
      // its own came from.
      includeMetadata: true,
    });
    if (batch.length === 0) break;

    for (const job of batch) {
      const { __dlq, ...payload } = jobData(job.data);
      const target = __dlq?.queue ?? job.sourceName ?? undefined;
      if (!target) {
        console.warn(`skip ${job.id}: neither a __dlq envelope nor a source queue`);
        skipped++;
        continue;
      }
      if (!queueExists.has(target)) {
        queueExists.set(target, (await boss.getQueue(target)) !== null);
      }
      if (!queueExists.get(target)) {
        console.warn(`skip ${job.id}: queue "${target}" no longer exists`);
        skipped++;
        continue;
      }
      const sent = await boss.send(target, payload);
      if (!sent) {
        console.warn(`skip ${job.id}: send to "${target}" returned no id`);
        skipped++;
        continue;
      }
      await boss.complete(deadLetterQueue.name, job.id);
      replayed.set(target, (replayed.get(target) ?? 0) + 1);
      done++;
    }
  }

  for (const [queue, count] of [...replayed].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count}\t${queue}`);
  }
  console.log(`replayed ${done}, skipped ${skipped}`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => stopQueue());
