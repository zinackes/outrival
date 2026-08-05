import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { toStrictJsonSchema } from "./json-schema";

describe("toStrictJsonSchema", () => {
  test("closes every object and requires every property, nested included", () => {
    const schema = z.object({
      insight: z.string(),
      confidence: z.enum(["low", "high"]).optional(),
      meta: z.object({ source: z.string().nullable() }),
    });
    const json = toStrictJsonSchema(schema) as {
      additionalProperties: boolean;
      required: string[];
      properties: { meta: { additionalProperties: boolean; required: string[] } };
    };

    expect(json.additionalProperties).toBe(false);
    // The optional field is required in the GRAMMAR: the model must not omit a key
    // we are about to read.
    expect(json.required.sort()).toEqual(["confidence", "insight", "meta"]);
    expect(json.properties.meta.additionalProperties).toBe(false);
    expect(json.properties.meta.required).toEqual(["source"]);
  });

  test("drops $schema, which the chat-completions field does not take", () => {
    expect(toStrictJsonSchema(z.object({ a: z.string() })).$schema).toBeUndefined();
  });

  test("arrays of objects are hardened too", () => {
    const json = toStrictJsonSchema(z.object({ rows: z.array(z.object({ n: z.number() })) })) as {
      properties: { rows: { items: { additionalProperties: boolean; required: string[] } } };
    };
    expect(json.properties.rows.items.additionalProperties).toBe(false);
    expect(json.properties.rows.items.required).toEqual(["n"]);
  });
});
