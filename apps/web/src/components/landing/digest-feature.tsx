import { Activity, Layers, Zap } from "lucide-react";
import { DigestMockup } from "./digest-mockup";

function FeatureItem({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 font-semibold">
        {icon} {title}
      </div>
      <div className="mt-1.5 text-sm leading-relaxed text-text-muted">
        {desc}
      </div>
    </div>
  );
}

export function DigestFeature() {
  return (
    <section
      className="border-y border-border bg-background-2 py-20 sm:py-28"
      id="digest"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          <div>
            <DigestMockup animate={false} />
          </div>
          <div>
            <h2 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              One email.
              <br />
              Monday morning.
              <br />
              That&apos;s it.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-text-muted">
              Every signal of the week, aggregated and prioritized by AI. You
              open a single email and you know what happened.
            </p>
            <div className="mt-8 space-y-5">
              <FeatureItem
                icon={<Layers size={16} />}
                title="Smart aggregation"
                desc="Related changes get grouped into a single coherent insight — not 4 separate alerts about the same pricing overhaul."
              />
              <FeatureItem
                icon={<Activity size={16} />}
                title={'"So what" + action'}
                desc="Every signal comes with the strategic implication and one recommended action, written for your market."
              />
              <FeatureItem
                icon={<Zap size={16} />}
                title="Critical → real time"
                desc="High/critical signals don't wait until Monday — they ship to Slack or email within 5 minutes."
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
