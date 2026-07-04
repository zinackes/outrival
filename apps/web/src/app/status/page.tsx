import type { Metadata } from "next";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: "System Status",
  description: "Current operational status of Outrival.",
  alternates: { canonical: "/status" },
};

const SYSTEMS = [
  { name: "Dashboard & API", state: "Monitored" },
  { name: "Scraping pipeline", state: "Monitored" },
  { name: "AI insights", state: "Monitored" },
  { name: "Email & Slack delivery", state: "Monitored" },
];

export default function StatusPage() {
  return (
    <DocPage
      title="System status"
      intro="The core systems behind Outrival. Incidents and scheduled maintenance are posted here — this page is informational, not a live health feed."
    >
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {SYSTEMS.map((s) => (
          <li
            key={s.name}
            className="flex items-center justify-between gap-3 px-4 py-3"
          >
            <span className="text-sm text-foreground">{s.name}</span>
            <span className="text-xs text-text-subtle">
              {s.state}
            </span>
          </li>
        ))}
      </ul>
    </DocPage>
  );
}
