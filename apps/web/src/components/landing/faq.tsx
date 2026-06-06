import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

type Faq = { q: string; a: string };

const FAQS: Faq[] = [
  {
    q: "How do you monitor sites with anti-bot protection?",
    a: "A stealth browser handles the majority of sources directly. For protected sites it escalates through a datacenter-to-residential proxy cascade, only paying for the heavier path when a site actually blocks us. No source needs manual setup on your side.",
  },
  {
    q: "What qualifies a change as a signal?",
    a: "A Llama 3.3 70B classifier on Groq runs on every diff and tags category, severity, and a 'significant' boolean. Only significant changes go to Claude for insight generation. On average we surface 1 signal for every 70 changes scanned.",
  },
  {
    q: "Where is the data stored?",
    a: "All in the EU. Application server on Hetzner (Germany), PostgreSQL on Neon (EU), HTML snapshots and screenshots on Cloudflare R2. Nothing transits outside the EU.",
  },
  {
    q: "Can I connect my own source?",
    a: "Yes — on the Business plan. Internal APIs, an intranet, a shared Notion. The format goes through our custom-scraper interface and benefits from the same classification and insight pipeline.",
  },
  {
    q: "How often is a competitor scanned?",
    a: "Configurable per source. Defaults: homepage and pricing every 6h, blog and changelog every 12h, jobs daily, reviews weekly. The concurrency key is per hostname to avoid IP bans.",
  },
  {
    q: "How do I cancel?",
    a: "One click from your dashboard — no sales call. No penalty, no forced annual commitment. You keep access until the end of your current billing cycle.",
  },
];

export function FAQ() {
  return (
    <section className="py-20 sm:py-28" id="faq">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              The questions we get asked.
            </h2>
            <p className="mt-4 text-text-muted leading-relaxed">
              For anything else, write to{" "}
              <a
                href="mailto:hello@outrival.io"
                className="text-primary hover:underline"
              >
                hello@outrival.io
              </a>
              .
            </p>
          </div>
          <Accordion
            type="single"
            collapsible
            className="rounded-md border border-border bg-card text-card-foreground"
          >
          {FAQS.map((f, i) => (
            <AccordionItem
              key={i}
              value={`item-${i}`}
              className="px-5 last:border-b-0"
            >
              <AccordionTrigger className="text-base hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
}
