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
    a: "A fast Llama 3.3 70B classifier runs on every diff and tags category, severity, and a 'significant' boolean. Only significant changes go on to a frontier LLM for insight generation. On average we surface 1 signal for every 70 changes scanned.",
  },
  {
    q: "Where is the data stored?",
    a: "All in the EU. Application server on OVH (France), PostgreSQL on Neon (EU), HTML snapshots and screenshots on Cloudflare R2 — your stored data never leaves the EU.",
  },
  {
    q: "Can I track my own product too?",
    a: "Yes, on every plan. Point Outrival at your live site and pricing — or a GitHub repo while you're still building — and your own changes run through the same classification pipeline, so the digest reads your moves alongside your competitors'.",
  },
  {
    q: "How often is a competitor scanned?",
    a: "Defaults: homepage and pricing daily, blog and changelog weekly, jobs daily, reviews weekly. Your plan sets the floor — weekly on Free, daily on Starter, real-time on Pro and up — and stable monitors automatically slow down to save scrapes.",
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
                href="mailto:hello@outrival.app"
                className="text-primary hover:underline"
              >
                hello@outrival.app
              </a>
              .
            </p>
          </div>
          <Accordion
            type="single"
            collapsible
            className="border-t border-border-strong"
          >
            {FAQS.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`}>
                <AccordionTrigger className="text-base hover:no-underline">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="leading-relaxed text-text-muted">
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
