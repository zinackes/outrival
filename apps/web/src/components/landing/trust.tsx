export function Trust() {
  return (
    <section className="border-y border-border bg-background-2 py-16">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <p className="text-xl font-medium leading-snug sm:text-2xl">
            Monday morning, you read <b>12 signals that matter</b> instead of
            scrolling through <b>847 changes</b>. The triage is the AI&apos;s
            job — not yours.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-10 gap-y-7">
          <div>
            <dt className="text-2xl font-medium tracking-tight tabular-nums">
              70:1
            </dt>
            <dd className="mt-1.5 text-xs text-text-muted">noise to signal</dd>
          </div>
          <div>
            <dt className="text-2xl font-medium tracking-tight tabular-nums">
              15<span className="text-base text-text-subtle">+</span>
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
            <dt className="text-2xl font-medium tracking-tight tabular-nums">
              100<span className="text-base text-text-subtle">%</span>
            </dt>
            <dd className="mt-1.5 text-xs text-text-muted">
              EU-hosted · OVH · Neon · R2
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
