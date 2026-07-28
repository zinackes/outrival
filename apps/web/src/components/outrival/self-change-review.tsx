"use client";

import { useState } from "react";
import {
  CaretRightIcon,
  XIcon,
  PlusIcon,
  WarningIcon,
  CheckIcon,
  ArrowUpRightIcon,
} from "@phosphor-icons/react/ssr";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import type { SelfProductChange } from "@/lib/api";


/** Field path (profile key or signal category) → human label. */
const FIELD_LABELS: Record<string, string> = {
  pricing: "Pricing",
  product: "Product",
  hiring: "Hiring",
  reviews: "Reviews",
  content: "Content / messaging",
  funding: "Funding",
  api_developer: "Developer / API",
  category: "Category",
  audience: "Audience",
  valueProp: "Value proposition",
  features: "Features",
  techStack: "Tech stack",
};

const PROFILE_FIELDS = ["category", "audience", "valueProp", "features", "techStack"];
const ARRAY_FIELDS = new Set(["features", "techStack"]);

/** Editable iff it's a profile-divergence proposal (no originating pipeline change). */
function isEditable(ch: SelfProductChange) {
  return ch.changeId === null && PROFILE_FIELDS.includes(ch.fieldPath);
}

/** Coerce a stored value side (string | string[] | null | unknown) into display lines. */
function asLines(v: unknown): string[] {
  if (typeof v === "string") return v.trim().length > 0 ? [v] : [];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

const norm = (s: string) => s.trim().toLowerCase();
const dedupe = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const k = norm(x);
    if (!x.trim() || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a.map(norm)].sort().join("\u0000") === [...b.map(norm)].sort().join("\u0000");

/** One readable change item: a clean line, plus a real link when the scraper
 *  appended a URL (so the dangling "Learn more →" becomes a working link). */
type DiffItem = { text: string; url?: string };

// CTA tokens scrapers glue onto listing cards ("…North AmericaLearn more→ Senior /…").
// Splitting on them removes the noise AND un-glues entries packed into one diff line.
const CTA_SPLIT =
  /\s*(?:learn more|apply now|apply today|apply|view (?:job|opening|role|details?|posting)|read more|see (?:more|details)|view)\s*[→›»↗⟶]*\s*/gi;

// A trailing "(https://…)" the scraper tacked onto a structured entry.
const TRAILING_URL = /\(\s*(https?:\/\/[^)\s]+)\s*\)\s*$/i;

// Two footer legal/nav words glued together ("PrivacyTermsDPA", "…DPAAUP") —
// a reliable scraped-junk signature; a single such word on its own is left alone.
const GLUED_LEGAL = /(privacy|terms|dpa|aup|cookies?|gdpr)(privacy|terms|dpa|aup|cookies?|gdpr)/i;

/** Drop scraped nav/legal junk: bare URLs, glued legal words, or a single
 *  whitespace-free token with several caps humps ("PrivacyTermsDPA"). */
function isJunk(s: string): boolean {
  if (/^https?:\/\//i.test(s)) return true;
  if (GLUED_LEGAL.test(s.replace(/\s+/g, ""))) return true;
  if (/\s/.test(s)) return false;
  const caps = s.match(/[A-Z]/g)?.length ?? 0;
  return caps >= 2 && s.length <= 32 && /^[A-Za-z]+$/.test(s);
}

/** Turn a raw added/removed value into clean, de-glued, de-duped display items.
 *  Generic across categories — non-hiring values simply have no CTA tokens to
 *  split on, so they pass through with whitespace collapsed. */
function toDiffItems(v: unknown): DiffItem[] {
  const out: DiffItem[] = [];
  const seen = new Set<string>();
  for (const raw of asLines(v)) {
    for (const part of raw.split(CTA_SPLIT)) {
      let seg = part.replace(/\s+/g, " ").trim();
      let url: string | undefined;
      const m = seg.match(TRAILING_URL);
      if (m) {
        url = m[1];
        seg = seg.replace(TRAILING_URL, "").trim();
      }
      seg = seg
        .replace(/^[•·\-–—]+\s*/, "")
        .replace(/\s*[→›»↗⟶]+\s*$/, "")
        .trim();
      if (!seg || isJunk(seg)) continue;
      const key = seg.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(url ? { text: seg, url } : { text: seg });
    }
  }
  return out;
}

const itemKey = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** Net diff: what genuinely changed. Items present on both sides (e.g. listings
 *  merely reordered) are dropped so the panel answers "what changed". */
function netDiff(change: SelfProductChange) {
  const removed = toDiffItems(change.previousValue);
  const added = toDiffItems(change.newValue);
  const removedKeys = new Set(removed.map((i) => itemKey(i.text)));
  const addedKeys = new Set(added.map((i) => itemKey(i.text)));
  return {
    added,
    removed,
    addedOnly: added.filter((i) => !removedKeys.has(itemKey(i.text))),
    removedOnly: removed.filter((i) => !addedKeys.has(itemKey(i.text))),
  };
}

type ResolveFn = (
  change: SelfProductChange,
  action: "accept" | "ignore",
  value?: string | string[],
) => void | Promise<void>;

export function SelfChangesPanel({
  changes,
  actingId,
  onResolve,
}: {
  changes: SelfProductChange[];
  actingId: string | null;
  onResolve: ResolveFn;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const current = changes.find((c) => c.id === openId) ?? null;

  if (changes.length === 0) return null;

  return (
    <Card className="mb-6 p-0">
      <div className="flex items-center justify-between px-5 py-3.5">
        <h2 className="text-sm font-semibold">
          {changes.length} change{changes.length > 1 ? "s" : ""} detected on your site
        </h2>
        <span className="text-meta text-[var(--muted-2)]">
          pending review
        </span>
      </div>
      <Separator />
      <ul className="divide-y divide-border">
        {changes.map((ch) => {
          const label = FIELD_LABELS[ch.fieldPath] ?? ch.fieldPath;
          const acting = actingId === ch.id;
          const editableRow = isEditable(ch);
          let preview = "";
          if (editableRow && ARRAY_FIELDS.has(ch.fieldPath)) {
            const n = asLines(ch.newValue).length;
            preview = `${n} item${n === 1 ? "" : "s"}`;
          } else if (!editableRow) {
            const { addedOnly, removedOnly } = netDiff(ch);
            preview = [
              addedOnly.length ? `+${addedOnly.length}` : "",
              removedOnly.length ? `−${removedOnly.length}` : "",
            ]
              .filter(Boolean)
              .join(" ");
          }
          return (
            <li key={ch.id} className="group flex items-stretch">
              <button
                type="button"
                onClick={() => setOpenId(ch.id)}
                disabled={acting}
                className="flex min-w-0 flex-1 items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <span
                  aria-hidden
                  className={`size-2 shrink-0 rounded-full ${
                    ch.severity === "major" ? "bg-destructive" : "bg-muted-foreground/40"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{label}</span>
                    <Badge
                      variant={ch.severity === "major" ? "destructive" : "secondary"}
                      className="h-4 px-1.5 text-meta font-medium"
                    >
                      {ch.severity}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                    {ch.summary ?? "Change detected."}
                  </span>
                </span>
                {preview && (
                  <span className="hidden shrink-0 text-meta text-[var(--muted-2)] sm:inline">
                    {preview}
                  </span>
                )}
                <CaretRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => void onResolve(ch, "ignore")}
                disabled={acting}
                aria-label={`Ignore ${label} change`}
                title="Ignore"
                className="flex shrink-0 items-center px-3 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <XIcon className="size-4" />
              </button>
            </li>
          );
        })}
      </ul>

      <Sheet open={!!current} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          {current && (
            <ReviewBody
              key={current.id}
              change={current}
              acting={actingId === current.id}
              onResolve={onResolve}
            />
          )}
        </SheetContent>
      </Sheet>
    </Card>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-meta font-medium text-muted-foreground">{children}</div>;
}

/** A toggleable item row: the whole row toggles; the Checkbox is presentational. */
function ToggleItem({
  checked,
  onToggle,
  dim,
  children,
}: {
  checked: boolean;
  onToggle: (next: boolean) => void;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onToggle(!checked)}
      className="flex w-full items-start gap-2.5 rounded-md px-1 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <span
        aria-hidden
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
          checked ? "border-primary bg-primary text-primary-foreground" : "border-input"
        }`}
      >
        {checked && <CheckIcon className="size-3" weight="bold" />}
      </span>
      <span
        className={`text-xs leading-snug ${dim && !checked ? "text-muted-foreground" : ""}`}
      >
        {children}
      </span>
    </button>
  );
}

/** A read-only set of diff lines, rendered as readable prose rows (not chips):
 *  these are scraped page lines (headings, copy, CTAs), not discrete tags. */
function ValueView({ lines, muted }: { lines: string[]; muted?: boolean }) {
  if (lines.length === 0) {
    return <p className="text-sm italic text-muted-foreground">empty</p>;
  }
  return (
    <div className="space-y-1.5">
      {lines.map((l, i) => (
        <p
          key={i}
          className={`text-sm leading-relaxed break-words ${
            muted ? "text-muted-foreground" : "text-foreground"
          }`}
        >
          {l}
        </p>
      ))}
    </div>
  );
}

/** A single change line. `added`/`removed` get a +/− marker and diff color;
 *  `plain` (a reorder with no net change) renders without a marker. A trailing
 *  scraped URL becomes a real "View" link instead of dead "Learn more →" text. */
function DiffRow({ item, kind }: { item: DiffItem; kind: "added" | "removed" | "plain" }) {
  return (
    <li className="flex items-baseline gap-2">
      {kind !== "plain" && (
        <span
          aria-hidden
          className={`shrink-0 select-none text-sm font-medium leading-relaxed ${
            kind === "added" ? "text-positive" : "text-muted-foreground"
          }`}
        >
          {kind === "added" ? "+" : "−"}
        </span>
      )}
      <span
        className={`min-w-0 break-words text-sm leading-relaxed ${
          kind === "removed" ? "text-muted-foreground line-through" : "text-foreground"
        }`}
      >
        {item.text}
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1.5 inline-flex items-center gap-0.5 align-baseline text-dense font-medium text-link no-underline hover:underline"
          >
            View
            <ArrowUpRightIcon className="size-3" />
          </a>
        )}
      </span>
    </li>
  );
}

/** A labelled, accent-bordered group of added or removed items. */
function DiffGroup({
  title,
  items,
  kind,
}: {
  title: string;
  items: DiffItem[];
  kind: "added" | "removed";
}) {
  if (items.length === 0) return null;
  const added = kind === "added";
  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 text-meta font-medium">
        <span className={added ? "text-positive" : "text-muted-foreground"}>{title}</span>
        <span className="text-[var(--muted-2)]">{items.length}</span>
      </div>
      <ul className={`space-y-1.5 border-l-2 pl-3 ${added ? "border-positive/40" : "border-border"}`}>
        {items.map((it, i) => (
          <DiffRow key={`${it.text}-${i}`} item={it} kind={kind} />
        ))}
      </ul>
    </section>
  );
}

function ReviewBody({
  change,
  acting,
  onResolve,
}: {
  change: SelfProductChange;
  acting: boolean;
  onResolve: ResolveFn;
}) {
  const label = FIELD_LABELS[change.fieldPath] ?? change.fieldPath;
  const editable = isEditable(change);
  const isArray = editable && ARRAY_FIELDS.has(change.fieldPath);
  // Cleaned net diff for the read-only (pipeline) view.
  const net = !editable ? netDiff(change) : null;
  const saved = asLines(change.previousValue);
  const detected = dedupe(asLines(change.newValue));
  const detectedKeys = new Set(detected.map(norm));
  const savedOnly = dedupe(saved.filter((s) => !detectedKeys.has(norm(s))));

  // Array merge selection: detected default kept, saved-only default dropped.
  const [detSel, setDetSel] = useState<Set<string>>(new Set(detected.map(norm)));
  const [keepSel, setKeepSel] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);
  const [draft, setDraft] = useState("");

  // String edit buffer (prefilled with the detected value).
  const detectedText = asLines(change.newValue).join("\n");
  const [text, setText] = useState(detectedText);

  const toggle = (set: Set<string>, k: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(k);
    else next.delete(k);
    return next;
  };
  const addExtra = () => {
    const v = draft.trim();
    if (!v) return;
    if ([...detected, ...savedOnly, ...extra].some((x) => norm(x) === norm(v))) {
      setDraft("");
      return;
    }
    setExtra((xs) => [...xs, v]);
    setDraft("");
  };

  const finalList = dedupe([
    ...detected.filter((d) => detSel.has(norm(d))),
    ...savedOnly.filter((s) => keepSel.has(norm(s))),
    ...extra,
  ]);

  function accept() {
    if (isArray) {
      const curated = !sameSet(finalList, detected);
      void onResolve(change, "accept", curated ? finalList : undefined);
    } else if (editable) {
      const final = text.trim();
      const curated = final !== detectedText.trim();
      void onResolve(change, "accept", curated ? final : undefined);
    } else {
      void onResolve(change, "accept");
    }
  }

  const acceptDisabled = acting || (isArray && finalList.length === 0);

  return (
    <>
      <SheetHeader className="gap-1.5 px-5 pb-4 pt-5">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={`size-2 rounded-full ${
              change.severity === "major" ? "bg-destructive" : "bg-muted-foreground/40"
            }`}
          />
          <SheetTitle className="text-content">{label}</SheetTitle>
          <Badge
            variant={change.severity === "major" ? "destructive" : "secondary"}
            className="h-4 px-1.5 text-meta font-medium"
          >
            {change.severity}
          </Badge>
        </div>
        <SheetDescription className="text-sm">
          {change.summary ?? "Change detected on your site."}{" "}
          <span className="text-[var(--muted-2)]">
            · {formatDistanceToNow(new Date(change.detectedAt), { addSuffix: true })}
          </span>
        </SheetDescription>
      </SheetHeader>
      <Separator />

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isArray ? (
          <div className="space-y-5">
            <section>
              <SectionLabel>Detected on your site</SectionLabel>
              {detected.length === 0 ? (
                <p className="text-sm text-[var(--muted-2)]">Nothing detected.</p>
              ) : (
                <div className="space-y-0.5">
                  {detected.map((item) => (
                    <ToggleItem
                      key={item}
                      checked={detSel.has(norm(item))}
                      onToggle={(next) => setDetSel((s) => toggle(s, norm(item), next))}
                    >
                      {item}
                    </ToggleItem>
                  ))}
                </div>
              )}
            </section>

            {savedOnly.length > 0 && (
              <section>
                <SectionLabel>Keep from your saved version?</SectionLabel>
                <div className="space-y-0.5">
                  {savedOnly.map((item) => (
                    <ToggleItem
                      key={item}
                      checked={keepSel.has(norm(item))}
                      onToggle={(next) => setKeepSel((s) => toggle(s, norm(item), next))}
                      dim
                    >
                      {item}
                    </ToggleItem>
                  ))}
                </div>
              </section>
            )}

            {extra.length > 0 && (
              <section>
                <SectionLabel>Your additions</SectionLabel>
                <div className="flex flex-wrap gap-1.5">
                  {extra.map((item) => (
                    <span
                      key={item}
                      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-meta"
                    >
                      {item}
                      <button
                        type="button"
                        onClick={() => setExtra((xs) => xs.filter((x) => x !== item))}
                        aria-label={`Remove ${item}`}
                        className="text-[var(--muted-2)] hover:text-foreground"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </section>
            )}

            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addExtra();
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add your own…"
                className="h-8 text-xs"
              />
              <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
                <PlusIcon className="size-3.5" />
                Add
              </Button>
            </form>
          </div>
        ) : editable ? (
          <div className="space-y-4">
            {saved.length > 0 && (
              <section>
                <SectionLabel>Your saved version</SectionLabel>
                <ValueView lines={saved} muted />
              </section>
            )}
            <section>
              <SectionLabel>Detected on your site (editable)</SectionLabel>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                className="text-xs leading-relaxed"
              />
            </section>
          </div>
        ) : net && (net.addedOnly.length > 0 || net.removedOnly.length > 0) ? (
          <div className="space-y-5">
            <DiffGroup title="Added" items={net.addedOnly} kind="added" />
            <DiffGroup title="Removed" items={net.removedOnly} kind="removed" />
          </div>
        ) : net && net.added.length > 0 ? (
          // Same items on both sides — content was reordered or lightly reworded.
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              No items were added or removed. The existing content was reordered.
            </p>
            <ul className="space-y-1.5">
              {net.added.map((it, i) => (
                <DiffRow key={`${it.text}-${i}`} item={it} kind="plain" />
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            No readable detail for this change.
          </p>
        )}

        {change.severity === "major" && (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-border bg-accent/50 px-3 py-2.5 text-sm text-muted-foreground">
            <WarningIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            Major change. Accepting it may flag some competitors for re-evaluation.
          </div>
        )}
      </div>

      <Separator />
      <SheetFooter className="flex-row gap-2 px-5 py-4">
        <Button onClick={accept} disabled={acceptDisabled} className="flex-1">
          {isArray
            ? `Accept ${finalList.length} item${finalList.length === 1 ? "" : "s"}`
            : "Accept"}
        </Button>
        <Button
          variant="outline"
          onClick={() => void onResolve(change, "ignore")}
          disabled={acting}
        >
          Ignore
        </Button>
      </SheetFooter>
    </>
  );
}
