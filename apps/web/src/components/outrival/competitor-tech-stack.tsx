"use client";

import { formatDistanceToNow } from "date-fns";
import { Check, Cpu, Layers } from "lucide-react";
import { TabCard, TabSection } from "./tab-shell";
import { FreshnessDot } from "./freshness-dot";
import { ConfidenceDot, type Confidence } from "./confidence-dot";
import type { TechStackData, TechStackEntry, PlatformField } from "@/lib/api";

function capitalizeWord(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Build the readable "Platform" rows from the detected profile (patch-31). Only
// fields actually detected appear. Changelog values may be "rss:<url>". Confidence
// rides along so a low/medium detection draws a dot (high → nothing).
function buildPlatformRows(
  pp: TechStackData["platformProfile"],
): Array<{ label: string; value: string; confidence: Confidence }> {
  if (!pp) return [];
  const rows: Array<{ label: string; value: string; confidence: Confidence }> = [];
  const add = (label: string, f: PlatformField | undefined, fmt?: (v: string) => string) => {
    if (f?.value)
      rows.push({
        label,
        value: fmt ? fmt(f.value) : capitalizeWord(f.value),
        confidence: f.confidence,
      });
  };
  add("Framework", pp.framework);
  add("CMS", pp.cms);
  add("Hiring (ATS)", pp.ats);
  add("Pricing", pp.pricingWidget);
  add("Status page", pp.statusPage);
  add("Changelog", pp.changelog, (v) => (v.startsWith("rss:") ? "RSS feed" : capitalizeWord(v)));
  return rows;
}

// Inline cadence + next-scan line (patch-18 monthly scan, not a monitor). The
// exact last-scan date stays in the FreshnessDot tooltip; this answers the user's
// "when does it scan?" directly. Pending → an ETA, not a bare "scheduled".
function scanCadenceLabel(lastScrapedAt: string | null, nextScanAt: string | null): string {
  if (!lastScrapedAt) return "First scan within a day";
  if (!nextScanAt) return "Scanned monthly";
  const ts = new Date(nextScanAt).getTime();
  if (Number.isNaN(ts)) return "Scanned monthly";
  return ts > Date.now()
    ? `Monthly · next scan ${formatDistanceToNow(ts, { addSuffix: true })}`
    : "Monthly · next scan due";
}

// English labels for the catalog categories (patch-18). Strategic/commercial
// categories first, generic infra last.
const CATEGORY_LABELS: Record<string, string> = {
  payments: "Payments",
  crm_integration: "CRM & integrations",
  analytics: "Analytics",
  communication: "Live chat & messaging",
  support: "Support",
  auth: "Authentication",
  marketing: "Marketing",
  email: "Email",
  monitoring: "Monitoring",
  frontend: "Frontend",
  hosting: "Hosting",
  cdn: "CDN",
};

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

// A tech first seen within this many days is flagged "new" on the chip.
const RECENT_DAYS = 30;

function isRecent(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < RECENT_DAYS * 86_400_000;
}

function categoryRank(cat: string): number {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

// Detected tech stack section on the competitor profile (patch-18). Grouped by
// category, with a freshness dot reflecting the monthly scan cadence and a
// "new" marker on recently-appeared tools.
export function CompetitorTechStack({ techStack }: { techStack: TechStackData }) {
  const { entries, lastScrapedAt, nextScanAt } = techStack;

  const groups = new Map<string, TechStackEntry[]>();
  for (const e of entries) {
    const arr = groups.get(e.category) ?? [];
    arr.push(e);
    groups.set(e.category, arr);
  }
  const orderedCategories = [...groups.keys()].sort(
    (a, b) => categoryRank(a) - categoryRank(b),
  );

  const platformRows = buildPlatformRows(techStack.platformProfile);

  return (
    <TabCard>
      {platformRows.length > 0 && (
        <TabSection title="Platform" icon={Layers}>
          <div className="space-y-2 text-dense">
            {platformRows.map((r) => (
              <div key={r.label} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-muted-foreground">{r.label}</span>
                <span className="inline-flex items-center gap-1.5 font-medium">
                  {r.value}
                  <ConfidenceDot confidence={r.confidence} context={`· ${r.label} detection`} />
                </span>
              </div>
            ))}
          </div>
        </TabSection>
      )}

      <TabSection
        title="Detected tech stack"
        icon={Cpu}
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {lastScrapedAt && (
              <FreshnessDot
                lastScrapedAt={lastScrapedAt}
                status="success"
                nextRunAt={nextScanAt}
              />
            )}
            <span>{scanCadenceLabel(lastScrapedAt, nextScanAt)}</span>
          </span>
        }
      >
        {entries.length === 0 ? (
          <p className="text-dense text-muted-foreground">
            {lastScrapedAt
              ? "No recognizable third-party tech detected yet."
              : "Tech stack is scanned monthly — the first scan runs within a day, then results appear here."}
          </p>
        ) : (
          <div className="space-y-3">
            {orderedCategories.map((cat) => (
              <div key={cat}>
                <div className="text-xs font-medium capitalize text-muted-foreground mb-1.5">
                  {CATEGORY_LABELS[cat] ?? cat}
                </div>
                <ul className="flex flex-wrap gap-1.5">
                  {(groups.get(cat) ?? []).map((e) => (
                    <li
                      key={e.techId}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-dense"
                    >
                      <Check size={12} className="text-positive shrink-0" />
                      <span>{e.name}</span>
                      {isRecent(e.firstDetectedAt) && (
                        <span className="text-meta text-muted-foreground">
                          new · {formatDistanceToNow(new Date(e.firstDetectedAt), { addSuffix: true })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </TabSection>
    </TabCard>
  );
}
