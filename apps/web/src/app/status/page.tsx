import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { serverApiBase } from "@/lib/api-base";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = pageMetadata({
  path: "/status",
  title: "System Status",
  description:
    "Live operational status of the systems behind Outrival, checked on every page load.",
});

// A status page has to be right at the moment everything else is wrong, so this
// renders per request and never caches — a stale "Operational" during an outage
// is worse than no page at all.
export const dynamic = "force-dynamic";
export const revalidate = 0;

type State = "operational" | "degraded" | "down" | "unknown";
type Component = { name: string; state: State; detail: string };
type StatusPayload = {
  overall: State;
  components: Component[];
  checkedAt: string;
};

// The four systems, in the order they appear when everything is fine — so the
// page keeps its shape even when the API is the thing that is broken.
const FALLBACK: Component[] = [
  { name: "Dashboard & API", state: "unknown", detail: "" },
  { name: "Scraping pipeline", state: "unknown", detail: "" },
  { name: "AI insights", state: "unknown", detail: "" },
  { name: "Email & Slack delivery", state: "unknown", detail: "" },
];

const DOT: Record<State, string> = {
  operational: "bg-positive",
  degraded: "bg-high",
  down: "bg-critical",
  unknown: "bg-text-subtle",
};

const LABEL: Record<State, string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

const HEADLINE: Record<State, string> = {
  operational: "All systems operational",
  degraded: "Some systems are degraded",
  down: "We have an active outage",
  unknown: "Status unavailable",
};

async function getStatus(): Promise<StatusPayload | null> {
  const base = serverApiBase();
  try {
    const res = await fetch(`${base}/api/public/status`, {
      cache: "no-store",
      // The API being slow is itself a symptom; don't hang the page on it.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as StatusPayload;
  } catch {
    return null;
  }
}

export default async function StatusPage() {
  const status = await getStatus();
  const components = status?.components ?? FALLBACK;
  const overall: State = status?.overall ?? "unknown";

  return (
    <DocPage
      title="System status"
      intro="Live health of the core systems behind Outrival, checked when you load this page. Incidents and scheduled maintenance are posted here."
    >
      <div className="flex items-center gap-2.5 rounded-md border border-border bg-background-2 px-4 py-3">
        <span className={`size-2.5 shrink-0 rounded-full ${DOT[overall]}`} />
        <span className="text-sm font-medium text-foreground">
          {HEADLINE[overall]}
        </span>
      </div>

      <ul className="mt-4 flex flex-col divide-y divide-border rounded-md border border-border">
        {components.map((s) => (
          <li key={s.name} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">{s.name}</span>
              <span className="inline-flex items-center gap-2 text-xs text-text-muted">
                <span className={`size-2 shrink-0 rounded-full ${DOT[s.state]}`} />
                {LABEL[s.state]}
              </span>
            </div>
            {s.detail && (
              <span className="text-xs text-text-subtle">{s.detail}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-text-subtle">
        {status ? (
          <>
            Last checked{" "}
            <time dateTime={status.checkedAt}>
              {new Date(status.checkedAt).toISOString().replace("T", " ").slice(0, 16)} UTC
            </time>
            . &ldquo;Unknown&rdquo; means nothing was due in the last hour, not
            that something is wrong.
          </>
        ) : (
          <>
            The status API could not be reached, so the states above are unknown.
            That may itself indicate an incident.
          </>
        )}
      </p>
    </DocPage>
  );
}
