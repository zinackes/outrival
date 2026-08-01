import { task } from "@trigger.dev/sdk/v3";
import { asTriggerRun } from "../lib/trigger-adapter";
import { runIngestBlogPosts } from "../core/ingest-blog-posts";

// Thin Trigger.dev wrapper — the job body lives in ../core/ingest-blog-posts
// (runtime neutral, shared with the pg-boss handler). Deleted at the Trigger
// cutover (Phase 7).
export const ingestBlogPostsJob = task({
  id: "ingest-blog-posts",
  maxDuration: 900,
  retry: { maxAttempts: 3, minTimeoutInMs: 1000, maxTimeoutInMs: 10000, factor: 2 },
  run: asTriggerRun(runIngestBlogPosts),
});
