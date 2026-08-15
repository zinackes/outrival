import { REPLICAS, ReplicaChrome } from "./product-replicas";

// Layout B under test — the bento kept, but disciplined. What made the first
// pass read as a template: four different tints with an animated shader behind
// them, a replica floating in the middle of its card with a hole of empty black
// underneath, and three levels of heading before any data. Here every card is
// the same graphite, the screen fills the cell edge to edge, and the sentence
// sits under it as a caption rather than above it as a title.
export function ProductBento() {
  return (
    <div className="lp-cards">
      {REPLICAS.map((r) => (
        <article key={r.key} className={`lp-card lp-card-${r.key}`}>
          <div className="lp-card-view">
            <ReplicaChrome replica={r} />
            <r.View />
          </div>
          <div className="lp-card-foot">
            <span className="eyebrow">{r.eyebrow}</span>
            <h3>{r.title}</h3>
          </div>
        </article>
      ))}
    </div>
  );
}
