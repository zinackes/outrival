export function Trust() {
  return (
    <section className="border-y border-border bg-background-2 py-16">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="text-xl font-medium leading-snug sm:text-2xl">
            Monday morning, you read <b>the handful that matter</b> instead of
            scrolling through <b>everything that moved</b>. The triage is the
            AI&apos;s job, not yours.
          </p>
        </div>
        <div>
        <dl className="grid grid-cols-2 gap-x-10 gap-y-7">
          <div>
            <dt className="text-2xl font-medium tracking-tight tabular-nums">
              12:1
            </dt>
            <dd className="mt-1.5 text-xs text-text-muted">
              changes per signal that needs action
            </dd>
          </div>
          <div>
            <dt className="text-2xl font-medium tracking-tight tabular-nums">
              17
            </dt>
            <dd className="mt-1.5 text-xs text-text-muted">
              source types tracked
            </dd>
          </div>
          <div>
            <dt className="text-2xl font-medium tracking-tight tabular-nums">
              ≤5<span className="text-base text-text-subtle">min</span>
            </dt>
            <dd className="mt-1.5 text-xs text-text-muted">
              critical alert latency
            </dd>
          </div>
          <div>
            <dt className="text-2xl font-medium tracking-tight">EU</dt>
            <dd className="mt-1.5 text-xs text-text-muted">
              <a
                href="/security"
                className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                data storage
              </a>
            </dd>
          </div>
        </dl>
          {/* Every figure above is measured, so it is dated rather than
              disclaimed. "EU data storage" is /security's exact wording: AI
              inference still runs through non-EU providers, so "EU-hosted"
              would overclaim. Re-measure before changing any number. */}
          <p className="mt-5 text-xs text-text-subtle">
            Measured on production, July 2026.
          </p>
        </div>
      </div>
      <div className="mx-auto mt-12 w-full max-w-6xl border-t border-border px-6 pt-8">
        <p className="text-center text-sm text-text-muted">
          Point Outrival at any public SaaS, set up in minutes
        </p>
      </div>
    </section>
  );
}
