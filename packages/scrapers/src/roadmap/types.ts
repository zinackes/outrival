/**
 * Shared shape of a public roadmap / feedback portal, whatever vendor serves it.
 * Both adapters (Canny, ProductBoard) normalise onto this so the snapshot builder —
 * and therefore the diff the pipeline reads — is vendor-agnostic.
 */

export type RoadmapVendor = "canny" | "productboard";

export interface RoadmapEntry {
  /**
   * Vendor-stable identifier, unique within the portal. This is the SORT KEY of the
   * snapshot: it must not derive from the title or the status, or editing either
   * would reorder the list and turn a one-line change into a whole-file diff.
   */
  id: string;
  title: string;
  /**
   * The vendor's own status label, lowercased ("planned", "in progress",
   * "under consideration", "launched"). Not mapped onto an Outrival enum: portal
   * columns are user-defined, and the raw label is what a reader recognises.
   */
  status: string;
  /** Exact vote count. The snapshot writes voteBand(votes); the exact number goes to metadata. */
  votes: number;
  /** Public permalink to the entry, when the vendor exposes one. */
  url: string | null;
}

export interface RoadmapPortal {
  vendor: RoadmapVendor;
  /** The portal URL we actually read. */
  url: string;
  entries: RoadmapEntry[];
  /** The vendor told us it served only part of the roadmap (Canny's hasNextPage). */
  truncated: boolean;
}

/**
 * Why an adapter could not produce a portal. Each reason maps to a DIFFERENT thrown
 * error in the scraper, because they mean different things to the user:
 *
 * - `private`    — the portal exists but is access-restricted. Terminal and neutral:
 *                  no retry and no URL override can open it.
 * - `empty`      — a public portal with nothing on it. Neutral too, but distinct:
 *                  nothing is wrong, there is simply nothing to watch yet.
 * - `unparsable` — we reached a portal and its public structure did not yield a
 *                  single entry. That is a genuine breakage (the vendor changed its
 *                  payload), so it must stay a LOUD, retried failure. Guessing here
 *                  — with AI or otherwise — would emit a plausible-but-wrong list
 *                  that the next diff reads as a roadmap overhaul.
 */
export type RoadmapParseFailure = "private" | "empty" | "unparsable";

export type RoadmapParse =
  | { ok: true; portal: RoadmapPortal }
  | { ok: false; reason: RoadmapParseFailure };
