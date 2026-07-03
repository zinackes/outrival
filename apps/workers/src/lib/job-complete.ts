import { db, notifications } from "@outrival/db";

// Durable, reviewable record that a user-initiated background job has finished and
// its result is ready. It lands in the notification bell (and echoes as a toast if
// the user is still on the page), so a completion that resolves minutes later isn't
// lost the way a fire-and-forget toast is when the user has moved on.
//
// Best-effort: the job's real work has already succeeded by the time this runs, so a
// failed notification insert must never fail the job.
export async function notifyJobComplete(opts: {
  orgId: string;
  title: string;
  body?: string | null;
  linkUrl?: string | null;
}): Promise<void> {
  try {
    await db.insert(notifications).values({
      orgId: opts.orgId,
      type: "analysis_ready",
      title: opts.title,
      body: opts.body ?? null,
      linkUrl: opts.linkUrl ?? null,
    });
  } catch {
    // Swallow — logging channel is per-job; a lost completion ping is acceptable,
    // a job that fails because of one is not.
  }
}
