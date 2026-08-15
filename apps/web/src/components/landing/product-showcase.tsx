import { ProductBento } from "./product-bento";

// Dark-body opening: the bento proof ("this is the product") and the stats
// strip. The bento owns the product's surfaces — the screens you open — while
// the Pipeline section under it owns the mechanism. Neither repeats the other.
export function ProductShowcase() {
  return (
    <>
      <div className="lp-dark-inner lp-bento-wide" id="product">
        <div className="lp-dark-head">
          <h2>
            This is <span className="lp-serif-accent">the product</span>.
          </h2>
          <p>
            No mockups. Every competitor move lands in one place: scored,
            explained, ready to act on.
          </p>
        </div>

        <ProductBento />
      </div>

      <div className="lp-stats">
        <div className="lp-stats-grid">
          <div className="lp-stat">
            <b>12:1</b>
            <span>changes per signal that needs action</span>
          </div>
          <div className="lp-stat">
            <b>17</b>
            <span>source types</span>
          </div>
          <div className="lp-stat">
            <b>≤5 min</b>
            <span>critical alert latency</span>
          </div>
          <div className="lp-stat">
            <b>EU</b>
            <span>data storage</span>
          </div>
        </div>
        <p className="lp-stats-note">Measured on production, July 2026.</p>
      </div>
    </>
  );
}
