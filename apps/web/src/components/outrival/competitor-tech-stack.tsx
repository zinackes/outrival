"use client";

import { formatDistanceToNow } from "date-fns";
import { Check, Cpu } from "lucide-react";
import { Card } from "@/components/ui/card";
import { FreshnessDot } from "./freshness-dot";
import type { TechStackData, TechStackEntry } from "@/lib/api";

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
  const { entries, lastScrapedAt } = techStack;

  const groups = new Map<string, TechStackEntry[]>();
  for (const e of entries) {
    const arr = groups.get(e.category) ?? [];
    arr.push(e);
    groups.set(e.category, arr);
  }
  const orderedCategories = [...groups.keys()].sort(
    (a, b) => categoryRank(a) - categoryRank(b),
  );

  return (
    <Card className="px-4 py-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase flex items-center gap-1.5">
          <Cpu size={11} /> Detected tech stack
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground/80">
          {lastScrapedAt && <FreshnessDot lastScrapedAt={lastScrapedAt} status="success" />}
          <span>
            {lastScrapedAt
              ? `scanned ${formatDistanceToNow(new Date(lastScrapedAt), { addSuffix: true })}`
              : "scan pending"}
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {lastScrapedAt
            ? "No recognizable third-party tech detected yet."
            : "Tech stack scan scheduled — results appear after the first scan."}
        </p>
      ) : (
        <div className="space-y-3">
          {orderedCategories.map((cat) => (
            <div key={cat}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mb-1.5">
                {CATEGORY_LABELS[cat] ?? cat}
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {(groups.get(cat) ?? []).map((e) => (
                  <li
                    key={e.techId}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-[12px]"
                  >
                    <Check size={11} className="text-positive shrink-0" />
                    <span>{e.name}</span>
                    {isRecent(e.firstDetectedAt) && (
                      <span className="text-[10px] text-muted-foreground">
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
    </Card>
  );
}
