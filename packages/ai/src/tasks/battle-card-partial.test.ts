import { describe, expect, test } from "bun:test";
import { parsePartialCard } from "./battle-card-partial";

// What is proven here is the one property the streamed card depends on: whatever
// arrives, an entry is only ever shown once the model has finished writing it. The
// half-written sentence comes back separately, as the line carrying the caret.

const FULL = `{"their_strengths":["Ships weekly"],"our_strengths":["Cheaper seat price"],"their_weaknesses":["Slow dashboard"],"common_objections":[{"objection":"They are cheaper","response":"Only under 5 seats"}],"when_we_win":["Small teams"],"when_we_lose":["Enterprise RFPs"]}`;

describe("a reply in flight", () => {
  test("a finished entry is shown, the one being typed is not", () => {
    const read = parsePartialCard(`{"their_strengths":["Ships weekly","Strong AP`);

    expect(read.content.their_strengths).toEqual(["Ships weekly"]);
    expect(read.typing).toBe("Strong AP");
    expect(read.typingKey).toBe("their_strengths");
  });

  test("the sentence in flight names the section it belongs to", () => {
    const read = parsePartialCard(
      `{"their_strengths":["A"],"our_strengths":["B"],"their_weaknesses":["Slow dash`,
    );
    expect(read.typingKey).toBe("their_weaknesses");
  });

  test("an objection's own fields never masquerade as the section", () => {
    const read = parsePartialCard(
      `{"common_objections":[{"objection":"They are cheaper","response":"Only un`,
    );
    expect(read.typingKey).toBe("common_objections");
  });

  test("an object entry stays hidden until BOTH of its halves have landed", () => {
    const half = parsePartialCard(
      `{"common_objections":[{"objection":"They are cheaper","response":"Only un`,
    );
    expect(half.content.common_objections).toBeUndefined();
    expect(half.typing).toBe("Only un");

    const whole = parsePartialCard(
      `{"common_objections":[{"objection":"They are cheaper","response":"Only under 5 seats"}`,
    );
    expect(whole.content.common_objections).toEqual([
      { objection: "They are cheaper", response: "Only under 5 seats" },
    ]);
    expect(whole.typing).toBeNull();
  });

  test("a section whose value has not started yet is left out, not shown empty", () => {
    const read = parsePartialCard(`{"their_strengths":["Ships weekly"],"our_strengths":`);

    expect(read.content.their_strengths).toEqual(["Ships weekly"]);
    expect(read.content.our_strengths).toBeUndefined();
    expect(read.typing).toBeNull();
  });

  test("a closed array is complete even with sections still to come", () => {
    const read = parsePartialCard(`{"their_strengths":["A","B"],"our_strengths":["C"`);

    expect(read.content.their_strengths).toEqual(["A", "B"]);
    expect(read.content.our_strengths).toEqual(["C"]);
  });

  test("an escape sequence inside the sentence being typed reads as prose", () => {
    const read = parsePartialCard(`{"their_strengths":["They say \\"fastest\\" and`);
    expect(read.typing).toBe(`They say "fastest" and`);
    expect(read.content.their_strengths).toBeUndefined();
  });
});

describe("a whole reply", () => {
  test("reads exactly as the finished card, with nothing left typing", () => {
    const read = parsePartialCard(FULL);

    expect(read.typing).toBeNull();
    expect(read.content.their_strengths).toEqual(["Ships weekly"]);
    expect(read.content.when_we_lose).toEqual(["Enterprise RFPs"]);
    expect(read.content.common_objections).toHaveLength(1);
  });

  test("a fenced reply is read too — providers add them unasked", () => {
    const read = parsePartialCard("```json\n" + FULL);
    expect(read.content.their_strengths).toEqual(["Ships weekly"]);
  });
});

describe("nothing usable yet", () => {
  test("an empty or opening-only reply reads empty rather than guessing", () => {
    for (const raw of ["", "  ", "{", `{"their_strengths":[`]) {
      const read = parsePartialCard(raw);
      expect(read.content).toEqual({});
      expect(read.typing).toBeNull();
    }
  });

  test("unknown keys and non-array sections are ignored", () => {
    const read = parsePartialCard(`{"totally_made_up":["x"],"their_strengths":"not an array"}`);
    expect(read.content).toEqual({});
  });
});
