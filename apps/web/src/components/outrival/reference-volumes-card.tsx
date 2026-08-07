"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { SpinnerIcon, XIcon } from "@/components/icons";
import { api, type ReferenceVolume } from "@/lib/api";
import { referenceVolumesQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

  if (q.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (!q.data) return null;

  const { referenceVolumes, presetQuantities, units } = q.data;
  const rows = referenceVolumes ?? [];
  const labelOf = (u: string) => units.find((x) => x.unit === u)?.label ?? u;
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
    } catch {
      toast.error("Couldn't save that. Try again.");
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

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-medium tracking-tight">Reference volumes</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          What a usage-based competitor costs is only a number once you name a
          volume. Set the ones you actually buy at, and the price comparison reads
          every metered plan there. Nothing is re-scanned when you change these.
        </p>
      </div>

      {rows.length > 0 ? (
        <ul className="flex flex-col">
          {rows.map((row, i) => (
            <li
              key={`${row.unit}-${row.qty}`}
              className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
            >
              <span className="text-sm text-foreground tabular-nums">
                {row.qty.toLocaleString("en-US")} {labelOf(row.unit)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={saving}
                onClick={() => save(rows.filter((_, j) => j !== i))}
                aria-label={`Remove ${row.qty.toLocaleString("en-US")} ${labelOf(row.unit)}`}
              >
                <XIcon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
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
    </section>
  );
}
