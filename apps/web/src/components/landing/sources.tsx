import {
  ArrowRight,
  Briefcase,
  FileText,
  Globe,
  Rss,
  Star,
  Tag,
} from "lucide-react";

function LinkedinGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h4v4H4z" />
      <path d="M4 10h4v10H4z" />
      <path d="M10 10h4v2c.7-1.4 2-2.2 4-2.2 3 0 4 2 4 5V20h-4v-4.5c0-1.4-.5-2.5-2-2.5s-2 1.1-2 2.5V20h-4z" />
    </svg>
  );
}

function TwitterGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4h4l5 7 4-7h4l-7 11 7 9h-4l-5-7-4 7H4l7-11z" />
    </svg>
  );
}

export function Sources() {
  return (
    <section className="section" id="sources">
      <div className="wrap">
        <div className="head-A">
          <div>
            <h2>
              Everything a competitor
              <br />
              publishes.
            </h2>
          </div>
          <p className="lede">
            Ten sources monitored by default, grouped into three families. Each
            one is scraped by Crawlee with a ScrapingBee fallback for
            anti-bot-protected sites, the snapshot is stored on R2, and the
            content is diffed against the previous state.
          </p>
        </div>
        <div className="bento">
          <div className="bento-card span-7">
            <div>
              <div className="bento-eyebrow">Family 1</div>
              <div className="bento-title" style={{ marginTop: 10 }}>
                The public product
              </div>
              <p className="bento-desc" style={{ marginTop: 8 }}>
                Everything your competitor shows their own prospects. The
                densest layer — typically 70% of all surfaced signals.
              </p>
            </div>
            <div className="bento-items">
              <div className="bento-row">
                <Globe size={14} />
                <span className="bento-row-label">Homepage</span>
                <span className="bento-row-meta">
                  headline · positioning · CTA
                </span>
              </div>
              <div className="bento-row">
                <Tag size={14} />
                <span className="bento-row-label">Pricing page</span>
                <span className="bento-row-meta">plans · prices · billing</span>
              </div>
              <div className="bento-row">
                <Rss size={14} />
                <span className="bento-row-label">Blog</span>
                <span className="bento-row-meta">editorial posts</span>
              </div>
              <div className="bento-row">
                <FileText size={14} />
                <span className="bento-row-label">Changelog</span>
                <span className="bento-row-meta">
                  releases · product updates
                </span>
              </div>
            </div>
          </div>

          <div className="bento-card span-5">
            <div>
              <div className="bento-eyebrow">Family 2</div>
              <div className="bento-title" style={{ marginTop: 10 }}>
                The users
              </div>
              <p className="bento-desc" style={{ marginTop: 8 }}>
                What your competitor&apos;s actual customers say. Score, volume,
                sentiment — not just the star rating.
              </p>
            </div>
            <div className="bento-items">
              <div className="bento-row">
                <Star size={14} />
                <span className="bento-row-label">G2</span>
                <span className="bento-row-meta">
                  score · volume · sentiment
                </span>
              </div>
              <div className="bento-row">
                <Star size={14} />
                <span className="bento-row-label">Capterra</span>
                <span className="bento-row-meta">verified reviews</span>
              </div>
              <div className="bento-row">
                <Star size={14} />
                <span className="bento-row-label">
                  App Store · Play Store
                </span>
                <span className="bento-row-meta">rating · changelog</span>
              </div>
            </div>
          </div>

          <div className="bento-card span-5">
            <div>
              <div className="bento-eyebrow">Family 3</div>
              <div className="bento-title" style={{ marginTop: 10 }}>
                The humans behind it
              </div>
              <p className="bento-desc" style={{ marginTop: 8 }}>
                Hires, official posts, announcements. The earliest indicator of
                strategic moves — often weeks before the product announcement.
              </p>
            </div>
            <div className="bento-items">
              <div className="bento-row">
                <Briefcase size={14} />
                <span className="bento-row-label">Job postings</span>
                <span className="bento-row-meta">
                  roles · departments · locations
                </span>
              </div>
              <div className="bento-row">
                <LinkedinGlyph size={14} />
                <span className="bento-row-label">LinkedIn corporate</span>
                <span className="bento-row-meta">posts · headcount</span>
              </div>
              <div className="bento-row">
                <TwitterGlyph size={14} />
                <span className="bento-row-label">Twitter / X</span>
                <span className="bento-row-meta">announcements · launches</span>
              </div>
            </div>
          </div>

          <div
            className="bento-card span-7"
            style={{ background: "var(--background-2)" }}
          >
            <div>
              <div className="bento-eyebrow">Business plan</div>
              <div className="bento-title" style={{ marginTop: 10 }}>
                Your own sources
              </div>
              <p className="bento-desc" style={{ marginTop: 8 }}>
                Internal APIs, an intranet, a partner&apos;s shared Notion,
                custom Selenium scrapers. We accept anything that returns HTML
                or JSON. The classification pipeline stays the same.
              </p>
            </div>
            <div
              style={{
                marginTop: "auto",
                paddingTop: 16,
                borderTop: "1px solid var(--border)",
              }}
            >
              <a
                href="#cta"
                style={{
                  color: "var(--accent)",
                  fontSize: 13,
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--font-mono)",
                }}
              >
                Talk about a custom source <ArrowRight size={12} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
