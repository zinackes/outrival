import { z } from "zod";

/** Overlap-threshold presets surfaced as friendly sensitivity levels in the UI. */
export const DETECTION_OVERLAP_PRESETS = {
  broad: 50,
  balanced: 65,
  strict: 80,
} as const;

export type DetectionCadence = "weekly" | "monthly";

export const DetectionConfigSchema = z.object({
  /** A candidate surfaces only if its overlap score is strictly above this. */
  minOverlap: z.number().int().min(0).max(100),
  /** Whether the weekly cron auto-detects for this org (manual Refresh always works). */
  autoDetect: z.boolean(),
  /** How often auto-detection runs. */
  cadence: z.enum(["weekly", "monthly"]),
  /** Normalized hostnames never surfaced (parent co, partners, self). */
  excludedDomains: z.array(z.string()),
  /** Extra terms appended to the auto-derived Exa discovery query. */
  keywords: z.string(),
  /**
   * Primary market to bias discovery toward (ISO 3166-1 alpha-2, e.g. "fr") —
   * fed to Exa's `userLocation`. `null` = global (default). Biases, never filters.
   */
  region: z
    .string()
    .length(2)
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : v)),
});

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  minOverlap: DETECTION_OVERLAP_PRESETS.balanced,
  autoDetect: true,
  cadence: "weekly",
  excludedDomains: [],
  keywords: "",
  region: null,
};

/** Merge a (possibly partial / legacy) stored config over the defaults. */
export function resolveDetectionConfig(
  raw: Partial<DetectionConfig> | null | undefined,
): DetectionConfig {
  return { ...DEFAULT_DETECTION_CONFIG, ...(raw ?? {}) };
}

/**
 * Minimum gap the weekly cron enforces between two automatic runs for one org.
 * Slightly under the nominal period so a run that lands a few hours late one week
 * isn't skipped the next.
 */
export const DETECTION_MIN_INTERVAL_MS: Record<DetectionCadence, number> = {
  weekly: 6 * 24 * 60 * 60 * 1000,
  monthly: 27 * 24 * 60 * 60 * 1000,
};

/** The cron slot automatic detection runs in: Sunday 20:00 UTC. */
export const DETECTION_CRON_WEEKDAY = 0;
export const DETECTION_CRON_HOUR_UTC = 20;

/**
 * When automatic detection will next actually run for an org, which is not simply
 * "next Sunday": the cron fires weekly but skips any org whose last run (manual
 * scans included) is inside the cadence interval. Returns null when the org opted
 * out. Pure, so the UI can state a date instead of a vague "runs every Sunday".
 */
export function nextAutomaticDetectionAt(
  lastRunAt: Date | null,
  config: Pick<DetectionConfig, "autoDetect" | "cadence">,
  now: Date = new Date(),
): Date | null {
  if (!config.autoDetect) return null;
  const earliest = lastRunAt
    ? new Date(lastRunAt.getTime() + DETECTION_MIN_INTERVAL_MS[config.cadence])
    : now;
  const slot = new Date(Math.max(earliest.getTime(), now.getTime()));
  slot.setUTCHours(DETECTION_CRON_HOUR_UTC, 0, 0, 0);
  // setUTCHours can land in the past on the same day; step to the next day first,
  // then to the next cron weekday.
  if (slot.getTime() < Math.max(earliest.getTime(), now.getTime())) {
    slot.setUTCDate(slot.getUTCDate() + 1);
  }
  while (slot.getUTCDay() !== DETECTION_CRON_WEEKDAY) {
    slot.setUTCDate(slot.getUTCDate() + 1);
  }
  return slot;
}
