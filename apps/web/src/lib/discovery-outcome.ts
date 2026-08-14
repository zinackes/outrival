import { ApiError } from "./api";

// The add-product wizard creates the product FIRST, then runs discovery for it. So a
// discovery failure never means "the product wasn't added" — the SKU exists and is
// already being monitored. Every string below has to hold that line, and name what
// actually failed instead of collapsing a 500, a quota refusal and a client timeout
// into one "Couldn't run discovery now" (OUT-205, same family as OUT-187..190).
export interface DiscoverOutcome {
  // "pending" = the server is still working and will commit its results (a client
  // timeout doesn't cancel the handler), so it must NOT be rendered as a failure.
  // "failed" = discovery is over and produced nothing.
  tone: "pending" | "failed";
  title: string;
  description: string;
  // Retrying only makes sense when the very same call could succeed now. A monthly
  // quota, the hourly AI cap and a profile-less SKU can't, so they offer no retry.
  canRetry: boolean;
}

// `POST /api/candidates/detect` refuses in five distinct ways (cooldown 429, tier
// quota 429, hourly AI cap 429, missing_profile 400, detection_failed 500), plus the
// two client-side ones safeFetch synthesises (timeout, network_error).
export function discoverOutcome(err: unknown): DiscoverOutcome {
  const generic: DiscoverOutcome = {
    tone: "failed",
    title: "Discovery didn't finish",
    description:
      "The product is saved and being monitored, only the competitor search failed. Try again, or run it later from the Discovery page.",
    canRetry: true,
  };
  if (!(err instanceof ApiError)) return generic;

  const data = err.data;

  // A 90s client timeout aborts the browser, not the handler: candidates and a
  // notification land moments later. Claiming failure here would contradict the
  // toast that follows.
  if (err.code === "timeout") {
    return {
      tone: "pending",
      title: "Still searching for competitors",
      description:
        "This one is taking longer than usual. The results will appear on the Discovery page and in your notifications shortly.",
      canRetry: false,
    };
  }

  if (err.code === "network_error") {
    return {
      tone: "failed",
      title: "Couldn't reach the server",
      description:
        "The product is saved. The competitor search never left your browser, so nothing was lost: check your connection and try again.",
      canRetry: true,
    };
  }

  if (err.status === 429) {
    // Per-tier monthly discovery quota (tierLimitBody). Waiting a minute changes
    // nothing here, so no retry: the wait is a month or an upgrade.
    if (err.code === "discovery_limit_reached") {
      const limit = typeof data.limit === "number" ? data.limit : null;
      return {
        tone: "failed",
        title: "Monthly discovery limit reached",
        description: limit
          ? `The product is saved and being monitored. Your plan includes ${limit} discovery ${limit > 1 ? "scans" : "scan"} per month, and they reset next month. You can also add competitors by hand.`
          : "The product is saved and being monitored. Your plan's monthly discovery scans are all used and reset next month. You can also add competitors by hand.",
        canRetry: false,
      };
    }

    // The short anti-double-click cooldown, and only it, carries `retryInSec`.
    if (err.code === "cooldown") {
      const retryInSec = Number(data.retryInSec) || 0;
      const mins = Math.max(1, Math.ceil(retryInSec / 60));
      return {
        tone: "failed",
        title: `Discovery just ran. Try again in about ${mins} min`,
        description:
          "The product is saved and being monitored. Scanning is rate-limited to keep AI costs sane, so give it a minute or run it later from the Discovery page.",
        canRetry: true,
      };
    }

    // The hourly per-user AI cap writes its own sentence, including when it resets.
    const sent = typeof data.message === "string" ? data.message.trim() : "";
    return {
      tone: "failed",
      title: "Hourly AI limit reached",
      description:
        (sent || "You've used this hour's AI actions. They resume automatically.") +
        " The product is saved and being monitored in the meantime.",
      canRetry: false,
    };
  }

  // The wizard seeds a profile at creation, so this only fires when what it seeded is
  // too thin for discovery to search on.
  if (err.code === "missing_profile") {
    return {
      tone: "failed",
      title: "Discovery needs a fuller profile",
      description:
        "The product is saved and being monitored. Add its category and value proposition in the product's settings, then run discovery from the Discovery page.",
      canRetry: false,
    };
  }

  return generic;
}
