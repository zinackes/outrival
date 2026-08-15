import type { CSSProperties } from "react";

// Twelve categories on two counter-scrolling CSS marquees (decorative — the
// heading carries the information), four severities pinned static below. All
// colors come from the system --cat-* / severity tokens; the dark region
// resolves the dark set.
const CATS = [
  { label: "Pricing", c: "var(--cat-pricing)" },
  { label: "Product", c: "var(--cat-product)" },
  { label: "Hiring", c: "var(--cat-hiring)" },
  { label: "Reviews", c: "var(--cat-reviews)" },
  { label: "Content", c: "var(--cat-content)" },
  { label: "Funding", c: "var(--cat-funding)" },
  { label: "Partnerships", c: "var(--cat-partnerships)" },
  { label: "M&A", c: "var(--cat-ma)" },
  { label: "Leadership", c: "var(--cat-leadership)" },
  { label: "Security", c: "var(--cat-security-compliance)" },
  { label: "Ads", c: "var(--cat-ads)" },
  { label: "API", c: "var(--cat-api-developer)" },
];
// Second row starts half-way through the list so the two lanes never mirror.
const CATS_B = [...CATS.slice(6), ...CATS.slice(0, 6)];

const SEVERITIES = [
  { label: "Critical", c: "var(--critical)" },
  { label: "High", c: "var(--high)" },
  { label: "Medium", c: "var(--medium)" },
  { label: "Low", c: "var(--low)" },
];

function MarqueeRow({ cats, reverse = false }: { cats: typeof CATS; reverse?: boolean }) {
  return (
    <div className={reverse ? "lp-mq lp-mq-b" : "lp-mq"} aria-hidden>
      <div className="lp-mq-track">
        {[0, 1].map((h) => (
          <div key={h} className="lp-mq-half">
            {cats.map((cat) => (
              <span
                key={cat.label}
                className="lp-cat-chip"
                style={{ "--c": cat.c } as CSSProperties}
              >
                {cat.label}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Categories() {
  return (
    <div className="lp-dark-inner lp-cats" id="signals">
      <div className="lp-dark-head lp-cats-head">
        <h2>
          Twelve categories. Four <span className="lp-serif-accent">severities</span>.
        </h2>
        <p>
          Every signal carries both. You filter on what matters: pricing for the
          CFO, hiring for talent, reviews for product.
        </p>
      </div>
      <MarqueeRow cats={CATS} />
      <MarqueeRow cats={CATS_B} reverse />
      <div className="lp-sev-fixed">
        {SEVERITIES.map((sev) => (
          <span key={sev.label} className="s">
            <span className="lp-sev-dot" style={{ background: sev.c }} />
            {sev.label}
          </span>
        ))}
      </div>
    </div>
  );
}
