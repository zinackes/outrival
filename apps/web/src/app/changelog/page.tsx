import type { Metadata } from "next";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = {
  title: "Changelog",
  description: "What's new in Outrival.",
  alternates: { canonical: "/changelog" },
};

const ENTRIES = [
  {
    version: "v0.7.0",
    date: "June 2026",
    items: [
      "Staged extraction pipeline — structured-first parsing keeps AI on the cold path.",
      "Automatic platform detection routes each source to its structured connector.",
      "Expanded source coverage: more ATS connectors, multi-platform reviews, Reddit mentions.",
    ],
  },
  {
    version: "v0.6.0",
    date: "May 2026",
    items: [
      "Ask Outrival — query your competitive data in natural language.",
      "Multi-product workspaces for teams tracking several SKUs.",
      "Notification moderation: relevance threshold, quiet hours, batching.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <DocPage
      title="Changelog"
      intro="Notable changes to Outrival, newest first."
    >
      <div className="flex flex-col gap-8">
        {ENTRIES.map((e) => (
          <section key={e.version} className="flex flex-col gap-3">
            <div className="flex items-baseline gap-3">
              <h2 className="!mt-0 text-foreground">{e.version}</h2>
              <span className="font-mono text-xs text-text-subtle">{e.date}</span>
            </div>
            <ul className="flex flex-col gap-2">
              {e.items.map((it) => (
                <li key={it} className="flex gap-2 text-sm">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-text-subtle" />
                  <span>{it}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </DocPage>
  );
}
