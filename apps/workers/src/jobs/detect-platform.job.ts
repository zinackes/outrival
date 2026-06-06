import { task, logger } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { detectAndPersistPlatform } from "../lib/platform-detect";

const InputSchema = z.object({ competitorId: z.string() });

// Per-competitor platform detection (patch-31). Pure detection + persistence live
// in the lib; this is the durable wrapper. medium-1x because step B may lazily
// launch Chromium (api-capture) for an empty-SPA shell — the same reason
// scrape-monitor runs on medium-1x. Most runs are step A (no browser).
export const detectPlatformJob = task({
  id: "detect-platform",
  machine: "medium-1x",
  maxDuration: 120,
  retry: { maxAttempts: 2 },

  async run(payload: z.input<typeof InputSchema>) {
    const { competitorId } = InputSchema.parse(payload);
    logger.log("Starting detect-platform", { competitorId });
    const result = await detectAndPersistPlatform(competitorId);
    logger.log("Completed detect-platform", { competitorId, ...result });
    return result;
  },
});
