import { test, expect, describe } from "bun:test";
import {
  normalizeLogo,
  diffLogos,
  hashTestimonial,
  diffTestimonialsStable,
  type TestimonialItem,
} from "../social-proof";

const t = (quote: string): TestimonialItem => ({
  hash: hashTestimonial(quote),
  quote,
  author: null,
});

describe("logos", () => {
  test("named add/remove by normalized brand", () => {
    const { added, removed } = diffLogos(["Acme Corp", "HubSpot"], ["acme corp", "Salesforce"]);
    expect(added).toEqual(["Salesforce"]);
    expect(removed).toEqual(["HubSpot"]);
  });

  test("object-shaped logos diff by name; legacy strings still work", () => {
    const { added, removed } = diffLogos(
      [{ name: "Acme Corp", src: "https://cdn.x/a.png" }, "HubSpot"],
      [{ name: "acme corp", src: "https://cdn.x/a2.png" }, { name: "Salesforce", src: null }],
    );
    expect(added).toEqual(["Salesforce"]);
    expect(removed).toEqual(["HubSpot"]);
  });

  test("asset paths / urls are ignored, not signalled", () => {
    expect(normalizeLogo("https://cdn.x.com/logo.png")).toBeNull();
    expect(normalizeLogo("/assets/acme.svg")).toBeNull();
    const { added, removed } = diffLogos(
      ["https://cdn.x/a.png"],
      ["https://cdn.x/b.png", "/img/c.svg"],
    );
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });
});

describe("testimonials — hashing", () => {
  test("same quote hashes stable, different quote differs", () => {
    expect(hashTestimonial("Great   product!  ")).toBe(hashTestimonial("great product!"));
    expect(hashTestimonial("Quote A")).not.toBe(hashTestimonial("Quote B"));
  });
});

describe("testimonials — stable diff", () => {
  test("not enough history → nothing", () => {
    const sets = [[t("A")], [t("A")], [t("A")]];
    expect(diffTestimonialsStable(sets)).toEqual({ added: [], removed: [] });
  });

  test("a rotating carousel NEVER fires", () => {
    // Each scrape shows a different set of quotes (carousel rotation).
    const sets = [
      [t("q1"), t("q2")],
      [t("q3"), t("q4")],
      [t("q5"), t("q6")],
      [t("q7"), t("q8")],
      [t("q9"), t("q10")],
      [t("q11"), t("q12")],
    ];
    expect(diffTestimonialsStable(sets)).toEqual({ added: [], removed: [] });
  });

  test("a quote stably added on a static wall → testimonial added", () => {
    const base = t("Base quote that is always present on the wall");
    const fresh = t("Brand new customer testimonial that just appeared");
    // newest-first: recent 3 have fresh+base, prior 3 have base only.
    const sets = [
      [base, fresh],
      [base, fresh],
      [base, fresh],
      [base],
      [base],
      [base],
    ];
    const { added, removed } = diffTestimonialsStable(sets);
    expect(added.map((x) => x.quote)).toEqual([fresh.quote]);
    expect(removed).toEqual([]);
  });

  test("a quote stably removed → testimonial removed", () => {
    const base = t("Base quote that is always present on the wall");
    const gone = t("Old reference customer that was churned away");
    const sets = [
      [base],
      [base],
      [base],
      [base, gone],
      [base, gone],
      [base, gone],
    ];
    const { added, removed } = diffTestimonialsStable(sets);
    expect(removed.map((x) => x.quote)).toEqual([gone.quote]);
    expect(added).toEqual([]);
  });
});
