import { Nav } from "./nav";
import { SignalLane } from "./signal-lane";
import { Typewriter } from "./typewriter";
import { VantaFog } from "./vanta-fog";

// The paper opening of the landing's light → dark → light rhythm. The layered
// background: CSS fog fallback painted by .lp-hero's pseudo-elements (z -3),
// Vanta's fog canvas over it once loaded (z -2), SVG grain on top (z -1). The
// nav sits in flow inside the hero so the fog runs behind it, and the signal
// lane closes the fold by replaying a week of monitoring as one conveyor.
export function Hero() {
  return (
    <>
      <section className="lp-hero">
        <div className="lp-glow-red" aria-hidden />
        <VantaFog />
        <div className="lp-fog-grain" aria-hidden />
        <Nav tone="landing" />
        <div className="lp-center">
          <h1 className="lp-h1">
            Your competitors <Typewriter /> again.
            <br />
            You&rsquo;ll know by <em className="lp-monday">Monday</em>.
          </h1>
          <p className="lp-sub">
            Outrival watches every public move your competitors make, and
            surfaces the handful that matter. For solo founders and small teams.
            No analyst, no $20k tool.
          </p>
          <div className="lp-ctas">
            <a href="/auth" className="lp-btn-accent lp-btn-hero">
              Start monitoring free
            </a>
            <a href="/sample" className="lp-link-sample">
              See a sample digest
            </a>
          </div>
          {/* The old top banner answered an objection nobody had yet. It reads
              as the button's fine print instead, where the objection lands. */}
          <p className="lp-reassure">
            Free forever on 2 competitors · No credit card · Cancel in one click
          </p>
        </div>
        <div className="lp-machine" aria-hidden>
          <SignalLane />
          <p className="lp-lane-legend">
            A week of monitoring, replayed. The bright ones become signals.
          </p>
        </div>
      </section>
    </>
  );
}
