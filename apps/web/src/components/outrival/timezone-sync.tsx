"use client";

import { useTimezoneDetection } from "@/hooks/use-timezone-detection";

// Renderless client component: runs the patch-26 timezone auto-detection once per
// dashboard session. Mounted in the dashboard layout next to the other sync
// effects (PostHog identity).
export function TimezoneSync() {
  useTimezoneDetection();
  return null;
}
