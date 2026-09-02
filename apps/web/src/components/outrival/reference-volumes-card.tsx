"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toastApiError } from "@/lib/error-helpers";
import { SpinnerIcon, WarningIcon, XIcon } from "@/components/icons";
import { api, type ReferenceVolume } from "@/lib/api";
import { referenceVolumesQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingRowsSkeleton } from "@/components/dashboard/skeletons";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The volumes this workspace compares metered pricing at.
 *
 * A usage-based competitor has no single price to put on a bar, so the price
 * lens reads it at a volume instead. These are those volumes. Nothing is
 * re-scraped when they change: the cost is computed from the captured ladder,
 * so a new number is one read away.
 */
export function ReferenceVolumesCard() {
  const qc = useQueryClient();
  const q = useQuery(referenceVolumesQuery());
  const [saving, setSaving] = useState(false);
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("");

  if (q.isLoading) return <SettingRowsSkeleton rows={3} />;
  if (!q.data) return null;

  const { referenceVolumes, presetQuantities, units } = q.data;
  const rows = referenceVolumes ?? [];
  const labelOf = (u: string) => units.find((x) => x.unit === u)?.label ?? u;
  // #459 grouped the PICKER by whether the roster is charged on a meter, which
  // fixed what goes in. A volume ALREADY saved on a meter nobody bills for still
  // listed identically to a live one, so the list says it too.
  const inRosterOf = (u: string) => units.find((x) => x.unit === u)?.inRoster ?? false;
  // The meters a competitor in this workspace is actually charged on. A volume set
  // on any other unit is stored and then read by nothing, which is what made this
  // setting feel dead — so the ones that can move a comparison come first, and the
  // rest stay reachable for a competitor added later.
  const rosterUnits = units.filter((u) => u.inRoster);
  const otherUnits = units.filter((u) => !u.inRoster);

  async function save(next: ReferenceVolume[] | null) {
    setSaving(true);
    try {
      await api.updateReferenceVolumes(next);
      await qc.invalidateQueries({ queryKey: referenceVolumesQuery().queryKey });
    } catch (e) {
      toastApiError(e, { title: "Couldn't save that" });
    } finally {
      setSaving(false);
    }
  }

  async function add() {
    const amount = Number(qty.replace(/[\s,]/g, ""));
    if (!unit || !Number.isFinite(amount) || amount <= 0) return;
    await save([...rows, { unit, qty: amount }]);
    setQty("");
  }

  // OUT-38 — the heading moved to the page's SettingsSection. Every control here
  // is unchanged; the list gained the dead-meter note.
  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 ? (
        <ul className="flex flex-col">
          {rows.map((row, i) => {
            const live = inRosterOf(row.unit);
            const label = `${row.qty.toLocaleString("en-US")} ${labelOf(row.unit)}`;
            return (
              <li
                key={`${row.unit}-${row.qty}`}
                className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-dense tabular-nums ${live ? "text-foreground" : "text-muted-foreground"}`}
                  >
                    {label}
                  </div>
                  {!live && (
                    <div className="mt-0.5 flex items-center gap-1.5 text-meta text-muted-foreground">
                      <WarningIcon size={12} className="shrink-0" aria-hidden />
                      Nobody you track bills on this meter, so nothing reads this volume.
                    </div>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => save(rows.filter((_, j) => j !== i))}
                  aria-label={`Remove ${label}`}
                >
                  <XIcon className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-dense text-muted-foreground">
          Following the defaults: {presetQuantities.map((n) => n.toLocaleString("en-US")).join(", ")}{" "}
          units of whichever meter you pick on the price lens.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="numeric"
          placeholder="10,000"
          className="w-32 tabular-nums"
          aria-label="Quantity"
        />
        <Select value={unit} onValueChange={setUnit}>
          <SelectTrigger className="w-44" aria-label="Meter">
            <SelectValue placeholder="Pick a meter" />
          </SelectTrigger>
          <SelectContent>
            {rosterUnits.length > 0 && (
              <SelectGroup>
                <SelectLabel>Metered by your competitors</SelectLabel>
                {rosterUnits.map((u) => (
                  <SelectItem key={u.unit} value={u.unit}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {rosterUnits.length > 0 && otherUnits.length > 0 && <SelectSeparator />}
            {otherUnits.length > 0 && (
              <SelectGroup>
                {rosterUnits.length > 0 && <SelectLabel>Other meters</SelectLabel>}
                {otherUnits.map((u) => (
                  <SelectItem key={u.unit} value={u.unit}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={add} disabled={saving || !unit || !qty}>
          {saving && <SpinnerIcon className="size-4 animate-spin" />}
          Add volume
        </Button>
        {rows.length > 0 && (
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => save(null)}>
            Reset to defaults
          </Button>
        )}
      </div>
    </div>
  );
}
