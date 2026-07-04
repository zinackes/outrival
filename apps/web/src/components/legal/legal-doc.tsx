"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DocPage } from "@/components/landing/doc-page";
import { LEGAL_VERSION } from "@/lib/legal/entity";

type Lang = "en" | "fr";
const STORAGE_KEY = "outrival.legal.lang";

/** Prose styling for legal bodies — richer than DocPage's base (adds h3, lists,
 * tables, strong, hr). Type scale via tokens only (no arbitrary px). */
const PROSE = [
  "flex flex-col gap-4 text-sm leading-relaxed text-text-muted",
  "[&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground",
  "[&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_a]:text-primary [&_a]:underline-offset-2 hover:[&_a]:underline",
  "[&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5",
  "[&_ol]:flex [&_ol]:list-decimal [&_ol]:flex-col [&_ol]:gap-1.5 [&_ol]:pl-5",
  "[&_li]:leading-relaxed [&_li>ul]:mt-1.5",
  "[&_hr]:my-2 [&_hr]:border-border",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-dense",
  "[&_th]:border [&_th]:border-border [&_th]:bg-background-2 [&_th]:p-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-foreground",
  "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top",
  "[&_.fine]:text-xs [&_.fine]:text-text-subtle",
].join(" ");

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
      <div lang={lang} className={PROSE}>
        {lang === "en" ? en : fr}
      </div>
    </DocPage>
  );
}
