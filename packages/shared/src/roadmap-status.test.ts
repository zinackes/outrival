import { describe, expect, test } from "bun:test";
import {
  isCommittedRoadmapStatus,
  isOpenRoadmapStatus,
  normalizeRoadmapStatusLabel,
  resolveRoadmapStatus,
  roadmapStatusLabel,
} from "./roadmap-status";

describe("resolveRoadmapStatus — the vendor defaults", () => {
  test.each([
    ["Under Review", "under_review"],
    ["Under consideration", "under_review"],
    ["Open", "under_review"],
    ["Planned", "planned"],
    ["In Progress", "in_progress"],
    ["Complete", "delivered"],
    ["Closed", "closed"],
  ] as const)("%s → %s", (label, expected) => {
    expect(resolveRoadmapStatus(label)).toBe(expected);
  });
});

describe("resolveRoadmapStatus — the words teams actually use", () => {
  test.each([
    // EN
    ["Up next", "planned"],
    ["Next up", "planned"],
    ["Coming soon", "planned"],
    ["Shipping soon", "planned"],
    ["Scheduled", "planned"],
    ["In development", "in_progress"],
    ["Building", "in_progress"],
    ["Started", "in_progress"],
    ["Shipped", "delivered"],
    ["Done", "delivered"],
    ["Released", "delivered"],
    ["Live", "delivered"],
    ["Launched", "delivered"],
    ["Gathering interest", "under_review"],
    ["Backlog", "under_review"],
    // FR
    ["Prévu", "planned"],
    ["Planifié", "planned"],
    ["À venir", "planned"],
    ["En cours", "in_progress"],
    ["En développement", "in_progress"],
    ["Livré", "delivered"],
    ["Terminé", "delivered"],
    ["À l'étude", "under_review"],
    ["Rejeté", "closed"],
    // DE
    ["Geplant", "planned"],
    ["Demnächst", "planned"],
    ["In Bearbeitung", "in_progress"],
    ["In Entwicklung", "in_progress"],
    ["Fertig", "delivered"],
    ["Abgeschlossen", "delivered"],
    ["Veröffentlicht", "delivered"],
    ["In Prüfung", "under_review"],
    ["Abgelehnt", "closed"],
    ["Geschlossen", "closed"],
  ] as const)("%s → %s", (label, expected) => {
    expect(resolveRoadmapStatus(label)).toBe(expected);
  });
});

describe("a refusal is never read as a commitment", () => {
  // Each of these CONTAINS the vocabulary of a state that would signal. Matching
  // refusals first is what stops "not planned" from announcing planned work.
  test.each([
    ["Not planned", "closed"],
    ["Won't do", "closed"],
    ["Wont do", "closed"],
    ["Not doing", "closed"],
    ["Not done", "closed"],
    ["Declined", "closed"],
    ["Nicht geplant", "closed"],
    ["Out of scope", "closed"],
  ] as const)("%s → %s", (label, expected) => {
    expect(resolveRoadmapStatus(label)).toBe(expected);
    expect(isCommittedRoadmapStatus(resolveRoadmapStatus(label))).toBe(false);
  });
});

describe("an unknown label is `other`, never the nearest guess", () => {
  test.each([
    ["Beta", "other"], // deliberately unmapped: neither committed nor generally available
    ["Q3", "other"],
    ["Needs design", "other"],
    ["", "other"],
  ] as const)("%s → %s", (label, expected) => {
    expect(resolveRoadmapStatus(label)).toBe(expected);
  });

  test("null and undefined resolve rather than throw", () => {
    expect(resolveRoadmapStatus(null)).toBe("other");
    expect(resolveRoadmapStatus(undefined)).toBe("other");
  });

  test("`other` stays OPEN — an unread column is not a finished one", () => {
    expect(isOpenRoadmapStatus("other")).toBe(true);
    expect(isCommittedRoadmapStatus("other")).toBe(false);
  });
});

describe("decoration around a label does not change what it says", () => {
  test.each([
    ["→ Planned", "planned"],
    ["Planned (Q3 2026)", "planned"],
    ["  IN   PROGRESS  ", "in_progress"],
    ["in-progress", "in_progress"],
    ["To-do", "planned"],
  ] as const)("%s → %s", (label, expected) => {
    expect(resolveRoadmapStatus(label)).toBe(expected);
  });

  test("the normalizer collapses to the shape the catalog is written against", () => {
    expect(normalizeRoadmapStatusLabel("  In Bearbeitung ")).toContain("in");
    expect(normalizeRoadmapStatusLabel("Terminé")).toBe("termine");
    expect(normalizeRoadmapStatusLabel("Won’t do")).toBe("won't do");
  });
});

describe("open / committed / delivered partitions", () => {
  test("delivered and closed are the only closed-out states", () => {
    expect(isOpenRoadmapStatus("delivered")).toBe(false);
    expect(isOpenRoadmapStatus("closed")).toBe(false);
    expect(isOpenRoadmapStatus("planned")).toBe(true);
    expect(isOpenRoadmapStatus("in_progress")).toBe(true);
    expect(isOpenRoadmapStatus("under_review")).toBe(true);
  });

  test("only planned and in_progress are a commitment", () => {
    expect(isCommittedRoadmapStatus("planned")).toBe(true);
    expect(isCommittedRoadmapStatus("in_progress")).toBe(true);
    expect(isCommittedRoadmapStatus("under_review")).toBe(false);
    expect(isCommittedRoadmapStatus("delivered")).toBe(false);
  });

  test("every status has a human label", () => {
    expect(roadmapStatusLabel("in_progress")).toBe("In progress");
    expect(roadmapStatusLabel("under_review")).toBe("Under review");
  });
});
