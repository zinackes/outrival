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
});

export type DetectionConfig = z.infer<typeof DetectionConfigSchema>;

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  minOverlap: DETECTION_OVERLAP_PRESETS.balanced,
  autoDetect: true,
  cadence: "weekly",
  excludedDomains: [],
  keywords: "",
};

/** Merge a (possibly partial / legacy) stored config over the defaults. */
export function resolveDetectionConfig(
  raw: Partial<DetectionConfig> | null | undefined,
): DetectionConfig {
  return { ...DEFAULT_DETECTION_CONFIG, ...(raw ?? {}) };
}
