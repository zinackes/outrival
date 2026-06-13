import type { Metadata } from "next";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: "System Status",
  description: "Current operational status of Outrival.",
  alternates: { canonical: "/status" },
};

const SYSTEMS = [
  { name: "Dashboard & API", state: "Operational" },
  { name: "Scraping pipeline", state: "Operational" },
  { name: "AI insights", state: "Operational" },
  { name: "Email & Slack delivery", state: "Operational" },
];

export default function StatusPage() {
  return (
    <DocPage
      title="System status"
      intro="All systems operational. Incidents and maintenance windows will be posted here."
    >
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {SYSTEMS.map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span className="text-sm text-foreground">{s.name}</span>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-text-subtle">
              <span className="size-1.5 rounded-full bg-positive" />
              {s.state}
            </span>
          </li>
        ))}
      </ul>
    </DocPage>
  );
}
