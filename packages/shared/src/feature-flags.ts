// patch-29 — static product feature flags. `multiUser` stays false until orgs gain
// invitations/RBAC (roadmap Phase 10); it gates the Members settings section so the
// Personal/Workspace structure ships now without exposing the unfinished feature.
export const FEATURE_FLAGS = {
  multiUser: false,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFeatureFlagEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag];
}
