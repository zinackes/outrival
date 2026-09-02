import { describe, expect, test } from "bun:test";
import { CONTACT, DOMAINS, ENTITY, HOST, TODO } from "../src/lib/legal/entity";

// `entity.ts` is the single source rendered by /legal-notice, /privacy, /terms,
// /terms-of-sale, /subprocessors, /acceptable-use and /security. Nothing between
// it and the public page validates anything, so a placeholder or a dead address
// put there is published as fact — which is exactly how `[À COMPLÉTER]` ended up
// standing in for the publisher's identity (`ux:78`) and how two inboxes that
// were never created ended up being the advertised way to exercise a GDPR right
// (`ux:15`). These tests are that missing check.

const ADDRESS = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/;

describe("published contact addresses", () => {
  test("every address is well formed and on the canonical domain", () => {
    for (const [role, address] of Object.entries(CONTACT)) {
      expect(address, role).toMatch(ADDRESS);
      expect(address.endsWith(`@${DOMAINS.canonical}`), role).toBe(true);
    }
  });

  test("no address carries the placeholder marker", () => {
    for (const [role, address] of Object.entries(CONTACT)) {
      expect(address, role).not.toContain(TODO);
    }
  });

  // The invariant behind `ux:15`, and the reason privacy@ / security@ are not
  // published today: the pages commit to answering on these addresses, so each
  // one has to land somewhere a human reads. Splitting them off is a change to
  // make on the day the mailboxes exist, not before — flipping this constant
  // ahead of the DNS record is the exact regression.
  test("the GDPR and security channels reach an inbox that exists", () => {
    expect(CONTACT.privacy).toBe(CONTACT.general);
    expect(CONTACT.security).toBe(CONTACT.general);
  });
});

describe("the host block on /legal-notice", () => {
  // LCEN art. 6-III wants the host named and reachable; a placeholder here is
  // the same failure as an empty identity block.
  test("names a real host with an address and a way to reach it", () => {
    for (const field of ["name", "address", "phone", "rcs", "website"] as const) {
      expect(HOST[field], field).not.toContain(TODO);
      expect(HOST[field].length, field).toBeGreaterThan(0);
    }
    expect(HOST.website).toStartWith("https://");
  });
});

describe("the identity still waiting on incorporation", () => {
  // Pinned rather than asserted empty: Outrival is not incorporated, so these
  // eight fields legitimately still read `[À COMPLÉTER]` today. Filling any of
  // them fails this test, which is the point — the fix is to shrink this list
  // and tick the matching line in `docs/legal-compliance.md`, so a half-filled
  // identity block cannot ship quietly.
  const PENDING = [
    "legalName",
    "legalForm",
    "capital",
    "siret",
    "rcs",
    "vat",
    "address",
    "publicationDirector",
  ] as const;

  test("is exactly the set the compliance checklist tracks", () => {
    const unfilled = Object.entries(ENTITY)
      .filter(([, value]) => value === TODO)
      .map(([field]) => field)
      .sort();
    expect(unfilled).toEqual([...PENDING].sort());
  });

  test("everything outside that set is filled in", () => {
    for (const field of ["brand", "country"] as const) {
      expect(ENTITY[field], field).not.toContain(TODO);
    }
  });
});
