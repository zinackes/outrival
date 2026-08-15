"use client";

import { useState } from "react";
import { OVERVIEW_ROWS, REPLICAS, ReplicaChrome } from "./product-replicas";

// Layout A under test — one app window instead of four cards. The four screens
// become four views of the SAME product: one frame, one chrome bar, one nav.
// Nothing floats, nothing is tinted, and the sidebar is what carries the "this
// is software" claim that four separate panels kept re-asserting.
export function ProductWindow() {
  const [key, setKey] = useState("overview");
  const active = REPLICAS.find((r) => r.key === key) ?? REPLICAS[0];
  if (!active) return null;

  return (
    <div className="lp-winwrap">
      <div className="lp-appwin">
        <ReplicaChrome replica={active} dots />
        <div className="aw-body">
          <nav className="aw-side" aria-label="Product views">
            <span className="aw-grp">Views</span>
            {REPLICAS.map((r) => (
              <button
                key={r.key}
                type="button"
                className="aw-nav"
                aria-current={r.key === active.key ? "page" : undefined}
                onClick={() => setKey(r.key)}
              >
                <r.Icon size={15} />
                {r.nav}
              </button>
            ))}
            <span className="aw-grp">Competitors</span>
            <ul className="aw-comp">
              {OVERVIEW_ROWS.map((c) => (
                <li key={c.name}>
                  <i style={{ background: c.sev }} />
                  {c.name}
                  <b>{c.n}</b>
                </li>
              ))}
            </ul>
          </nav>
          <div className="aw-main">
            <active.View />
          </div>
        </div>
      </div>
      <p className="aw-cap">
        <span className="eyebrow">{active.eyebrow}</span>
        {active.title}
      </p>
    </div>
  );
}
