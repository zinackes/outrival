import { FaqJsonLd } from "./structured-data";

// FAQ block for the comparison / alternatives / pricing pages: the visible
// accordion and its FAQPage JSON-LD from one source, so the rich-result markup
// can't drift from the rendered questions.
//
// It renders the landing's own FAQ markup (.lp-faq / native <details>) rather
// than the shadcn Accordion it used to: same editorial hairlines, same +/−
// affordance, and no client JS on a page that otherwise needs none. The first
// question ships open — a closed list of seven reads as a wall.
export function CompareFaq({
  heading = (
    <>
      The questions we get <span className="lp-serif-accent">asked</span>.
    </>
  ),
  lead,
  faqs,
}: {
  heading?: React.ReactNode;
  lead?: React.ReactNode;
  faqs: { q: string; a: string }[];
}) {
  return (
    <div className="lp-faq">
      <FaqJsonLd faqs={faqs} />
      <div>
        <h2 className="lp-light-h2">{heading}</h2>
        <p className="lp-faq-lead">
          {lead ?? (
            <>
              Still deciding? Write to{" "}
              <a href="mailto:hello@outrival.app">hello@outrival.app</a> and the
              founder answers.
            </>
          )}
        </p>
      </div>
      <div className="lp-faq-list">
        {faqs.map((f, i) => (
          <details key={f.q} open={i === 0}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
