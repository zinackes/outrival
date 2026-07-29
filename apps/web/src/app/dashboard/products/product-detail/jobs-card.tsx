"use client";

import { BriefcaseIcon, ArrowSquareOutIcon } from "@/components/icons";
import type { MyProductJob } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

/** Active job postings detected on the self product's site. Read-only: the page
 *  monitors the `jobs` source (and surfaces hiring changes for review), so the
 *  current openings belong here too. */
export function JobsCard({ jobs }: { jobs: { total: number; items: MyProductJob[] } }) {
  return (
    <Card className="bg-gradient-card-strong p-4">
      <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        <span className="inline-flex items-center gap-1.5">
          <BriefcaseIcon className="size-3.5" />
          Hiring{jobs.total > 0 ? ` (${jobs.total})` : ""}
        </span>
      </h3>
      <Separator className="mb-2" />
      {jobs.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open roles detected on your site yet.</p>
      ) : (
        <ul className="divide-y divide-border max-h-80 overflow-y-auto pr-2">
          {jobs.items.map((job) => (
            <li key={job.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{job.title}</p>
                {(job.department || job.location) && (
                  <p className="truncate text-dense text-muted-foreground">
                    {[job.department, job.location].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              {job.url && (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-dense font-medium text-link no-underline hover:underline"
                >
                  View
                  <ArrowSquareOutIcon className="size-3.5" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
