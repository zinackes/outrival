export function Trust() {
  return (
    <section className="border-y border-border bg-background-2 py-16">
      <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-10 px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
            What it actually solves
          </div>
          <p className="mt-4 text-xl font-medium leading-snug sm:text-2xl">
            Monday morning, you read <b>12 signals that matter</b> instead of
            scrolling through <b>847 changes</b>. The triage is the AI&apos;s
            job — not yours.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
          <div className="bg-surface p-5">
            <div className="text-3xl font-semibold">
              70<span className="text-lg text-text-subtle">:1</span>
            </div>
            <div className="mt-1 text-xs text-text-muted">
              noise to signal ratio
            </div>
          </div>
          <div className="bg-surface p-5">
            <div className="text-3xl font-semibold">10</div>
            <div className="mt-1 text-xs text-text-muted">
              sources per competitor
            </div>
          </div>
          <div className="bg-surface p-5">
            <div className="text-3xl font-semibold">
              ≤ 5<span className="text-lg text-text-subtle">min</span>
            </div>
            <div className="mt-1 text-xs text-text-muted">
              critical alert latency
            </div>
          </div>
          <div className="bg-surface p-5">
            <div className="text-3xl font-semibold">
              100<span className="text-lg text-text-subtle">%</span>
            </div>
            <div className="mt-1 text-xs text-text-muted">
              EU · Hetzner · Railway · R2
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
