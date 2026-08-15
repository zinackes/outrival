"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DocPage } from "@/components/landing/doc-page";
import { LEGAL_VERSION } from "@/lib/legal/entity";

type Lang = "en" | "fr";
const STORAGE_KEY = "outrival.legal.lang";

function LangToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Document language"
      className="inline-flex rounded-md border border-border p-0.5 text-xs"
    >
      {(["en", "fr"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => onChange(l)}
          className={
            lang === l
              ? "rounded-sm bg-foreground px-2.5 py-1 font-medium text-background"
              : "rounded-sm px-2.5 py-1 text-text-muted transition-colors hover:text-foreground"
          }
        >
          {l === "en" ? "English" : "Français"}
        </button>
      ))}
    </div>
  );
}

/**
 * Bilingual shell for every legal document. A page provides the title/intro in
 * both languages plus the two content trees; the reader toggles EN/FR (choice
 * persisted). Renders inside the shared DocPage shell (header + footer).
 *
 * The product ships English-first; legal docs offer French too because the
 * publisher is French and some obligations (LCEN, consumer law) are FR-anchored.
 */
export function LegalDoc({
  title,
  intro,
  en,
  fr,
}: {
  title: Record<Lang, string>;
  intro?: Record<Lang, ReactNode>;
  en: ReactNode;
  fr: ReactNode;
}) {
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") setLang(saved);
  }, []);

  const choose = (l: Lang) => {
    setLang(l);
    window.localStorage.setItem(STORAGE_KEY, l);
  };

  const updated = lang === "fr" ? LEGAL_VERSION.updatedFr : LEGAL_VERSION.updatedEn;

  return (
    <DocPage title={title[lang]} intro={intro?.[lang]}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LangToggle lang={lang} onChange={choose} />
        <p className="text-xs text-text-subtle">
          {lang === "fr" ? "Dernière mise à jour : " : "Last updated: "}
          {updated} · v{LEGAL_VERSION.version}
        </p>
      </div>
      {/* .lp-doc-body again, nested: the toggle row above is the shell's first
          child, so the document needs its own column to stack its paragraphs
          in. Every rule is a descendant selector, so nesting costs nothing. */}
      <div lang={lang} className="lp-doc-body">
        {lang === "en" ? en : fr}
      </div>
    </DocPage>
  );
}
