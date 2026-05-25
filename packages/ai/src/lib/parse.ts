import { z } from "zod";

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function safeParseJson<T>(
  raw: string,
  schema: z.ZodSchema<T>,
): ParseResult<T> {
  try {
    const cleaned = raw.replace(/```json\s*|\s*```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return { ok: false, error: result.error.message };
    }
    return { ok: true, value: result.data };
  } catch (e) {
    return { ok: false, error: `JSON parse failed: ${String(e)}` };
  }
}
