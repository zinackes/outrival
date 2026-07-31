import { z } from "zod";

/**
 * A cached, deterministic recipe for driving ONE competitor's public pricing
 * calculator (Pricing Intelligence P4). Same idea as ExtractorSpec, same
 * contract: a CLOSED declarative format, never code — a CSS selector for the
 * quantity control, a CSS selector for the total, and the canonical meter the
 * control moves. Nothing here can execute logic, so a spec produced by the AI
 * heal step is as safe to replay as one written by hand.
 *
 * What the AI is allowed to decide is deliberately narrow: WHERE the control and
 * the total are. What they SAY is read by code, every time. A model that reads a
 * price is a model that can invent one.
 */

export const CALCULATOR_CONTROL_KINDS = ["range", "number", "select"] as const;
export type CalculatorControlKind = (typeof CALCULATOR_CONTROL_KINDS)[number];

export const CalculatorSpecSchema = z.object({
  version: z.number().int().min(1).default(1),
  control: z.object({
    /** CSS selector for the quantity input, resolved against the document. */
    selector: z.string().min(1).max(400),
    kind: z.enum(CALCULATOR_CONTROL_KINDS),
    /**
     * The canonical meter slug (unit-alias) the control moves. Stored rather
     * than re-derived so a page that later relabels its slider ("MTUs" →
     * "monthly visitors") fails the replay instead of silently measuring a
     * different meter under the old identity.
     */
    unit: z.string().min(1).max(60),
    /** Plan/tier the calculator prices, when the page names one. */
    planName: z.string().min(1).max(120).nullable().optional(),
  }),
  total: z.object({
    /** CSS selector for the element displaying the computed monthly total. */
    selector: z.string().min(1).max(400),
  }),
});

export type CalculatorSpec = z.infer<typeof CalculatorSpecSchema>;
