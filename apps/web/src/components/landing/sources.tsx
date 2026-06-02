import {
  ArrowRight,
  Briefcase,
  FileText,
  Globe,
  Rss,
  Star,
  Tag,
  type LucideIcon,
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

function Row({
  icon,
  label,
  meta,
}: {
  icon: React.ReactNode;
  label: string;
  meta: string;
}) {
  return (
    <div className="flex items-center gap-3 bg-background-2/40 px-3.5 py-2.5 text-sm">
      <span className="text-text-subtle">{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-right font-mono text-xs text-text-subtle">
        {meta}
      </span>
    </div>
  );
}

function CardHeader({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string;
  title: string;
  desc: string;
}) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-wider text-primary">
        {eyebrow}
      </div>
      <h3 className="mt-2.5 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-text-muted">{desc}</p>
    </div>
  );
}

const cardClass =
  "flex flex-col gap-5 rounded-xl border border-border bg-surface p-6";

export function Sources() {
  const RowIcon = (Icon: LucideIcon) => <Icon size={14} />;
  return (
    <section className="py-20 sm:py-28" id="sources">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Everything a competitor
            <br />
            publishes.
          </h2>
          <p className="text-text-muted leading-relaxed">
            Ten sources monitored by default, grouped into three families. Each
            one is scraped by a stealth browser that escalates through a
            datacenter-to-residential proxy cascade only when a site blocks us,
            the snapshot is stored on R2, and the content is diffed against the
            previous state.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className={`${cardClass} lg:col-span-7`}>
            <CardHeader
              eyebrow="Family 1"
              title="The public product"
              desc="Everything your competitor shows their own prospects. The densest layer — typically 70% of all surfaced signals."
            />
            <div className="space-y-px overflow-hidden rounded-lg border border-border">
              <Row
                icon={RowIcon(Globe)}
                label="Homepage"
                meta="headline · positioning · CTA"
              />
              <Row
                icon={RowIcon(Tag)}
                label="Pricing page"
                meta="plans · prices · billing"
              />
              <Row icon={RowIcon(Rss)} label="Blog" meta="editorial posts" />
              <Row
                icon={RowIcon(FileText)}
                label="Changelog"
                meta="releases · product updates"
              />
            </div>
          </div>

          <div className={`${cardClass} lg:col-span-5`}>
            <CardHeader
              eyebrow="Family 2"
              title="The users"
              desc="What your competitor's actual customers say. Score, volume, sentiment — not just the star rating."
            />
            <div className="space-y-px overflow-hidden rounded-lg border border-border">
              <Row
                icon={RowIcon(Star)}
                label="G2"
                meta="score · volume · sentiment"
              />
              <Row
                icon={RowIcon(Star)}
                label="Capterra"
                meta="verified reviews"
              />
              <Row
                icon={RowIcon(Star)}
                label="App Store · Play Store"
                meta="rating · changelog"
              />
            </div>
          </div>

          <div className={`${cardClass} lg:col-span-5`}>
            <CardHeader
              eyebrow="Family 3"
              title="The humans behind it"
              desc="Hires, official posts, announcements. The earliest indicator of strategic moves — often weeks before the product announcement."
            />
            <div className="space-y-px overflow-hidden rounded-lg border border-border">
              <Row
                icon={RowIcon(Briefcase)}
                label="Job postings"
                meta="roles · departments · locations"
              />
              <Row
                icon={<LinkedinGlyph size={14} />}
                label="LinkedIn corporate"
                meta="posts · headcount"
              />
              <Row
                icon={<TwitterGlyph size={14} />}
                label="Twitter / X"
                meta="announcements · launches"
              />
            </div>
          </div>

          <div className={`${cardClass} bg-background-2 lg:col-span-7`}>
            <CardHeader
              eyebrow="Business plan"
              title="Your own sources"
              desc="Internal APIs, an intranet, a partner's shared Notion, custom Selenium scrapers. We accept anything that returns HTML or JSON. The classification pipeline stays the same."
            />
            <div className="mt-auto border-t border-border pt-4">
              <a
                href="#cta"
                className="inline-flex items-center gap-1.5 font-mono text-[13px] text-primary transition-colors hover:text-accent-bright"
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
