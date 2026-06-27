"use client";

import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Boxes } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { productsListQuery } from "@/lib/queries";

// patch-28 — multi-SKU product switcher. Persists the active product in the URL
// (?product=…) so views (signals feed, battle cards) scope to it; "All products"
// drops the param (aggregate view). Renders nothing for mono-product orgs, so the
// feature is invisible to users with a single product.
const ALL = "all";

export function ProductSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Shares the ["products","list"] cache with the Compare picker.
  const productsQ = useQuery(productsListQuery());
  const products = productsQ.data ?? null;

  const selectable = (products ?? []).filter((p) => p.status !== "archived");
  // Transparent for mono-product orgs: nothing to switch between.
  if (!products || selectable.length <= 1) return null;

  const current = searchParams.get("product") ?? ALL;

  function onChange(value: string) {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (value === ALL) params.delete("product");
    else params.set("product", value);
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger
        className="h-8 w-[170px] text-xs"
        aria-label="Active product"
      >
        <Boxes size={13} className="mr-1 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All products</SelectItem>
        {selectable.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
