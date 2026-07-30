"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { competitorsQuery, productsListQuery } from "@/lib/queries";
import { leftProductScope } from "@/lib/product-scope";
import { useProductScope } from "@/components/dashboard/product-scope-provider";

/**
 * A competitor-keyed page (detail, sources, battle card) only belongs to the products
 * that track that competitor (product_competitors). Switching the product scope while
 * one was open left the page reading a competitor the newly picked product doesn't
 * follow: the switcher said one product, the page showed another's data, and on the
 * battle card the user could generate a card for a pairing that doesn't exist. Once
 * the scope moves off this competitor, go to that product's competitor list and say why.
 *
 * The roster read shares the sidebar's ["competitors", productId] query, so the check
 * costs no extra request.
 */
export function useCompetitorScopeGuard(competitorId: string, name?: string | null) {
  const router = useRouter();
  const scope = useProductScope();
  // The scope this page opened under. Never updated: the decision is membership in
  // the CURRENT scope, so a later switch is still caught.
  const mountScope = useRef(scope);
  const scopeMoved = scope !== null && scope !== mountScope.current;

  const rosterQ = useQuery({
    ...competitorsQuery(scope ?? undefined),
    enabled: scopeMoved,
  });
  const productsQ = useQuery({ ...productsListQuery(), enabled: scopeMoved });

  const roster = rosterQ.data;
  const products = productsQ.data;
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    if (!leftProductScope({ scope, mountScope: mountScope.current, roster, competitorId }))
      return;
    fired.current = true;
    const product = products?.find((p) => p.id === scope);
    const subject = name ?? "This competitor";
    toast.info(
      product ? `${subject} isn't tracked for ${product.name}` : `${subject} isn't tracked for that product`,
      { description: "Showing that product's competitors instead." },
    );
    router.replace("/dashboard/competitors");
  }, [scope, roster, products, competitorId, name, router]);
}
