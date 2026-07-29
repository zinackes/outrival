"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { recordPageview } from "./lazy";

export function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    // Deliberately does NOT force the SDK to load: this effect runs on mount, so
    // asking for the client here would undo the deferral on every first visit. The
    // view is held and replayed once the idle load lands.
    recordPageview(url);
  }, [pathname, searchParams]);

  return null;
}
