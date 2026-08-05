import { z } from "zod";

/**
 * A zod schema rendered as a JSON Schema a constrained decoder accepts in STRICT
 * mode (Véracité P3): every object closed with `additionalProperties: false` and
 * every declared property listed as required.
 *
 * Both hardenings are what "strict" means to the providers that implement it, and
 * both are what we actually want: the prompt already asks for exactly these keys, so
 * a decoder that cannot emit anything else turns "the model wrote bad JSON" from a
 * retry into an impossibility. Zod's own output leaves optional properties out of
 * `required` — correct as a description, wrong as a grammar, since the model would
 * be free to omit the field we are about to read.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  harden(json);
  return json;
}

function harden(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) harden(item);
    return;
  }
  if (!node || typeof node !== "object") return;
  const object = node as Record<string, unknown>;
  const properties = object.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    object.additionalProperties = false;
    object.required = Object.keys(properties as Record<string, unknown>);
  }
  for (const value of Object.values(object)) harden(value);
}
