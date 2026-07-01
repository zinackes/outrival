import { describe, expect, it } from "bun:test";
import { findCareersLink } from "../careers-link";

describe("findCareersLink", () => {
  it("follows a FR footer link to an external careers site", () => {
    const html = `<footer>
      <a href="/contact">Contact</a>
      <a href="https://recrutement.acme.fr/offres">Nous rejoindre</a>
    </footer>`;
    expect(findCareersLink(html, "https://acme.fr")).toBe("https://recrutement.acme.fr/offres");
  });

  it("prefers the off-site careers link over a same-host generic one", () => {
    const html = `
      <a href="/about">Carrières</a>
      <a href="https://jobs.acme.io">Open positions</a>`;
    expect(findCareersLink(html, "https://acme.io")).toBe("https://jobs.acme.io/");
  });

  it("detects an icon link with no text via its href", () => {
    const html = `<a href="https://emploi.acme.fr/"><img alt=""></a>`;
    expect(findCareersLink(html, "https://acme.fr")).toBe("https://emploi.acme.fr/");
  });

  it("detects a careers subdomain even when the path is bare", () => {
    const html = `<a href="https://careers.acme.com/">See roles</a>`;
    expect(findCareersLink(html, "https://acme.com")).toBe("https://careers.acme.com/");
  });

  it("ignores social, mailto and anchor links", () => {
    const html = `
      <a href="#top">Top</a>
      <a href="mailto:jobs@acme.fr">jobs@acme.fr</a>
      <a href="https://www.linkedin.com/company/acme/jobs">Careers</a>`;
    expect(findCareersLink(html, "https://acme.fr")).toBeNull();
  });

  it("rejects private / link-local hosts (SSRF guard)", () => {
    const html = `<a href="http://169.254.169.254/latest/meta-data">careers</a>`;
    expect(findCareersLink(html, "https://acme.fr")).toBeNull();
  });

  it("returns null when there is no careers link", () => {
    const html = `<a href="/pricing">Pricing</a><a href="/blog">Blog</a>`;
    expect(findCareersLink(html, "https://acme.fr")).toBeNull();
  });

  it("resolves a relative same-host careers path to absolute", () => {
    const html = `<a href="/recrutement">Recrutement</a>`;
    expect(findCareersLink(html, "https://acme.fr/")).toBe("https://acme.fr/recrutement");
  });

  it('follows a bare "Jobs"-labelled link to an off-site Notion board (CardNexus)', () => {
    // Real shape: the only careers entry point is a nav link whose text is just
    // "Jobs", pointing at a Notion "Open-Positions-…" page. Neither the phrase
    // patterns nor the /jobs href signal matched it before.
    const html = `<nav>
      <a href="/pricing">Pricing</a>
      <a href="https://acme.notion.site/Open-Positions-at-Acme-1415c72281b2">Jobs</a>
    </nav>`;
    expect(findCareersLink(html, "https://acme.com/")).toBe(
      "https://acme.notion.site/Open-Positions-at-Acme-1415c72281b2",
    );
  });

  it('matches an "/open-positions" path even with generic link text', () => {
    const html = `<a href="https://boards.acme.io/open-positions">See more</a>`;
    expect(findCareersLink(html, "https://acme.io/")).toBe("https://boards.acme.io/open-positions");
  });

  it('treats a bare "Hiring" label as a careers signal', () => {
    const html = `<a href="https://talent.acme.io/">Hiring</a>`;
    expect(findCareersLink(html, "https://acme.io/")).toBe("https://talent.acme.io/");
  });
});
