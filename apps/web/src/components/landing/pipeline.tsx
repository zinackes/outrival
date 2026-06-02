function DiffLine({
  kind = "ctx",
  children,
}: {
  kind?: "ctx" | "add" | "del";
  children: React.ReactNode;
}) {
  const tone =
    kind === "add"
      ? "bg-positive/10 text-positive"
      : kind === "del"
        ? "bg-critical/10 text-critical"
        : "text-text-muted";
  const marker = kind === "add" ? "+" : kind === "del" ? "-" : " ";
  return (
    <div className={`flex gap-2 px-3 ${tone}`}>
      <span className="w-3 shrink-0 select-none text-text-subtle">{marker}</span>
      <span className="whitespace-pre">{children}</span>
    </div>
  );
}

export function Pipeline() {
  return (
    <section
      className="border-y border-border bg-background-2 py-20 sm:py-28"
      id="pipeline"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid gap-x-10 gap-y-4 lg:grid-cols-2 lg:items-end">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            From scraped HTML
            <br />
            to strategic signal.
          </h2>
          <p className="text-text-muted leading-relaxed">
            A real example: a change detected on Linear&apos;s pricing page.
            Here&apos;s exactly what happens between the scrape and the moment
            it shows up in your digest.
          </p>
        </div>

        <div className="mt-12 overflow-hidden rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border bg-background-2 px-4 py-2.5 font-mono text-xs text-text-muted">
            <span className="size-1.5 rounded-full bg-positive" />
            <span>
              <span className="text-foreground">linear.app/pricing</span> ·
              snapshot scraped
            </span>
            <span className="ml-auto text-text-subtle">
              2026-05-25T09:31:14Z
            </span>
          </div>

          <div className="max-h-[200px] overflow-y-auto bg-[#0a0a0c] py-3 font-mono text-xs leading-relaxed">
            <DiffLine>{'<div class="plan plan-business">'}</DiffLine>
            <DiffLine>{"  <h3>Business</h3>"}</DiffLine>
            <DiffLine kind="del">
              {'  <span class="price">$16</span><span>/seat/mo</span>'}
            </DiffLine>
            <DiffLine kind="add">
              {'  <span class="price">$14</span><span>/seat/mo</span>'}
            </DiffLine>
            <DiffLine kind="add">
              {'  <span class="badge">Save 12% annually</span>'}
            </DiffLine>
            <DiffLine>{'  <ul class="features">'}</DiffLine>
            <DiffLine kind="del">{"    <li>Up to 250 members</li>"}</DiffLine>
            <DiffLine kind="add">{"    <li>Unlimited members</li>"}</DiffLine>
          </div>

          <div className="grid gap-3 border-t border-border p-4 md:grid-cols-3">
            <div className="rounded-lg border border-border bg-background-2 p-4">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="rounded bg-surface-3 px-1.5 py-0.5 text-text-subtle">
                  step 1
                </span>
                <span className="text-text-muted">groq · llama-3.3-70b</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-xs">
                <span className="text-text-subtle">category</span>
                <span>pricing</span>
                <span className="text-text-subtle">severity</span>
                <span className="text-critical">critical</span>
                <span className="text-text-subtle">significant</span>
                <span>true</span>
                <span className="text-text-subtle">latency</span>
                <span>348 ms</span>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background-2 p-4">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="rounded bg-surface-3 px-1.5 py-0.5 text-text-subtle">
                  step 2
                </span>
                <span className="text-text-muted">claude sonnet 4.6</span>
              </div>
              <div className="mt-3 text-sm leading-relaxed text-text-muted">
                <b className="text-foreground">
                  Linear repositions Business as the entry tier.
                </b>{" "}
                The gap with your Pro plan tightens from $4 to $2, and the seat
                cap disappears.
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background-2 p-4">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="rounded bg-surface-3 px-1.5 py-0.5 text-text-subtle">
                  step 3
                </span>
                <span className="text-text-muted">→ signal · alert</span>
              </div>
              <div className="mt-3 text-sm leading-relaxed text-text-muted">
                Stored in DB · pushed to Slack{" "}
                <span className="font-mono text-text-subtle">
                  #competitive-intel
                </span>
                .
                <div className="mt-2.5 flex items-center gap-2 rounded border border-border bg-background-2 px-2.5 py-2">
                  <span className="size-2 rounded-full bg-critical" />
                  <span className="font-mono text-[11px] text-text-muted">
                    PRICING · CRITICAL
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-6 text-center font-mono text-[13px] text-text-subtle">
          ~70 changes scanned produce 1 signal · you don&apos;t pay Claude to
          read noise.
        </p>
      </div>
    </section>
  );
}
