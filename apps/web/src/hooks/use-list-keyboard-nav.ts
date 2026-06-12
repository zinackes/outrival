"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (TYPING_TAGS.has(el.tagName)) return true;
  return Boolean(el.isContentEditable);
}

// A Radix dropdown / popover / open dialog owns the keyboard while it's up — don't
// steal j/k or action keys from it.
function overlayOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]',
    ),
  );
}

export interface ListKeyboardNav {
  /** The id of the currently keyboard-focused item, or null. */
  focusedId: string | null;
  setFocusedId: (id: string | null) => void;
}

/**
 * Roving keyboard navigation over an ordered list of ids (Linear / Superhuman
 * "single focus" model). Handles j/k + arrows, moves real DOM focus to the item
 * element (so screen readers announce it), scrolls it into view, and defers every
 * other key to `onKey`. Suppressed while typing in a field or while a Radix
 * overlay is open. Reusable across feed-like surfaces.
 */
export function useListKeyboardNav({
  ids,
  enabled = true,
  elementId = (id) => `signal-${id}`,
  onKey,
}: {
  ids: string[];
  enabled?: boolean;
  /** Map an item id to the DOM id of its focusable element. */
  elementId?: (id: string) => string;
  /**
   * App-specific keys (r, t, c, Enter, digits, /, ?). `focusedId` is the current
   * item or null. Return true if the key was handled (the hook calls
   * preventDefault for you).
   */
  onKey?: (
    key: string,
    focusedId: string | null,
    e: KeyboardEvent,
  ) => boolean | void;
}): ListKeyboardNav {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const idsRef = useRef(ids);
  idsRef.current = ids;
  const focusedRef = useRef<string | null>(focusedId);
  focusedRef.current = focusedId;
  const onKeyRef = useRef(onKey);
  onKeyRef.current = onKey;

  const focusEl = useCallback(
    (id: string) => {
      const el = document.getElementById(elementId(id));
      if (!el) return;
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      el.scrollIntoView({
        block: "nearest",
        behavior: reduce ? "auto" : "smooth",
      });
      el.focus({ preventScroll: true });
    },
    [elementId],
  );

  // Drop a stale focus when the focused item leaves the list (filter / sort).
  useEffect(() => {
    if (focusedId && !ids.includes(focusedId)) setFocusedId(null);
  }, [ids, focusedId]);

  useEffect(() => {
    if (!enabled) return;

    function move(delta: number) {
      const list = idsRef.current;
      if (list.length === 0) return;
      const cur = focusedRef.current;
      const i = cur ? list.indexOf(cur) : -1;
      let next = i === -1 ? (delta > 0 ? 0 : list.length - 1) : i + delta;
      next = Math.max(0, Math.min(list.length - 1, next));
      const id = list[next];
      if (id) {
        setFocusedId(id);
        focusEl(id);
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;

      // Esc always works: blur a focused field, else release the card focus.
      if (e.key === "Escape") {
        if (isTypingTarget(e.target)) (e.target as HTMLElement).blur();
        else if (focusedRef.current) setFocusedId(null);
        return;
      }

      if (isTypingTarget(e.target) || overlayOpen()) return;

      switch (e.key) {
        case "j":
          e.preventDefault();
          move(1);
          return;
        case "k":
          e.preventDefault();
          move(-1);
          return;
        // Arrows only hijack scroll once the user is in keyboard-nav mode.
        case "ArrowDown":
          if (focusedRef.current) {
            e.preventDefault();
            move(1);
          }
          return;
        case "ArrowUp":
          if (focusedRef.current) {
            e.preventDefault();
            move(-1);
          }
          return;
      }

      if (onKeyRef.current?.(e.key, focusedRef.current, e)) e.preventDefault();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled, focusEl]);

  return { focusedId, setFocusedId };
}
