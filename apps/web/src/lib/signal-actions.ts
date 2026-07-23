import type { ActionStatus } from "@/lib/api";

/**
 * The vocabulary of what a user can do with a signal. Shared by the detail
 * panel, the list's bulk bar and the legacy card so the same action never has
 * two names — a button that says "In progress" must read "In progress"
 * everywhere it appears.
 */

export const ACTION_OPTIONS: { value: ActionStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "dismissed", label: "Dismissed" },
];

export const ACTION_LABEL: Record<ActionStatus, string> = {
  todo: "To do",
  doing: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

/** Snooze durations — the client computes the absolute `until` from `ms`. */
export const SNOOZE_PRESETS: { label: string; ms: number }[] = [
  { label: "Later today", ms: 4 * 60 * 60 * 1000 },
  { label: "Tomorrow", ms: 24 * 60 * 60 * 1000 },
  { label: "Next week", ms: 7 * 24 * 60 * 60 * 1000 },
];

/** patch-26 moderation transparency: why a signal wasn't sent as an alert. */
export const FILTERED_REASON_LABEL: Record<string, string> = {
  below_threshold: "below your relevance threshold",
  channel_muted: "channel muted for this severity",
  quiet_hours: "held during quiet hours",
  frequency_cap: "daily email limit reached",
};
