import Link from "next/link";
import { ArrowRightIcon, CheckIcon, MinusIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { Breadcrumbs, CompareShell } from "./compare-shell";
import { CompareFaq } from "./compare-faq";
import { ProductProof } from "./product-proof";
import { DIY, LAST_REVIEWED, PRICE_AS_OF } from "./data";

// "Outrival vs doing it yourself." The ICP's real daily competitor: the free /
// near-free DIY stack. Reuses the /vs grammar (CompareShell, CompareFaq,
// ProductProof) but its own body — a head-to-head table, an honest breakdown of
// each DIY tool, the hidden costs, and a sincere steelman of when to skip us.

const ROW = "grid grid-cols-[1.2fr_1fr_1fr] sm:grid-cols-[1.4fr_1fr_1fr]";

function SectionHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
        {title}
      </h2>
      {lead && (
        <p className="mt-4 leading-relaxed text-text-muted text-pretty">{lead}</p>
      )}
    </div>
  );
}

export function DiyPage() {
  return (
    <CompareShell>
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div
            className="absolute left-1/2 top-0 h-[26rem] w-[52rem] max-w-[120vw] -translate-x-1/2 rounded-full opacity-50 blur-3xl"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--accent) 10%, transparent) 0%, transparent 65%)",
            }}
          />
        </div>
        <div className="mx-auto w-full max-w-6xl px-6 pb-12 pt-10 sm:pt-12">
          <Breadcrumbs
            items={[
              { name: "Home", path: "/" },
              { name: "Outrival vs doing it yourself", path: "/vs/diy" },
            ]}
          />
          <h1 className="mt-8 max-w-3xl text-[clamp(2.4rem,5vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-balance">
            Outrival vs doing it yourself
          </h1>
          <p className="mt-4 text-dense text-text-subtle">
            Last reviewed {LAST_REVIEWED} · compared on publicly available
            information
          </p>
          <div className="mt-7 max-w-2xl space-y-3.5 text-lead leading-relaxed text-text-muted text-pretty">
            {DIY.verdict.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/auth">Start free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/#pricing">See all plans</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Head-to-head */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <SectionHead
          title="The stack, side by side"
          lead="What the DIY stack does versus what Outrival does, on the jobs a buyer decides on."
        />
        <div className="mt-10 overflow-x-auto">
          <div className="min-w-[640px] border-t border-border-strong">
            <div
              className={`${ROW} border-b border-border text-xs font-medium text-text-subtle`}
            >
              <div className="px-4 py-3" />
              <div className="px-4 py-3">Doing it yourself</div>
              <div className="bg-primary/[0.04] px-4 py-3 text-primary">
                Outrival
              </div>
            </div>
            {DIY.table.map((r) => (
              <div
                key={r.label}
                className={`${ROW} border-b border-border text-sm last:border-b-0`}
              >
                <div className="px-4 py-3.5 text-text-muted">{r.label}</div>
                <div className="px-4 py-3.5 text-text-subtle">{r.diy}</div>
                <div className="bg-primary/[0.04] px-4 py-3.5 text-positive">
                  {r.outrival}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What the DIY stack actually is */}
      <section className="border-y border-border bg-background-2 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <SectionHead
            title="What the DIY stack actually is"
            lead="Three honest tools, each good at its job. Here's what each does well, where it breaks, and what it costs."
          />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {DIY.approaches.map((a) => (
              <div
                key={a.name}
                className="flex flex-col rounded-xl border border-border bg-surface p-6"
              >
                <div className="text-base font-semibold">{a.name}</div>
                <div className="mt-1 text-dense text-text-subtle">{a.role}</div>
                <p className="mt-4 flex gap-2.5 text-sm leading-relaxed text-text-muted">
                  <CheckIcon
                    size={15}
                    className="mt-0.5 shrink-0 text-positive"
                    aria-hidden
                  />
                  <span>{a.doesWell}</span>
                </p>
                <p className="mt-3 flex gap-2.5 text-sm leading-relaxed text-text-muted">
                  <MinusIcon
                    size={15}
                    className="mt-0.5 shrink-0 text-text-subtle"
                    aria-hidden
                  />
                  <span>{a.breaks}</span>
                </p>
                {"alternative" in a && a.alternative && (
                  <p className="mt-3 border-t border-border pt-3 text-dense leading-relaxed text-text-subtle">
                    {a.alternative}
                  </p>
                )}
                <div className="mt-auto pt-5 text-meta text-text-subtle">
                  {a.cost}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 text-dense text-text-subtle">
            Tool pricing is each vendor's public list price as of {PRICE_AS_OF}
            and can change.
          </p>
        </div>
      </section>

      {/* Hidden costs */}
      <section className="mx-auto w-full max-w-6xl px-6 py-16 sm:py-20">
        <SectionHead
          title="The hidden costs of rolling your own"
          lead="The cash cost of the DIY stack is low. The real bill is time and judgement: the work the tools hand back to you."
        />
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {DIY.hiddenCosts.map((h) => (
            <div
              key={h.title}
              className="rounded-xl border border-border bg-surface p-6"
            >
              <h3 className="font-medium text-foreground">{h.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-muted">
                {h.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Steelman: when DIY is the right call */}
      <section className="border-y border-border bg-background-2 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <SectionHead
            title="When doing it yourself is the right call"
            lead="We'd rather tell you than sell you. In these cases the free DIY tools are the honest answer. Don't buy a subscription you don't need yet."
          />
          <ul className="mt-10 grid gap-4 lg:grid-cols-3">
            {DIY.whenDiyWins.map((w) => (
              <li
                key={w.title}
                className="rounded-xl border border-border bg-surface p-6"
              >
                <h3 className="font-medium text-foreground">{w.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-text-muted">
                  {w.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Product proof */}
      <ProductProof lead="If your competitor set has outgrown the free tools, this is what replaces the stack: every move in one place, written up, ready to act on." />

      {/* FAQ */}
      <CompareFaq heading="Outrival vs DIY, answered" faqs={DIY.faqs} />

      {/* CTA + cross-links + sources */}
      <section className="border-t border-border bg-background-2 py-16 sm:py-20">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="rounded-2xl border border-border bg-surface p-8 sm:p-10">
            <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              Stop maintaining the stack. Read the brief instead.
            </h2>
            <p className="mt-4 max-w-xl leading-relaxed text-text-muted">
              Add two competitors on the free plan and get your first AI-written
              brief this week, with no selectors to maintain and no diffs to read.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/auth">Start free</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/#pricing">See all plans</Link>
              </Button>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link
              href="/alternatives/best-competitive-intelligence-tools"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Best competitive-intelligence tools
              <ArrowRightIcon size={13} aria-hidden />
            </Link>
            <Link
              href="/vs/crayon"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Outrival vs Crayon
              <ArrowRightIcon size={13} aria-hidden />
            </Link>
            <Link
              href="/vs/klue"
              className="inline-flex items-center gap-1.5 text-text-muted transition-colors hover:text-foreground"
            >
              Outrival vs Klue
              <ArrowRightIcon size={13} aria-hidden />
            </Link>
          </div>

          <div className="mt-10 border-t border-border pt-6 text-dense leading-relaxed text-text-subtle">
            <p>
              Comparison based on publicly available information as of{" "}
              {PRICE_AS_OF}. DIY-tool figures are each vendor's own published
              pricing and can change. Outrival is independent and not affiliated
              with the tools named; all trademarks belong to their respective
              owners.
            </p>
            <p className="mt-2">
              Sources:{" "}
              {DIY.sources.map((s, i) => (
                <span key={s.href}>
                  {i > 0 && " · "}
                  <a
                    href={s.href}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    {s.label}
                  </a>
                </span>
              ))}
              .
            </p>
            <p className="mt-2">
              Outrival offers EU data storage, see our{" "}
              <Link
                href="/security"
                className="underline-offset-2 hover:text-foreground hover:underline"
              >
                security overview
              </Link>{" "}
              for specifics.
            </p>
          </div>
        </div>
      </section>
    </CompareShell>
  );
}
