import { test, expect } from "bun:test";
import { resolveHost, render } from "./status.scraper";

test("resolves the host from a statuspage profile value", () => {
  expect(resolveHost("https://x.com", "statuspage:airbnb.statuspage.io")).toEqual({
    host: "airbnb.statuspage.io",
    instatus: false,
  });
});

test("resolves an instatus slug to its host", () => {
  expect(resolveHost("https://x.com", "instatus:acme")).toEqual({
    host: "acme.instatus.com",
    instatus: true,
  });
});

test("falls back to the monitor URL host when no profile value", () => {
  expect(resolveHost("https://status.stripe.com", undefined)).toEqual({
    host: "status.stripe.com",
    instatus: false,
  });
});

test("ignores the bare 'statuspage' value (cdn-embed only, no host)", () => {
  expect(resolveHost("https://status.acme.com", "statuspage:statuspage")).toEqual({
    host: "status.acme.com",
    instatus: false,
  });
});

test("renders a stable doc independent of component/incident order", () => {
  const a = render(
    {
      page: { name: "Acme" },
      status: { indicator: "minor", description: "Partial outage" },
      components: [
        { name: "API", status: "operational" },
        { name: "Dashboard", status: "degraded_performance" },
      ],
      incidents: [{ name: "Elevated errors", status: "investigating", impact: "minor" }],
    },
    "status.acme.com",
  );
  const b = render(
    {
      page: { name: "Acme" },
      status: { indicator: "minor", description: "Partial outage" },
      components: [
        { name: "Dashboard", status: "degraded_performance" },
        { name: "API", status: "operational" },
      ],
      incidents: [{ name: "Elevated errors", status: "investigating", impact: "minor" }],
    },
    "status.acme.com",
  );
  expect(a.text).toBe(b.text); // order-independent → no phantom change
  expect(a.text).toContain("Overall: minor — Partial outage");
  expect(a.text).toContain("- API: operational");
  expect(a.text).toContain("Active incidents:");
});
