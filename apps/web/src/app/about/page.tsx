import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";
import { DocPage } from "@/components/landing/doc-page";

export const metadata: Metadata = pageMetadata({
  path: "/about",
  title: "About",
  description:
    "Why Outrival exists, who builds it, and the principles behind it — competitive intelligence written by AI, from a solo founder in Paris.",
  socialTitle: "About Outrival",
  socialDescription:
    "Why Outrival exists, who builds it, and the principles behind it — from a solo founder in Paris, self-funded and EU-hosted.",
  twitterDescription:
    "Competitive intelligence written by AI — from a solo founder in Paris, self-funded and EU-hosted.",
});

const PRINCIPLES = [
  {
    title: "Public pricing, always.",
    body: "Every plan and price is on the pricing page. You will never find a “contact us” where a number should be.",
  },
  {
    title: "Self-serve, end to end.",
    body: "Sign up, add competitors, get your first brief — no demo, no onboarding call, cancel in one click.",
  },
  {
    title: "EU-hosted, GDPR-first.",
    body: "Your data stays in Europe. Privacy is the default, not a settings page bolted on later.",
  },
  {
    title: "The AI writes the insight.",
    body: "You read the conclusion — what changed and why it matters. You don’t dig through diffs to find it.",
  },
  {
    // Deliberately not a cadence promise. Shipping really is continuous, but
    // the changelog is a curated release log, not a weekly obligation — and a
    // principle whose proof link can contradict it in one click is worth less
    // than no principle at all.
    title: "Ship constantly.",
    body: (
      <>
        Small, real improvements land all the time — the notable ones show up
        in the <a href="/changelog">changelog</a>.
      </>
    ),
  },
] as const;

export default function AboutPage() {
  return (
    <DocPage
      title="About Outrival"
      intro="Competitive intelligence that reads the noise so you don't have to. Here's why it exists, who's behind it, and what it will — and won't — do."
    >
      <div className="flex flex-col gap-10">
        <section className="flex flex-col gap-3">
          <h2 className="!mt-0 text-foreground">Why Outrival exists</h2>
          <p>
            Competitive intelligence has been stuck for a decade. The legacy
            tools cost $15,000 to $30,000 a year, make you sit through a sales
            demo before they&apos;ll even show you a price, then hand you a
            dashboard with hundreds of rows nobody on the team ever opens. I
            wanted the opposite: something that reads every competitor&apos;s
            public surface for me and tells me the handful of things that
            actually moved this week. Outrival is that tool.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="!mt-0 text-foreground">Who is building this</h2>
          <p>
            I&apos;m Mathys — one person, in Paris, building Outrival and
            funding it entirely from the people who pay for it. There are no
            investors to return capital to and no sales team to keep busy.
            That&apos;s not a story about hustle; it&apos;s structural. It&apos;s
            the reason a plan is €29 and not a quote, and the reason everything
            is self-serve instead of gated behind a call — there&apos;s simply no
            enterprise motion here to protect. The full legal entity details
            live in the <a href="/legal-notice">legal notice</a>.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="!mt-0 text-foreground">Principles</h2>
          <ul className="flex flex-col gap-3">
            {PRINCIPLES.map((p) => (
              <li key={p.title} className="flex gap-3">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-primary" />
                <span>
                  <strong className="font-medium text-foreground">
                    {p.title}
                  </strong>{" "}
                  {p.body}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="!mt-0 text-foreground">Get in touch</h2>
          <p>
            Have a question, an idea, or found something broken? Email me at{" "}
            <a href="mailto:hello@outrival.app">hello@outrival.app</a>. It comes
            straight to me, and I&apos;m the one who answers.
          </p>
          <p className="mt-2 font-[var(--font-display)] text-lg text-foreground">
            — Mathys
          </p>
        </section>
      </div>
    </DocPage>
  );
}
