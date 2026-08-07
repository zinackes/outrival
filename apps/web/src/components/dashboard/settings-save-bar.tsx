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
import { CheckIcon, SpinnerIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

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
  const [forms, setForms] = useState<Record<string, Registration>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

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

  async function handleSave() {
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
    } catch {
      // Swallowed on purpose: each form reports its own failure (toast or inline
      // error) and stays dirty. Re-throwing here would only surface an unhandled
      // rejection for something already shown to the user.
    } finally {
      setSaving(false);
    }
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
