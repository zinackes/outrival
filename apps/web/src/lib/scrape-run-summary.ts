// One scrape RUN = what the user asked for ("re-scan this competitor", "scan all
// sources"), however many monitors it fans out to. The poller used to report each
// monitor as it settled, on whichever 3s tick it landed on: scanning a competitor
// with eight sources produced up to ten toasts, none of which named the competitor.
//
// This turns the accumulated outcome of a run into the single line that closes it.
// Pure on purpose — the hook owns the timing, this owns the wording.

export interface ScrapeRunOutcome {
  competitorName: string;
  /** Sources whose scrape produced a new snapshot (lastChangedAt moved). */
  changed: string[];
  /** Sources that ran and came back identical. */
  unchanged: string[];
  failed: { label: string; reason: string }[];
  /** Sources still queued when we stopped watching. */
  pending: string[];
}

export interface ScrapeRunSummary {
  kind: "success" | "info" | "warning" | "error";
  title: string;
  description?: string;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** The live line while sources are still settling. */
export function scrapeRunProgress(
  competitorName: string,
  done: number,
  total: number,
): { title: string; description: string } {
  return {
    title: `Scanning ${competitorName}…`,
    description: `${done} of ${count(total, "source")} checked`,
  };
}

export function scrapeRunSummary(run: ScrapeRunOutcome): ScrapeRunSummary {
  const { competitorName: name, changed, unchanged, failed, pending } = run;
  const ran = changed.length + unchanged.length;

  const parts: string[] = [];
  if (changed.length > 0) parts.push(`Updated: ${changed.join(", ")}`);
  if (unchanged.length > 0) parts.push(`No change: ${unchanged.join(", ")}`);
  if (failed.length > 0) parts.push(`Failed: ${failed.map((f) => f.label).join(", ")}`);
  if (pending.length > 0) parts.push(`Still queued: ${pending.join(", ")}`);
  const description = parts.join(" · ");

  if (changed.length > 0) {
    return {
      kind: "success",
      title: `${name} · ${count(changed.length, "update")}`,
      description,
    };
  }
  // Nothing ran and everything failed: that's the failure of the run itself, so it
  // carries the reason rather than a source list the user can't act on.
  if (failed.length > 0 && ran === 0) {
    const sole = failed.length === 1 ? failed[0] : undefined;
    return {
      kind: "error",
      title: `Couldn't scan ${name}`,
      description: sole ? `${sole.label}: ${sole.reason}` : description,
    };
  }
  if (ran > 0) {
    return {
      kind: failed.length > 0 ? "warning" : "info",
      title: `${name} · nothing new`,
      description,
    };
  }
  return {
    kind: "warning",
    title: `${name} · still queued`,
    description:
      description ||
      "The queue is behind. These sources stay queued and will run on their own.",
  };
}
