import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";

// A quiet, first-person note from the founder, placed just before the final CTA.
// No photo, no illustrated avatar — a clean serif signature (the landing's brand
// register, --font-display = Zodiak) carries the personal register on its own.
export function FounderNote() {
  return (
    <section className="pt-16 sm:pt-24" id="founder-note" data-reveal>
      <div className="mx-auto w-full max-w-3xl px-6">
        <figure className="rounded-2xl border border-border bg-surface p-8 sm:p-10">
          <blockquote className="text-lg leading-relaxed text-text-muted sm:text-xl">
            I built Outrival because I was tired of competitive-intelligence
            tools that cost more than a salary, hid their price behind a sales
            call, and shipped dashboards nobody read. It&apos;s one person in
            France, funded by the people who use it, which is exactly why the
            price is public, the product is self-serve, and I answer the support
            email myself. If that&apos;s the tool you always wanted, you&apos;re
            in the right place.
          </blockquote>
          <figcaption className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="font-[var(--font-display)] text-xl text-foreground">
                Mathys
              </div>
              <div className="mt-1 text-sm text-text-subtle">
                Founder, Outrival · France
              </div>
            </div>
            <Link
              href="/about"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Read more <ArrowRightIcon size={16} />
            </Link>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
