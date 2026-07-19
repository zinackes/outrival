import { logger } from "../lib/job-logger";
import { z } from "zod";
import { detectAndPersistPlatform } from "../lib/platform-detect";

const InputSchema = z.object({ competitorId: z.string() });

// Per-competitor platform detection (patch-31). Pure detection + persistence live
// in the lib; this is the durable wrapper. medium-1x because step B may lazily
// launch Chromium (api-capture) for an empty-SPA shell — the same reason
// scrape-monitor runs on medium-1x. Most runs are step A (no browser).
// Runtime-neutral job body: shared verbatim by the pg-boss handler and the thin
// Trigger.dev wrapper in ../jobs/detect-platform.job.ts (deleted at the cutover).
// The body is byte-identical to the pre-migration job — only the header and the
// signature change, so the two runtimes cannot drift.
export async function runDetectPlatform(payload: z.input<typeof InputSchema>) {
    const { competitorId } = InputSchema.parse(payload);
    logger.log("Starting detect-platform", { competitorId });
    const result = await detectAndPersistPlatform(competitorId);
    logger.log("Completed detect-platform", { competitorId, ...result });
    return result;
}
