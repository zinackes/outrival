import type { MonitorFrequency } from "./constants/sources";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const BASE_INTERVAL_MS: Record<MonitorFrequency, number> = {
  realtime: 1 * HOUR,
  daily: 24 * HOUR,
  weekly: 7 * DAY,
};

const MAX_INTERVAL_MS: Record<MonitorFrequency, number> = {
  realtime: 12 * HOUR,
  daily: 5 * DAY,
  weekly: 30 * DAY,
};

function stalenessMultiplier(daysStable: number): number {
  if (daysStable < 14) return 1;
  if (daysStable < 45) return 2;
  if (daysStable < 90) return 3;
  return 4;
}

export function computeNextRun(
  frequency: MonitorFrequency,
  lastChangedAt: Date | null,
  createdAt: Date,
  now: Date = new Date(),
): Date {
  const reference = lastChangedAt ?? createdAt;
  const daysStable = (now.getTime() - reference.getTime()) / DAY;
  const interval = Math.min(
    BASE_INTERVAL_MS[frequency] * stalenessMultiplier(daysStable),
    MAX_INTERVAL_MS[frequency],
  );
  return new Date(now.getTime() + interval);
}
