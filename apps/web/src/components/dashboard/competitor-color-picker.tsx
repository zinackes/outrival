"use client";

import { Ban, Pipette } from "lucide-react";
import { COMPETITOR_COLORS } from "@outrival/shared";
import { competitorColorVars, COMP_ACCENT } from "@/lib/competitor-color";
import { cn } from "@/lib/utils";

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const SELECTED = "ring-2 ring-ring ring-offset-1 ring-offset-background";

// Swatch grid (palette + custom hex + clear). Selection shows as a ring — no inner
// check (a white glyph fails contrast on the brighter dark-mode swatch). Each swatch
// renders at the accent lightness of the current theme, so it previews exactly how the
// color will read as a dot/ring/border across the app. Reused in the edit dialog and
// the kebab quick-set popover.
export function CompetitorColorPicker({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
}) {
  const isCustom = !!value && HEX6.test(value);
  const customValue = isCustom ? value! : "#6d5eff";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="No color"
        aria-pressed={!value}
        title="No color"
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground",
          !value && SELECTED,
        )}
      >
        <Ban size={13} />
      </button>

      {COMPETITOR_COLORS.map((c) => (
        <button
          key={c.token}
          type="button"
          onClick={() => onChange(c.token)}
          aria-label={c.label}
          aria-pressed={value === c.token}
          title={c.label}
          style={{ ...competitorColorVars(c.token)!, background: COMP_ACCENT }}
          className={cn(
            "h-7 w-7 rounded-md transition-transform hover:scale-110",
            value === c.token && SELECTED,
          )}
        />
      ))}

      <label
        title="Custom color"
        style={
          isCustom
            ? { ...competitorColorVars(value)!, background: COMP_ACCENT }
            : undefined
        }
        className={cn(
          "relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground",
          isCustom && SELECTED,
        )}
      >
        <Pipette size={13} className={isCustom ? "text-background" : undefined} />
        <input
          type="color"
          value={customValue}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Custom color"
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}
