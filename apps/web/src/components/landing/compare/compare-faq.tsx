import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FaqJsonLd } from "./structured-data";

// FAQ block for the comparison / alternatives pages: the visible accordion and
// its FAQPage JSON-LD from one source, so the rich-result markup can't drift
// from the rendered questions.
export function CompareFaq({
  heading = "Common questions",
  faqs,
}: {
  heading?: string;
  faqs: { q: string; a: string }[];
}) {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
      <FaqJsonLd faqs={faqs} />
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[1fr_1.6fr]">
        <div>
          <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {heading}
          </h2>
          <p className="mt-4 leading-relaxed text-text-muted">
            Still deciding? Email{" "}
            <a
              href="mailto:hello@outrival.app"
              className="text-primary hover:underline"
            >
              hello@outrival.app
            </a>{" "}
            and the founder answers.
          </p>
        </div>
        <Accordion
          type="single"
          collapsible
          className="border-t border-border-strong"
        >
          {faqs.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`}>
              <AccordionTrigger className="text-left text-base hover:no-underline">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="leading-relaxed text-text-muted">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
