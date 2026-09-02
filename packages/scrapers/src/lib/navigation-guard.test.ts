import { describe, expect, test } from "bun:test";
import { MAX_RENDER_REDIRECTS, createRouteGate, type RoutedRequest } from "./navigation-guard";

function nav(url: string, isRedirect = false): RoutedRequest {
  return { resourceType: "document", url, isNavigation: true, isRedirect };
}

function sub(url: string, resourceType = "image"): RoutedRequest {
  return { resourceType, url, isNavigation: false, isRedirect: false };
}

describe("createRouteGate: navigation targets are host-checked", () => {
  test.each([
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["http://localhost:8080/admin", "localhost"],
    ["https://x.corp.internal/", ".internal suffix"],
    ["http://10.0.0.5/", "private IPv4 literal"],
    ["https://redis/", "single-label intranet name"],
    ["https://acme.test:8443/", "non-standard port"],
    ["file:///etc/passwd", "non-http scheme"],
  ])("aborts a navigation to %s (%s)", (url) => {
    expect(createRouteGate()(nav(url))).toBe("abort");
  });

  test("lets a real public page through", () => {
    expect(createRouteGate()(nav("https://acme.com/pricing"))).toBe("continue");
  });

  test("a redirect toward an internal host is refused even though the first hop was public", () => {
    const gate = createRouteGate();
    expect(gate(nav("https://acme.com/pricing"))).toBe("continue");
    expect(gate(nav("http://169.254.169.254/latest/meta-data/", true))).toBe("abort");
  });
});

describe("createRouteGate: subresources", () => {
  test("are not host-checked — a product page loads assets from hosts we don't know", () => {
    expect(createRouteGate()(sub("https://cdn.unknown-vendor.io/app.js", "script"))).toBe(
      "continue",
    );
  });

  test("blocked resource types are aborted, navigation or not", () => {
    const gate = createRouteGate(new Set(["image", "font"]));
    expect(gate(sub("https://acme.com/hero.png"))).toBe("abort");
    expect(gate(sub("https://acme.com/app.js", "script"))).toBe("continue");
  });

  test("an empty blocked set lets every resource type through", () => {
    expect(createRouteGate()(sub("https://acme.com/hero.png"))).toBe("continue");
  });
});

describe("createRouteGate: redirect budget", () => {
  test(`allows ${MAX_RENDER_REDIRECTS} hops and aborts the next one`, () => {
    const gate = createRouteGate();
    expect(gate(nav("https://acme.com/"))).toBe("continue");
    for (let hop = 1; hop <= MAX_RENDER_REDIRECTS; hop++) {
      expect(gate(nav(`https://acme.com/hop-${hop}`, true))).toBe("continue");
    }
    expect(gate(nav("https://acme.com/hop-overflow", true))).toBe("abort");
  });

  test("the budget is per gate, so one render's loop does not poison the next", () => {
    const first = createRouteGate();
    for (let hop = 1; hop <= MAX_RENDER_REDIRECTS + 1; hop++) {
      first(nav(`https://acme.com/hop-${hop}`, true));
    }
    expect(createRouteGate()(nav("https://acme.com/hop-1", true))).toBe("continue");
  });

  test("non-redirect navigations never consume the budget", () => {
    const gate = createRouteGate();
    for (let i = 0; i < 50; i++) {
      expect(gate(nav(`https://acme.com/page-${i}`))).toBe("continue");
    }
  });
});
