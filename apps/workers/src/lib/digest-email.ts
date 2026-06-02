import type { Digest } from "@outrival/ai";

const URGENCY_META: Record<
  "action_required" | "watch" | "fyi",
  { emoji: string; label: string; color: string }
> = {
  action_required: { emoji: "🔴", label: "Action required", color: "#ef4444" },
  watch: { emoji: "🟡", label: "Watch", color: "#f59e0b" },
  fyi: { emoji: "🟢", label: "FYI", color: "#22c55e" },
};

export function renderDigestEmail(
  digest: Digest,
  weekStart: string,
  weekEnd: string,
  // Optional one-click feedback links (patch-21). Absent → footer without them
  // (e.g. when the signing secret or API base URL isn't configured).
  feedbackLinks?: { useful: string; notUseful: string },
): string {
  const sectionsHtml = (["action_required", "watch", "fyi"] as const)
    .map((urgency) => {
      const items = digest.sections.filter((s) => s.urgency === urgency);
      if (items.length === 0) return "";
      const meta = URGENCY_META[urgency];
      const rows = items
        .map(
          (s) => `
  <div style="background:#171717;border:1px solid #262626;border-radius:6px;padding:16px;margin-bottom:12px;">
    <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#a3a3a3;margin-bottom:6px;">${s.competitor} · ${s.category}</div>
    <div style="color:#fafafa;font-size:14px;margin-bottom:8px;">${s.insight}</div>
    <div style="color:#f59e0b;font-size:13px;">→ ${s.so_what}</div>
  </div>`,
        )
        .join("");
      return `
<div style="margin-bottom:24px;">
  <h3 style="font-family:Syne,sans-serif;color:${meta.color};font-size:16px;margin:0 0 12px;">${meta.emoji} ${meta.label}</h3>
  ${rows}
</div>`;
    })
    .join("");

  const tldrHtml = digest.tldr
    .map((t) => `<li style="margin-bottom:6px;">${t}</li>`)
    .join("");

  // Sector trends (patch-13): a clearly separated block after the micro signals.
  const sectoral = digest.sectoralTrends ?? [];
  const sectoralHtml =
    sectoral.length === 0
      ? ""
      : `
<div style="margin-top:8px;margin-bottom:24px;border-top:1px solid #262626;padding-top:20px;">
  <h3 style="font-family:Syne,sans-serif;color:#fafafa;font-size:16px;margin:0 0 12px;">🌍 Sector trends</h3>
  ${sectoral
    .map(
      (t) => `
  <div style="background:#171717;border:1px solid #262626;border-radius:6px;padding:16px;margin-bottom:12px;">
    <div style="color:#fafafa;font-size:14px;font-weight:600;margin-bottom:6px;">${t.title}</div>
    <div style="color:#a3a3a3;font-size:13px;">${t.insight}</div>
  </div>`,
    )
    .join("")}
</div>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#0a0a0a;color:#fafafa;font-family:Inter,sans-serif;">
    <div style="max-width:640px;margin:0 auto;">
      <div style="margin-bottom:24px;">
        <span style="font-family:Syne,sans-serif;font-size:24px;font-weight:bold;">Out<span style="color:#f59e0b;">rival</span></span>
        <div style="font-size:12px;color:#a3a3a3;margin-top:4px;">Digest from ${weekStart} to ${weekEnd}</div>
      </div>
      <div style="background:#171717;border:1px solid #262626;border-radius:6px;padding:20px;margin-bottom:24px;">
        <div style="font-size:12px;color:#a3a3a3;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Temperature · ${digest.temperature}</div>
        <ul style="margin:0;padding-left:18px;font-size:14px;color:#fafafa;">${tldrHtml}</ul>
      </div>
      ${sectionsHtml}
      ${sectoralHtml}
      ${
        feedbackLinks
          ? `<div style="margin-top:28px;border-top:1px solid #262626;padding-top:18px;text-align:center;font-size:13px;color:#a3a3a3;">
        Was this digest useful?
        <a href="${feedbackLinks.useful}" style="color:#22c55e;text-decoration:none;margin:0 8px;">👍 Yes</a>
        <a href="${feedbackLinks.notUseful}" style="color:#ef4444;text-decoration:none;margin:0 8px;">👎 No</a>
      </div>`
          : ""
      }
      <div style="margin-top:32px;font-size:11px;color:#525252;text-align:center;">Outrival · Automated competitive intelligence</div>
    </div>
  </body>
</html>`;
}
