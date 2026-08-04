"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { GROUP_MODES, type GroupMode } from "@/components/dashboard/signals-list-header";

// How the signals list is grouped, remembered across visits. The mode already
// lived in ?group=, which survives a refresh but not leaving the page — so a
// reader who wants near-duplicates folded had to re-pick it every single visit.
// That is a display preference, not a piece of the feed's query, hence
// localStorage (sample mode is sessionStorage: a demo should not outlive the tab)
// and never the server.
//
// The URL still WINS when it names a mode: a shared or deep link has to render
// what it says. Restoring does not write ?group= back, on purpose — a
// router.replace on mount re-runs the Server Component and refetches the feed
// (see the focus-sync note in signals-view).

const KEY = "outrival:signals-group";
const listeners = new Set<() => void>();

function read(): GroupMode {
  try {
    const v = localStorage.getItem(KEY);
    return (GROUP_MODES as readonly string[]).includes(v ?? "")
      ? (v as GroupMode)
      : "none";
  } catch {
    return "none";
  }
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // Cross-tab + cross-component coherence.
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

export function useSignalsGroup(): readonly [GroupMode, (mode: GroupMode) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    read,
    () => "none" as GroupMode, // server snapshot — the preference is client-only
  );

  // Re-sync once on mount: the server rendered "none", storage may say otherwise.
  useEffect(() => emit(), []);

  const set = useCallback((mode: GroupMode) => {
    try {
      if (mode === "none") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, mode);
    } catch {
      /* ignore — private mode / disabled storage */
    }
    emit();
  }, []);

  return [stored, set] as const;
}
