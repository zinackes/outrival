export function Quote() {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-10 rounded-2xl border border-border bg-surface p-8 sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <div className="font-mono text-xs text-text-subtle">
              Case · Series A B2B SaaS
            </div>
            <div className="mt-4 text-2xl font-medium leading-snug sm:text-3xl">
              We replaced a <b>2h Monday slot</b> with{" "}
              <b>10 minutes of reading</b>. And we heard about Linear&apos;s
              repricing <b>before our own sales team</b>.
            </div>
            <div className="mt-6">
              <div className="font-semibold">Head of Product</div>
              <div className="text-sm text-text-subtle">
                B2B SaaS · Paris · 18 people · 14 competitors monitored
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 lg:grid-cols-1 lg:gap-6">
            <div>
              <div className="text-3xl font-semibold">
                8h<span className="text-lg text-text-subtle">/wk</span>
              </div>
              <div className="mt-1 text-xs text-text-muted">
                manual research replaced
              </div>
            </div>
            <div>
              <div className="text-3xl font-semibold">
                3<span className="text-lg text-text-subtle">d</span>
              </div>
              <div className="mt-1 text-xs text-text-muted">
                ahead of sales on a competitor repricing
              </div>
            </div>
            <div>
              <div className="text-3xl font-semibold">€0</div>
              <div className="mt-1 text-xs text-text-muted">
                external CI tooling
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 text-center text-xs text-text-subtle">
          Anonymized at the customer&apos;s request · NDA in progress ·
          identifiable company and verifiable figures available under NDA —{" "}
          <a
            href="mailto:hello@outrival.io"
            className="text-primary hover:underline"
          >
            hello@outrival.io
          </a>
        </div>
      </div>
    </section>
  );
}
