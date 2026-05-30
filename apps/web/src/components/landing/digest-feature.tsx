import { Activity, Layers, Zap } from "lucide-react";
import { DigestMockup } from "./digest-mockup";

export function DigestFeature() {
  return (
    <section
      className="section"
      id="digest"
      style={{
        background: "var(--background-2)",
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="wrap">
        <div className="digest-feature">
          <div>
            <DigestMockup animate={false} />
          </div>
          <div>
            <h2>
              One email.
              <br />
              Monday morning.
              <br />
              That&apos;s it.
            </h2>
            <p className="muted" style={{ marginTop: 20, fontSize: 17 }}>
              Every signal of the week, aggregated and prioritized by Claude.
              You open a single email and you know what happened.
            </p>
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-item-title">
                  <Layers size={16} /> Smart aggregation
                </div>
                <div className="feature-item-desc">
                  Related changes get grouped into a single coherent insight —
                  not 4 separate alerts about the same pricing overhaul.
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-item-title">
                  <Activity size={16} /> &quot;So what&quot; + action
                </div>
                <div className="feature-item-desc">
                  Every signal comes with the strategic implication and one
                  recommended action, written for your market.
                </div>
              </div>
              <div className="feature-item">
                <div className="feature-item-title">
                  <Zap size={16} /> Critical → real time
                </div>
                <div className="feature-item-desc">
                  High/critical signals don&apos;t wait until Monday — they
                  ship to Slack or email within 5 minutes.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
