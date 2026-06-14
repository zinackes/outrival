import {
  Activity,
  ArrowRight,
  Briefcase,
  Cpu,
  FileText,
  GitBranch,
  Globe,
  MessageCircle,
  Newspaper,
  Rss,
  Star,
  Tag,
  type LucideIcon,
} from "lucide-react";

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
    <div className="flex items-center gap-3 border-b border-border py-2.5 text-sm last:border-b-0">
      <span className="text-text-subtle">{icon}</span>
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-right font-mono text-xs text-text-subtle">
        {meta}
      </span>
    </div>
  );
}

function CardHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold">{title}</h3>
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
        <div className="max-w-3xl">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Everything a competitor publishes.
          </h2>
          <p className="mt-4 max-w-2xl text-text-muted leading-relaxed">
            Every public surface a competitor has, grouped into families. Each
            one is scraped by a stealth browser that escalates through a
            datacenter-to-residential proxy cascade only when a site blocks us,
            the snapshot is stored on R2, and the content is diffed against the
            previous state.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className={`${cardClass} lg:col-span-7`}>
            <CardHeader
              title="The public product"
              desc="Everything your competitor shows their own prospects. The densest layer — typically the bulk of all surfaced signals."
            />
            <div className="border-t border-border">
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
              <Row
                icon={RowIcon(Activity)}
                label="Status page"
                meta="incidents · uptime"
              />
            </div>
          </div>

          <div className={`${cardClass} lg:col-span-5`}>
            <CardHeader
              title="The users"
              desc="What your competitor's actual customers say across review sites — score, volume, sentiment and sub-ratings, not just the star."
            />
            <div className="border-t border-border">
              <Row
                icon={RowIcon(Star)}
                label="G2 · Capterra"
                meta="score · volume · sentiment"
              />
              <Row
                icon={RowIcon(Star)}
                label="Trustpilot · TrustRadius · Gartner"
                meta="verified reviews"
              />
              <Row
                icon={RowIcon(Star)}
                label="App Store · Play Store"
                meta="rating · changelog"
              />
              <Row
                icon={RowIcon(MessageCircle)}
                label="Reddit"
                meta="mentions · sentiment"
              />
            </div>
          </div>

          <div className={`${cardClass} lg:col-span-5`}>
            <CardHeader
              title="Hiring & momentum"
              desc="The earliest indicators of strategic moves — often weeks before the product announcement."
            />
            <div className="border-t border-border">
              <Row
                icon={RowIcon(Briefcase)}
                label="Job postings"
                meta="roles · departments · locations"
              />
              <Row
                icon={RowIcon(Cpu)}
                label="Tech stack"
                meta="payments · analytics · CRM"
              />
              <Row
                icon={RowIcon(Newspaper)}
                label="News"
                meta="funding · M&A · leadership"
              />
            </div>
          </div>

          <div className={`${cardClass} bg-background-2 lg:col-span-7`}>
            <div className="flex flex-col gap-3">
              <span className="inline-flex w-fit rounded-md border border-border px-2 py-0.5 font-mono text-meta text-text-subtle">
                Every plan
              </span>
              <CardHeader
                title="Your own product, side by side"
                desc="Point the same pipeline at your live site, your pricing, even a GitHub repo while you're still building. Your changes get classified too, so the digest reads your moves against theirs."
              />
            </div>
            <div className="mt-2 border-t border-border">
              <Row
                icon={RowIcon(Globe)}
                label="Your live site & pricing"
                meta="profile · positioning"
              />
              <Row
                icon={RowIcon(GitBranch)}
                label="Your repo (pre-launch)"
                meta="releases · commits"
              />
            </div>
            <div className="mt-auto border-t border-border pt-4">
              <a
                href="#cta"
                className="inline-flex items-center gap-1.5 font-mono text-dense text-primary transition-colors hover:text-accent-bright"
              >
                Add your product free <ArrowRight size={12} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
