"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, SpinnerIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * One save bar per settings page, fed by every form on it.
 *
 * Three save models used to coexist on adjacent pages: a sticky bar (workspace,
 * notification settings, notification moderation), an always-visible button
 * disabled while pristine (profile), and immediate saves with no bar at all
 * (products, data, security). Worse, Notifications renders two forms that EACH
 * owned a sticky bar — edit both and two bars stacked at the bottom of the
 * viewport, each saving half the page, neither saying which half.
 *
 * So the bar belongs to the page and forms register with it. A form reports its
 * dirty state and hands over a save and a reset; the bar collects them, names
 * which sections are pending, and runs them together. A page with one form gets
 * the same bar as a page with three, which is the point.
 */

interface Registration {
  /** Section name, shown when more than one form is pending. */
  label: string;
  dirty: boolean;
  save: () => Promise<void>;
  reset: () => void;
}

interface SaveBarContext {
  register: (id: string, reg: Registration) => void;
  unregister: (id: string) => void;
}

const Ctx = createContext<SaveBarContext | null>(null);

export function SettingsSaveBarProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [forms, setForms] = useState<Record<string, Registration>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // The link a guarded click was heading to, held while the user decides.
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const register = useCallback((id: string, reg: Registration) => {
    setForms((prev) => ({ ...prev, [id]: reg }));
  }, []);

  const unregister = useCallback((id: string) => {
    setForms((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const ctx = useMemo(() => ({ register, unregister }), [register, unregister]);

  const pending = Object.values(forms).filter((f) => f.dirty);
  const dirty = pending.length > 0;

  // Clear the confirmation as soon as anything goes dirty again, so "Saved" is
  // never on screen next to an unsaved edit.
  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

  async function handleSave(): Promise<boolean> {
    setSaving(true);
    try {
      // Sequential, not Promise.all: these are independent endpoints and a
      // partial failure should leave the ones already saved saved, with the
      // failing form keeping its own error surface. A throw stops the loop and
      // skips the confirmation — the forms that did save go clean on their own,
      // so the bar keeps naming whatever is still pending.
      for (const form of pending) {
        await form.save();
      }
      setSaved(true);
      return true;
    } catch {
      // Swallowed on purpose: each form reports its own failure (toast or inline
      // error) and stays dirty. Re-throwing here would only surface an unhandled
      // rejection for something already shown to the user. The boolean is for the
      // leave-confirmation, which must not navigate away from a save that failed.
      return false;
    } finally {
      setSaving(false);
    }
  }


  // Leaving with unsaved edits.
  //
  // A settings edit lived only in the form's local state until Save, so clicking a
  // sidebar link threw it away instantly: no prompt, no trace, no way back
  // (`ux:32`). The App Router has no navigation event to hook, so links are caught
  // where they start — a capture-phase click listener, active only while something
  // is dirty. `beforeunload` covers the reload / close / back cases the browser
  // owns.
  //
  // Deliberately narrow: only a plain left-click on a same-origin in-app link is
  // held. A modified click (new tab), a download, an external href or the current
  // page is left alone, because none of them discards the edit.
  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target.closest("a") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === window.location.pathname + window.location.search)
        return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(url.pathname + url.search);
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function leave() {
    const href = pendingHref;
    setPendingHref(null);
    if (href) router.push(href);
  }

  async function saveAndLeave() {
    if (await handleSave()) leave();
  }

  function handleReset() {
    for (const form of pending) form.reset();
  }

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {/* Bleeds to the shell's padding so the bar spans the reading column's
          full width rather than floating inside it. */}
      <div
        aria-live="polite"
        className="pointer-events-none sticky bottom-0 z-20 -mx-4 -mb-12 mt-2 md:-mx-5 lg:-mx-8 lg:-mb-16"
      >
        {(dirty || saved) && (
          <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border-strong bg-surface/92 px-4 py-3 backdrop-blur-md md:px-5 lg:px-8">
            {dirty ? (
              <span className="text-dense text-muted-foreground">
                {pending.length === 1 && pending[0]
                  ? `Unsaved changes in ${pending[0].label}.`
                  : `Unsaved changes in ${pending.map((f) => f.label).join(" and ")}.`}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-dense text-positive">
                <CheckIcon className="size-3.5" /> Saved
              </span>
            )}
            {dirty && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleReset}
                  disabled={saving}
                >
                  Discard
                </Button>
                <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
                  {saving && <SpinnerIcon size={16} className="animate-spin" />}
                  {saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <Dialog open={pendingHref !== null} onOpenChange={(o) => !o && setPendingHref(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave with unsaved changes?</DialogTitle>
            <DialogDescription>
              {pending.length === 1 && pending[0]
                ? `Your edits in ${pending[0].label} aren't saved yet.`
                : `Your edits in ${pending.map((f) => f.label).join(" and ")} aren't saved yet.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={leave}
              disabled={saving}
            >
              Discard and leave
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setPendingHref(null)}
              disabled={saving}
            >
              Keep editing
            </Button>
            <Button type="button" onClick={saveAndLeave} disabled={saving}>
              {saving && <SpinnerIcon size={16} className="animate-spin" />}
              {saving ? "Saving…" : "Save and leave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

/**
 * Register a form with the page's save bar.
 *
 * `save` and `reset` are read at call time, so they don't need to be stable —
 * only `id`, `label` and `dirty` drive the effect. A page rendered without the
 * provider (or a form used outside settings) is a no-op, so a form can keep its
 * own controls if it ever needs to.
 */
export function useSettingsSaveBar({
  id,
  label,
  dirty,
  save,
  reset,
}: {
  id: string;
  label: string;
  dirty: boolean;
  save: () => Promise<void>;
  reset: () => void;
}) {
  const ctx = useContext(Ctx);

  // The callbacks are read at call time through a ref, so they are deliberately
  // NOT effect dependencies. Both are new closures on every render; depending on
  // them would re-register on every render, and since register() sets state on
  // the provider, that is an infinite render loop rather than a stale closure.
  const latest = useRef({ save, reset });
  latest.current = { save, reset };

  useEffect(() => {
    if (!ctx) return;
    ctx.register(id, {
      label,
      dirty,
      save: () => latest.current.save(),
      reset: () => latest.current.reset(),
    });
    return () => ctx.unregister(id);
  }, [ctx, id, label, dirty]);

  return ctx != null;
}
