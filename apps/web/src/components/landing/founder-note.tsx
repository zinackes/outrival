// A quiet, first-person letter from the founder — no card, no photo, just the
// serif signature carrying the personal register on paper. Sits at the top of
// the light return, right after the dark body.
export function FounderNote() {
  return (
    <div className="lp-founder">
      <p className="founder-eyebrow">From the founder</p>
      <figure>
        <blockquote>
          I built Outrival because I was tired of competitive-intelligence tools
          that cost more than a salary, hid their price behind a sales call, and
          shipped dashboards nobody read. It&rsquo;s one person in France,
          funded by the people who use it, which is exactly why the price is
          public, the product is self-serve, and I answer the support email
          myself. If that&rsquo;s the tool you always wanted, you&rsquo;re in
          the right place.
        </blockquote>
        <figcaption>
          <div>
            <div className="sig">Mathys</div>
            <div className="role">Founder, Outrival · France</div>
          </div>
          <a className="more" href="/about">
            Read more →
          </a>
        </figcaption>
      </figure>
    </div>
  );
}
