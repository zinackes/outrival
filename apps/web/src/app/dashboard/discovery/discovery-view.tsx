"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  XIcon,
  PlusIcon,
  SpinnerIcon,
  ArrowSquareOutIcon,
  TrashIcon,
  ArrowCounterClockwiseIcon,
  ArchiveIcon,
  BinocularsIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
  CaretRightIcon,
} from "@/components/icons";
import { EmptyState } from "@/components/dashboard/empty-state";
import { toast } from "sonner";
import { DISCOVERY_REGIONS } from "@outrival/shared";
import {
  ApiError,
  api,
  type AddedCandidate,
  type CompetitorCandidate,
  type DiscoveryBasis,
} from "@/lib/api";
import {
  addedCandidatesQuery,
  candidatesQuery,
  discoveryStalenessQuery,
  competitorsQuery,
  productsListQuery,
} from "@/lib/queries";
import { toastApiError } from "@/lib/error-helpers";
import { ListError } from "@/components/outrival/list-error";
import {
  PaywallDialog,
  paywallFromError,
  tierLimitFromError,
  type PaywallReason,
} from "@/components/outrival/paywall-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DetectionConfigSheet } from "@/components/outrival/detection-config-sheet";
import { PageHead } from "@/components/dashboard/page-head";
import { useSetAskContext } from "@/components/dashboard/ask-context";
import { CompAvatar } from "@/components/dashboard/comp-avatar";
import { useProductScope } from "@/components/dashboard/product-scope-provider";
import { TableSkeleton } from "@/components/dashboard/skeletons";
import { competitorNameColor } from "@/lib/competitor-color";
import { formatDate, shortAge } from "@/lib/format-date";
import { cn, isValidHttpUrl, prettyUrl } from "@/lib/utils";
import { disclosureMotion, feedItemMotion } from "@/lib/motion";

type Tab = "queue" | "dismissed" | "added";

// Score bands. Above 80 the scorer is saying "same buyer, same job"; 60 to 79 is
// adjacency (one shared surface, or the same promise sold to someone else); below 60
// it kept the row for the record. Bands replace the old sort + min-overlap toggles:
// the ranking already IS the reading, so the controls only re-stated it.
const STRONG_MIN = 80;
const WORTH_MIN = 60;

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

const NUMBER_WORDS = [
  "No",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
];

/** Small counts read as words in a sentence, larger ones as digits. */
function count(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function candidateName(c: { title: string | null; url: string }): string {
  return c.title?.trim() || prettyUrl(c.url);
}

/**
 * The collapsed weak band still names what it is hiding. A count alone ("3 weak
 * matches") asks the user to expand to find out whether anything real is in there.
 */
function summariseWeak(items: CompetitorCandidate[]): string {
  const named = items
    .slice(0, 3)
    .map((c) => `${candidateName(c)} (${Math.round(c.overlapScore ?? 0)})`);
  const rest = items.length - named.length;
  const list =
    named.length > 1
      ? `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`
      : named.join("");
  return rest > 0 ? `${list}, and ${rest} more.` : `${list}.`;
}

function band(score: number | null): "strong" | "worth" | "weak" {
  const s = score ?? 0;
  if (s >= STRONG_MIN) return "strong";
  if (s >= WORTH_MIN) return "worth";
  return "weak";
}

/* -------------------------------------------------------------------------- */
/* The reading                                                                 */
/*                                                                             */
/* Computed from the rows on screen, never generated: the queue's own numbers   */
/* say what it means, and the rail underneath prints every number the sentence  */
/* is made of, so the claim can be checked against it.                          */
/* -------------------------------------------------------------------------- */

function readQueue(
  items: CompetitorCandidate[],
  seats: { used: number; limit: number } | null,
  productName: string,
): { lead: string; follow: string | null } {
  const total = items.length;
  const strong = items.filter((c) => band(c.overlapScore) === "strong").length;
  const free = seats ? Math.max(0, seats.limit - seats.used) : null;

  // One candidate is a sentence about that candidate, not about a batch, so the
  // whole clause changes rather than the noun taking an "(s)".
  const opening = `${count(total)} ${plural(total, "company", "companies")} ${total === 1 ? "is" : "are"} waiting on review`;
  const verdict =
    strong === 0
      ? total === 1
        ? `it does not clear ${STRONG_MIN}`
        : `none of them clears ${STRONG_MIN}`
      : strong === total
        ? total === 1
          ? `it overlaps ${productName} above ${STRONG_MIN}`
          : `all of them overlap ${productName} above ${STRONG_MIN}`
        : `${count(strong).toLowerCase()} of them ${strong === 1 ? "overlaps" : "overlap"} ${productName} above ${STRONG_MIN}`;
  const lead = `${opening}, and ${verdict}.`;

  if (free === null) return { lead, follow: null };
  if (free === 0) {
    return {
      lead,
      follow: "Every competitor seat is taken, so tracking one means freeing a seat first.",
    };
  }
  if (strong === 0) {
    return {
      lead,
      follow: `A batch to skim rather than one to spend seats on: ${free} of your ${seats!.limit} are free.`,
    };
  }
  if (strong > free) {
    return {
      lead,
      follow: `You have room for ${count(free).toLowerCase()} of them, so the top of the band is the decision.`,
    };
  }
  if (strong === free) {
    return {
      lead,
      follow: `Taking ${strong === 1 ? "it" : `all ${count(strong).toLowerCase()}`} would use every free seat you have.`,
    };
  }
  return {
    lead,
    follow: `Taking ${strong === 1 ? "it" : `all ${count(strong).toLowerCase()}`} would leave ${count(free - strong).toLowerCase()} of your ${seats!.limit} competitor seats.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * What the search ran on, as the source note under the reading. When a scan comes
 * back with junk the fix is one of these values, and every one of them used to be
 * invisible behind a "Configure" sheet.
 */
function ProvenanceLine({ basis }: { basis: DiscoveryBasis | null }) {
  const parts: string[] = [];
  if (basis?.category) parts.push(`as ${basis.category}`);
  if (basis?.audience) parts.push(`for ${basis.audience}`);
  if (basis?.keywords.trim()) parts.push(`plus your terms “${basis.keywords.trim()}”`);
  const region = basis?.region
    ? (DISCOVERY_REGIONS.find((r) => r.code === basis.region)?.label ?? null)
    : null;
  parts.push(region ? `biased toward ${region}` : "worldwide");
  if (basis && basis.excludedDomains > 0) {
    parts.push(
      `with ${basis.excludedDomains} ${plural(basis.excludedDomains, "domain")} excluded`,
    );
  }

  return (
    <p className="m-0 max-w-[84ch] text-dense text-muted-foreground">
      Searched {parts.join(", ")}.
    </p>
  );
}

/** The numbers the reading is made of. Mono, tabular, hairline-separated. */
function NumberRail({
  cells,
}: {
  cells: { label: string; value: string; sub?: string; tone?: "warn" }[];
}) {
  return (
    <div className="flex flex-wrap items-stretch">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={cn(
            "flex flex-col gap-0.5 px-[18px]",
            i === 0 ? "border-l-0 pl-0" : "border-l border-border",
          )}
        >
          <span className="text-meta text-muted-foreground">{cell.label}</span>
          <span
            className={cn(
              "text-lg tabular-nums tracking-tight",
              cell.tone === "warn" && "text-medium",
            )}
          >
            {cell.value}
            {cell.sub && (
              <span className="ml-1 text-dense text-muted-foreground">{cell.sub}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The overlap score: a mono number over a 2px meter, never a wide accent bar. */
function ScoreMeter({ score }: { score: number | null }) {
  const value = score != null ? Math.round(score) : null;
  return (
    <span className="flex flex-col gap-1">
      <span
        className={cn(
          "text-base tabular-nums tracking-tight",
          value != null && value < WORTH_MIN ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {value ?? "--"}
      </span>
      <span className="block h-0.5 w-full overflow-hidden rounded-full bg-border">
        <span
          className={cn(
            "block h-full",
            value != null && value < WORTH_MIN ? "bg-border-strong" : "bg-muted-foreground",
          )}
          style={{ width: `${value ?? 0}%` }}
        />
      </span>
    </span>
  );
}

function BandHead({
  title,
  range,
  aside,
}: {
  title: string;
  range: string;
  aside?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-0.5 pb-2 pt-[18px]">
      <h3 className="m-0 text-sm font-semibold tracking-tight">{title}</h3>
      <span className="text-meta text-muted-foreground tabular-nums">{range}</span>
      {aside && <span className="ml-auto text-dense text-muted-foreground">{aside}</span>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Candidate row                                                               */
/* -------------------------------------------------------------------------- */

const ROW_GRID =
  "grid items-center gap-x-3.5 grid-cols-[2.6rem_minmax(0,1fr)_7.5rem] @3xl:grid-cols-[2.6rem_minmax(0,14rem)_minmax(0,1fr)_2.6rem_7.5rem]";

function CandidateRow({
  candidate,
  tab,
  open,
  busy,
  productLabel,
  onToggle,
  onTrack,
  onDismiss,
  onRestore,
  onDelete,
}: {
  candidate: CompetitorCandidate;
  tab: Tab;
  open: boolean;
  busy: boolean;
  productLabel: string | null;
  onToggle: () => void;
  onTrack: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const name = candidateName(candidate);
  const dismissed = tab === "dismissed";

  // J and K walk the list without leaving the keyboard, T and XIcon settle the row.
  // The row is a div, not a button: it carries buttons of its own.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
      return;
    }
    if (e.key === "j" || e.key === "k") {
      e.preventDefault();
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>("[data-candidate-row]"),
      );
      const i = rows.indexOf(e.currentTarget);
      rows[e.key === "j" ? i + 1 : i - 1]?.focus();
      return;
    }
    if (busy) return;
    if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      if (dismissed) onRestore();
      else onTrack();
    }
    if (e.key === "x" || e.key === "X") {
      e.preventDefault();
      if (!dismissed) onDismiss();
    }
  }

  return (
    <div className="border-t border-border">
      <div
        data-candidate-row
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        className={cn(
          ROW_GRID,
          "group cursor-pointer py-2.5 pl-0.5 pr-2 transition-colors hover:bg-surface-2",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          open && "bg-surface-2",
        )}
      >
        <ScoreMeter score={candidate.overlapScore} />

        <span className="flex min-w-0 items-center gap-2.5">
          <CompAvatar name={name} url={candidate.url} size={22} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium tracking-tight">{name}</span>
            <span className="truncate font-mono text-meta text-muted-foreground">
              {prettyUrl(candidate.url)}
            </span>
          </span>
        </span>

        <span className="hidden truncate text-dense text-muted-foreground @3xl:block">
          {candidate.snippet?.trim() || candidate.reason || "No description captured."}
        </span>

        <span className="hidden justify-self-end text-meta text-muted-foreground tabular-nums @3xl:block">
          {shortAge(candidate.firstSeenAt)}
        </span>

        <span className="flex items-center justify-end gap-1">
          {productLabel && (
            <span className="hidden max-w-[7rem] truncate rounded-sm border border-border px-1.5 py-0.5 text-meta text-muted-foreground @5xl:inline">
              {productLabel}
            </span>
          )}
          {dismissed ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore();
                }}
              >
                <ArrowCounterClockwiseIcon size={16} />
                Restore
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    disabled={busy}
                    aria-label={`Delete ${name} permanently`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete();
                    }}
                  >
                    <TrashIcon size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete permanently</TooltipContent>
              </Tooltip>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={busy}
                className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onTrack();
                }}
              >
                {busy ? <SpinnerIcon size={16} className="animate-spin" /> : <PlusIcon size={16} />}
                Track
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-muted-foreground"
                    disabled={busy}
                    aria-label={`Dismiss ${name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss();
                    }}
                  >
                    <XIcon size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Dismiss</TooltipContent>
              </Tooltip>
            </>
          )}
        </span>
      </div>

      {/* The evidence used to appear in one frame while the row's `layout` spring was
          still projecting the old box over the new one, which stretched the row and
          its text as it opened. It opens on the feed's spring now, and the row keeps
          only its POSITION animated (see the wrappers), so nothing is scaled. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div {...disclosureMotion}>
            <Evidence candidate={candidate} name={name} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The four things you would otherwise open a browser tab to find out. The decision
 * repeats at the bottom, where it belongs once the case has been made.
 */
function Evidence({
  candidate,
  name,
}: {
  candidate: CompetitorCandidate;
  name: string;
}) {
  const rows: { key: string; value: React.ReactNode }[] = [];
  if (candidate.snippet?.trim()) {
    rows.push({
      key: "What it does",
      value: (
        <>
          {candidate.snippet.trim()}
          <span className="mt-1 block text-dense text-muted-foreground">
            Captured from {prettyUrl(candidate.url)} when it was discovered.
          </span>
        </>
      ),
    });
  }
  if (candidate.reason) {
    rows.push({ key: "Why it surfaced", value: candidate.reason });
  }
  rows.push({
    key: "Found by",
    value: (
      <span className="text-muted-foreground">
        {candidate.source === "onboarding"
          ? "Your setup search, left unselected"
          : "Automatic detection"}
        {", first seen "}
        {formatDate(candidate.firstSeenAt, { day: "numeric", month: "short" })}
        {candidate.overlapScore != null &&
          `, scored ${Math.round(candidate.overlapScore)} out of 100`}
      </span>
    ),
  });

  return (
    <div className="bg-surface-2 pb-4 pl-[3.4rem] pr-3 pt-1">
      <dl className="grid max-w-[74ch] grid-cols-1 gap-x-4 gap-y-2 @xl:grid-cols-[7.5rem_minmax(0,1fr)]">
        {rows.map((r) => (
          <div key={r.key} className="contents">
            <dt className="pt-0.5 text-meta text-muted-foreground">{r.key}</dt>
            <dd className="m-0 text-sm">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3.5">
        <Button variant="outline" size="sm" asChild>
          <a href={candidate.url} target="_blank" rel="noopener noreferrer">
            Open {prettyUrl(candidate.url)}
            <ArrowSquareOutIcon size={16} />
          </a>
        </Button>
        <span className="sr-only">Evidence for {name}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Added tab                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What the queue actually bought. A seat that has captured nothing in weeks is the
 * one thing the old page could never tell you, and it is the argument for reviewing
 * the next batch at all.
 */
function AddedRow({ item }: { item: AddedCandidate }) {
  const name = item.competitor?.name ?? candidateName(item);
  const url = item.competitor?.url ?? item.url;
  const body = (
    <>
      <span
        className="flex min-w-0 items-center gap-2.5"
        style={competitorNameColor(item.competitor?.color ?? null)}
      >
        <CompAvatar name={name} url={url} size={22} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium tracking-tight">{name}</span>
          <span className="truncate font-mono text-meta text-muted-foreground">
            {prettyUrl(url ?? "")}
          </span>
        </span>
      </span>
      <span className="hidden truncate text-dense text-muted-foreground @3xl:block">
        {item.competitor === null
          ? "Tracked, then removed from the workspace."
          : item.signalCount === 0
            ? "Nothing captured yet."
            : `Last captured ${shortAge(item.lastSignalAt ?? item.competitor.addedAt)} ago.`}
      </span>
      <span className="hidden justify-self-end text-meta text-muted-foreground tabular-nums @3xl:block">
        {item.competitor ? `${shortAge(item.competitor.addedAt)} ago` : ""}
      </span>
      <span
        className={cn(
          "justify-self-end text-dense tabular-nums",
          item.signalCount === 0 ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {item.signalCount} {plural(item.signalCount, "signal")}
      </span>
    </>
  );

  const grid =
    "grid items-center gap-x-3.5 border-t border-border py-3 pl-0.5 pr-2 grid-cols-[minmax(0,1fr)_5.5rem] @3xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_5rem_5.5rem]";

  if (!item.competitor) return <div className={grid}>{body}</div>;
  return (
    <Link
      href={`/dashboard/competitors/${item.competitor.id}`}
      className={cn(
        grid,
        "transition-colors hover:bg-surface-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      {body}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Add by URL                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Discovery is where the competitive set grows, so the manual path lives here too:
 * a company you already know does not need a scan to be tracked.
 */
function AddByUrlDialog({
  open,
  onOpenChange,
  onPaywall,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaywall: (reason: PaywallReason) => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const productId = useProductScope() ?? undefined;
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setUrl("");
      setSaving(false);
    }
  }, [open]);

  const normalized = url.trim().startsWith("http") ? url.trim() : `https://${url.trim()}`;
  const valid = url.trim().length > 0 && isValidHttpUrl(normalized);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const host = new URL(normalized).hostname.replace(/^www\./, "");
      const { competitor } = await api.createCompetitor({
        name: host.split(".")[0]!.replace(/^./, (ch) => ch.toUpperCase()),
        url: normalized,
        productId,
      });
      void queryClient.invalidateQueries({ queryKey: competitorsQuery().queryKey });
      router.refresh();
      onOpenChange(false);
      toast.success(`${competitor.name} is now tracked`, {
        description: "Its homepage, pricing and blog are being captured now.",
        action: {
          label: "Open",
          onClick: () => router.push(`/dashboard/competitors/${competitor.id}`),
        },
      });
    } catch (err) {
      const reason = paywallFromError(err);
      if (reason) {
        onOpenChange(false);
        onPaywall(reason);
      } else {
        toastApiError(err, { title: "Couldn't add the competitor" });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Add a competitor</DialogTitle>
            <DialogDescription>
              Paste a company URL. Monitoring starts on its homepage, pricing and blog,
              and it takes one competitor seat.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="discovery-add-url">Company URL</Label>
            <Input
              id="discovery-add-url"
              autoFocus
              placeholder="competitor.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving && <SpinnerIcon size={16} className="animate-spin" />}
              Track it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* View                                                                        */
/* -------------------------------------------------------------------------- */

export function DiscoveryView() {
  useSetAskContext({ kind: "view", label: "Competitor discovery" });
  const queryClient = useQueryClient();
  const router = useRouter();
  // patch-28 — discovery is product-scoped: the active product (cookie / URL override)
  // drives which SKU's review queue and staleness are shown. undefined ("all products")
  // → the API unions every SKU's queue (and a scan spans them all).
  const productId = useProductScope() ?? undefined;
  // A set, not a single id: tracking/removing runs per-row and users fire several
  // in a row before the first resolves — a scalar would drop the loader on all but
  // the last-clicked row.
  const [actingIds, setActingIds] = useState<Set<string>>(() => new Set());
  const startActing = (id: string) => setActingIds((s) => new Set(s).add(id));
  const stopActing = (id: string) =>
    setActingIds((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  const [paywall, setPaywall] = useState<PaywallReason | null>(null);
  const [scanning, setScanning] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("queue");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showWeak, setShowWeak] = useState(false);
  // Read the live tab inside async callbacks (a toast's Undo can fire after a switch).
  const tabRef = useRef<Tab>("queue");

  // The queue list stays loaded on every tab: it carries the counts, the seats and
  // the search basis the reading is made of, and the reading heads all three tabs.
  const listStatus = tab === "dismissed" ? "dismissed" : "new";
  const candidatesQ = useQuery(candidatesQuery(listStatus, productId));
  const items = candidatesQ.data?.candidates ?? null;
  const counts = candidatesQ.data?.counts ?? null;
  const seats = candidatesQ.data?.seats ?? null;
  const basis = candidatesQ.data?.basis ?? null;
  const error = candidatesQ.error;
  const stalenessQ = useQuery(discoveryStalenessQuery(productId));
  const staleness = stalenessQ.data ?? null;
  const discoveryFresh = staleness ? !staleness.needsRediscovery : false;
  const addedQ = useQuery({ ...addedCandidatesQuery(productId), enabled: tab === "added" });

  // Product provenance (patch-28): in "all products" scope a candidate can belong to any
  // SKU, so the mixed list needs a per-row label to stay legible. Only worth showing when
  // it adds signal — the all-products view AND the org actually juggles >1 non-archived
  // product. Reuses the same query the scope switcher already runs (cached, no request).
  const productsQ = useQuery(productsListQuery());
  const productNames = useMemo(
    () => new Map((productsQ.data ?? []).map((p) => [p.id, p.name])),
    [productsQ.data],
  );
  const liveProducts = (productsQ.data ?? []).filter((p) => p.status !== "archived");
  const showProductBadge = productId === undefined && liveProducts.length > 1;
  const productName =
    (productId ? productNames.get(productId) : undefined) ??
    (liveProducts.length === 1 ? liveProducts[0]!.name : null) ??
    "your product";

  // Rewrite the active tab's cached candidates / counts so the optimistic mutations
  // (and their rollbacks) below keep working.
  function setItems(
    updater: (prev: CompetitorCandidate[] | null) => CompetitorCandidate[] | null,
  ) {
    const key = candidatesQuery(
      tabRef.current === "dismissed" ? "dismissed" : "new",
      productId,
    ).queryKey;
    queryClient.setQueryData(key, (d) =>
      d ? { ...d, candidates: updater(d.candidates) ?? [] } : d,
    );
  }
  // Keep the tab badges in sync with optimistic mutations (a server reload only
  // happens on tab switch / scan). Clamps at 0 so a race can't show a negative.
  function bumpCounts(delta: { new?: number; dismissed?: number; added?: number }) {
    const key = candidatesQuery(
      tabRef.current === "dismissed" ? "dismissed" : "new",
      productId,
    ).queryKey;
    queryClient.setQueryData(key, (d) =>
      d
        ? {
            ...d,
            counts: {
              new: Math.max(0, d.counts.new + (delta.new ?? 0)),
              dismissed: Math.max(0, d.counts.dismissed + (delta.dismissed ?? 0)),
              added: Math.max(0, d.counts.added + (delta.added ?? 0)),
            },
          }
        : d,
    );
  }

  // Intelligent rate limiting (patch-22): re-running discovery when nothing changed
  // is friction, not blocked. If the last run is recent and the profile is unchanged,
  // nudge the user to edit their profile instead — but let them search anyway.
  function requestDetection() {
    if (discoveryFresh) {
      toast.info("Nothing has changed since the last scan", {
        description:
          "Same profile, same search, so new companies are unlikely. Widening the keywords or the region is what changes the result.",
        action: { label: "Scan anyway", onClick: () => void runDetection() },
      });
      return;
    }
    void runDetection();
  }

  async function runDetection() {
    setScanning(true);
    try {
      const { detected } = await api.detectCandidates(productId);
      void queryClient.invalidateQueries({
        queryKey: discoveryStalenessQuery(productId).queryKey,
      });
      // New candidates land in the review queue — make sure that's what's shown.
      if (tabRef.current === "queue") {
        await queryClient.invalidateQueries({
          queryKey: candidatesQuery("new", productId).queryKey,
        });
      } else {
        setTab("queue");
      }
      if (detected > 0) {
        toast.success(`${detected} new ${plural(detected, "company", "companies")} to review`);
      } else {
        toast.info("No company we haven't already shown you", {
          description:
            "The search ran on the same profile. Widening the keywords or the region is what changes the result.",
          action: { label: "Adjust", onClick: () => setConfigOpen(true) },
        });
      }
    } catch (e) {
      const tierLimit = tierLimitFromError(e);
      if (tierLimit) {
        // Monthly discovery quota (per tier) — not the short anti-spam cooldown.
        const limit = tierLimit.limit ?? 0;
        toast.error("Monthly scan limit reached", {
          description: `Your plan includes ${limit} ${plural(limit, "scan")} per month. It resets next month.`,
          action: tierLimit.upgradeHint
            ? {
                label: "View plans",
                onClick: () => {
                  window.location.href = "/dashboard/settings/billing";
                },
              }
            : undefined,
        });
      } else if (e instanceof ApiError && e.status === 429) {
        const retryInSec = Number(e.data.retryInSec) || 0;
        const mins = Math.max(1, Math.ceil(retryInSec / 60));
        toast.error(`Try again in ~${mins} min`, {
          description: "Scanning is rate-limited to avoid excess API costs.",
        });
      } else if (e instanceof ApiError && e.data.error === "missing_profile") {
        toast.error("This product needs a profile first", {
          description:
            "Add a URL or fill in the product's category and value prop to enable discovery.",
        });
      } else {
        toastApiError(e, { title: "Scan failed" });
      }
    } finally {
      setScanning(false);
    }
  }

  // Keep the live-tab ref in sync for async callbacks (the tab list itself
  // refetches via useQuery's key; staleness is its own query).
  useEffect(() => {
    tabRef.current = tab;
    setOpenId(null);
  }, [tab]);

  // Quality feedback (patch-21): tracking a suggestion is an implicit "useful"
  // verdict, dismissing it a "not useful" one. Best-effort — never block the
  // primary action on the feedback write.
  function recordDiscoveryFeedback(id: string, verdict: "useful" | "not_useful") {
    void api
      .submitQualityFeedback({ targetType: "discovery_suggestion", targetId: id, verdict })
      .catch(() => {});
  }

  async function add(item: CompetitorCandidate) {
    startActing(item.id);
    try {
      const { competitor } = await api.addCandidate(item.id);
      recordDiscoveryFeedback(item.id, "useful");
      void queryClient.invalidateQueries({ queryKey: competitorsQuery().queryKey });
      void queryClient.invalidateQueries({
        queryKey: addedCandidatesQuery(productId).queryKey,
      });
      // The switcher's competitor-usage count ("N/M seats") is server-rendered in the
      // dashboard layout — re-run it so the added competitor bumps the count live.
      router.refresh();
      setItems((prev) => prev?.filter((c) => c.id !== item.id) ?? null);
      bumpCounts({ new: -1, added: 1 });
      // Seats are the page's scarce resource, so spending one is stated, not implied.
      toast.success(`${competitor.name} is now tracked`, {
        description: "Its homepage, pricing and blog are being captured now.",
        action: {
          label: "Open",
          onClick: () => router.push(`/dashboard/competitors/${competitor.id}`),
        },
      });
    } catch (e) {
      const reason = paywallFromError(e);
      if (reason) {
        setPaywall(reason);
      } else {
        toastApiError(e, { title: "Couldn't add the competitor" });
      }
    } finally {
      stopActing(item.id);
    }
  }

  // Optimistic dismiss with an undo window (quick triage). The row leaves the list
  // immediately; the "not useful" feedback is only recorded once the toast auto-closes,
  // so an Undo within the window leaves no trace in the relevance learning.
  async function dismiss(id: string) {
    const item = items?.find((c) => c.id === id);
    if (!item) return;
    setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
    bumpCounts({ new: -1, dismissed: 1 });
    try {
      await api.dismissCandidate(id);
    } catch (e) {
      setItems((prev) => [...(prev ?? []), item]); // rollback
      bumpCounts({ new: 1, dismissed: -1 });
      toastApiError(e, { title: "Dismiss failed" });
      return;
    }
    toast(`${candidateName(item)} dismissed`, {
      description: "It won't be suggested again.",
      action: { label: "Undo", onClick: () => void undoDismiss([item]) },
      onAutoClose: () => recordDiscoveryFeedback(id, "not_useful"),
      duration: 6000,
    });
  }

  // Bulk dismiss (the weak band). No per-item feedback: clearing a band in one
  // gesture is a weaker signal than a deliberate single judgment.
  async function dismissMany(targets: CompetitorCandidate[]) {
    if (targets.length === 0) return;
    const idSet = new Set(targets.map((t) => t.id));
    setItems((prev) => prev?.filter((c) => !idSet.has(c.id)) ?? null);
    bumpCounts({ new: -targets.length, dismissed: targets.length });
    try {
      await api.dismissCandidates([...idSet]);
    } catch (e) {
      setItems((prev) => [...(prev ?? []), ...targets]); // rollback
      bumpCounts({ new: targets.length, dismissed: -targets.length });
      toastApiError(e, { title: "Dismiss failed" });
      return;
    }
    toast(`${targets.length} ${plural(targets.length, "suggestion")} dismissed`, {
      action: { label: "Undo", onClick: () => void undoDismiss(targets) },
      duration: 6000,
    });
  }

  // Send dismissed candidates back to the queue. Shared by the Undo toast and the
  // Restore button — the local effect depends on which list is showing, read fresh
  // via tabRef so a tab switch mid-window can't misplace a row.
  async function undoDismiss(targets: CompetitorCandidate[]) {
    const ids = new Set(targets.map((t) => t.id));
    try {
      await api.restoreCandidates([...ids]);
      bumpCounts({ new: ids.size, dismissed: -ids.size });
      setItems((prev) => {
        const base = prev ?? [];
        if (tabRef.current !== "dismissed") {
          const present = new Set(base.map((c) => c.id));
          return [...base, ...targets.filter((t) => !present.has(t.id))];
        }
        return base.filter((c) => !ids.has(c.id)); // no longer dismissed
      });
    } catch (e) {
      toastApiError(e, { title: "Undo failed" });
    }
  }

  // Explicit restore from the Dismissed tab: optimistic removal + a toast that jumps back.
  async function restore(item: CompetitorCandidate) {
    setItems((prev) => prev?.filter((c) => c.id !== item.id) ?? null);
    bumpCounts({ new: 1, dismissed: -1 });
    try {
      await api.restoreCandidates([item.id]);
    } catch (e) {
      setItems((prev) => [...(prev ?? []), item]); // rollback
      bumpCounts({ new: -1, dismissed: 1 });
      toastApiError(e, { title: "Restore failed" });
      return;
    }
    toast("Back in the review queue", {
      action: { label: "View", onClick: () => setTab("queue") },
    });
  }

  // Permanent delete from the Dismissed tab: the candidate row is destroyed (no undo,
  // unlike dismiss). Optimistic removal with rollback on failure.
  async function remove(item: CompetitorCandidate) {
    startActing(item.id);
    setItems((prev) => prev?.filter((c) => c.id !== item.id) ?? null);
    bumpCounts({ dismissed: -1 });
    try {
      await api.deleteCandidate(item.id);
      toast("Suggestion deleted");
    } catch (e) {
      setItems((prev) => [...(prev ?? []), item]); // rollback
      bumpCounts({ dismissed: 1 });
      toastApiError(e, { title: "Delete failed" });
    } finally {
      stopActing(item.id);
    }
  }

  if (error && items === null) return <ListError error={error} />;

  const ranked = [...(items ?? [])].sort(
    (a, b) => (b.overlapScore ?? -1) - (a.overlapScore ?? -1),
  );
  const bands = {
    strong: ranked.filter((c) => band(c.overlapScore) === "strong"),
    worth: ranked.filter((c) => band(c.overlapScore) === "worth"),
    weak: ranked.filter((c) => band(c.overlapScore) === "weak"),
  };
  const seatsFree = seats ? Math.max(0, seats.limit - seats.used) : null;
  const reading =
    tab === "dismissed" || ranked.length === 0
      ? null
      : readQueue(ranked, seats, productName);

  const rowProps = (c: CompetitorCandidate) => ({
    candidate: c,
    tab,
    open: openId === c.id,
    busy: actingIds.has(c.id),
    productLabel:
      showProductBadge && c.productId ? (productNames.get(c.productId) ?? null) : null,
    onToggle: () => setOpenId((prev) => (prev === c.id ? null : c.id)),
    onTrack: () => void add(c),
    onDismiss: () => void dismiss(c.id),
    onRestore: () => void restore(c),
    onDelete: () => void remove(c),
  });

  // The rows drop tracks as the content column narrows (the dashboard rail eats
  // ~256px), so they measure the column, not the viewport.
  return (
    <div className="@container space-y-5">
      <PaywallDialog reason={paywall} onClose={() => setPaywall(null)} />
      <AddByUrlDialog open={addOpen} onOpenChange={setAddOpen} onPaywall={setPaywall} />
      <DetectionConfigSheet
        open={configOpen}
        onOpenChange={setConfigOpen}
        onSaved={() =>
          void queryClient.invalidateQueries({ queryKey: ["candidates"] })
        }
      />

      <PageHead
        flush
        title="Discovery"
        sub="Companies worth watching, ranked against your product profile."
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label="Adjust the search"
                  onClick={() => setConfigOpen(true)}
                >
                  <SlidersHorizontalIcon size={16} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Adjust the search</TooltipContent>
            </Tooltip>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <PlusIcon size={16} />
              Add by URL
            </Button>
            <Button size="sm" onClick={requestDetection} disabled={scanning}>
              {scanning ? (
                <SpinnerIcon size={16} className="animate-spin" />
              ) : (
                <MagnifyingGlassIcon size={16} />
              )}
              {scanning ? "Scanning…" : "Scan for competitors"}
            </Button>
          </>
        }
      />

      {/* The reading, its source note, and the numbers both are made of. */}
      <div className="flex flex-col gap-3 border-b border-border pb-[18px]">
        {reading ? (
          <p className="m-0 max-w-[62ch] text-lead leading-snug tracking-tight text-pretty">
            <span className="font-medium">{reading.lead}</span>
            {reading.follow && (
              <span className="text-muted-foreground"> {reading.follow}</span>
            )}
          </p>
        ) : (
          <p className="m-0 max-w-[62ch] text-lead leading-snug tracking-tight">
            {items === null
              ? "Reading the review queue…"
              : tab === "dismissed"
                ? (counts?.dismissed ?? 0) === 0
                  ? "Nothing turned down yet."
                  : `${count(counts!.dismissed)} ${plural(counts!.dismissed, "company", "companies")} you turned down. Restoring one sends it back to review.`
                : "Nothing waiting on review."}
          </p>
        )}
        <ProvenanceLine basis={basis} />
        <NumberRail
          cells={[
            { label: "In queue", value: String(counts?.new ?? 0) },
            { label: "Strong match", value: String(bands.strong.length) },
            ...(seats
              ? [
                  {
                    label: "Seats free",
                    value: String(seatsFree),
                    sub: `of ${seats.limit}`,
                    tone: seatsFree === 0 ? ("warn" as const) : undefined,
                  },
                ]
              : []),
            ...(staleness
              ? [
                  {
                    label: "Scans left",
                    value: String(Math.max(0, staleness.scans.limit - staleness.scans.used)),
                    sub: `of ${staleness.scans.limit} this month`,
                  },
                ]
              : []),
            {
              label: "Last scan",
              value: staleness?.lastDiscoveryAt
                ? shortAge(staleness.lastDiscoveryAt)
                : "never",
              sub: staleness?.nextAutomaticAt
                ? `next ${formatDate(staleness.nextAutomaticAt, { weekday: "short" })}`
                : "automatic scans off",
            },
          ]}
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList variant="line" className="w-full justify-start">
          <TabsTrigger value="queue">
            Queue
            <span className="text-meta tabular-nums text-muted-foreground">
              {counts?.new ?? 0}
            </span>
          </TabsTrigger>
          <TabsTrigger value="dismissed">
            Dismissed
            <span className="text-meta tabular-nums text-muted-foreground">
              {counts?.dismissed ?? 0}
            </span>
          </TabsTrigger>
          <TabsTrigger value="added">
            Added
            <span className="text-meta tabular-nums text-muted-foreground">
              {counts?.added ?? 0}
            </span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {items === null && tab !== "added" && <TableSkeleton rows={6} columns={4} />}

      {/* Queue */}
      {tab === "queue" && items !== null && ranked.length === 0 && (
        <EmptyState
          icon={BinocularsIcon}
          tone="positive"
          title="Nothing waiting on review"
          description={
            counts && counts.added > 0
              ? `You have taken ${counts.added} ${plural(counts.added, "company", "companies")} from this queue. The next scan runs ${staleness?.nextAutomaticAt ? formatDate(staleness.nextAutomaticAt, { weekday: "long" }) : "on its own schedule"}.`
              : "New companies land here as they are found, and the next scan runs on its own schedule."
          }
          actions={
            <>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <PlusIcon size={16} />
                Add by URL
              </Button>
              {counts && counts.added > 0 && (
                <Button variant="outline" size="sm" onClick={() => setTab("added")}>
                  See what they captured
                  <CaretRightIcon size={16} />
                </Button>
              )}
            </>
          }
        />
      )}

      {tab === "queue" && ranked.length > 0 && (
        <div className="flex flex-col">
          {bands.strong.length > 0 && (
            <section>
              <BandHead
                title="Strong match"
                range={`${STRONG_MIN} and above`}
                aside={
                  seatsFree !== null
                    ? `${bands.strong.length} ${plural(bands.strong.length, "company", "companies")}, ${seatsFree} ${plural(seatsFree, "seat")} free`
                    : undefined
                }
              />
              <AnimatePresence initial={false} mode="popLayout">
                {bands.strong.map((c) => (
                  <motion.div key={c.id} {...feedItemMotion} layout="position">
                    <CandidateRow {...rowProps(c)} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </section>
          )}

          {bands.worth.length > 0 && (
            <section>
              <BandHead
                title="Worth a look"
                range={`${WORTH_MIN} to ${STRONG_MIN - 1}`}
                aside="Adjacent, or overlapping on one surface only"
              />
              <AnimatePresence initial={false} mode="popLayout">
                {bands.worth.map((c) => (
                  <motion.div key={c.id} {...feedItemMotion} layout="position">
                    <CandidateRow {...rowProps(c)} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </section>
          )}

          {bands.weak.length > 0 && (
            <section>
              <BandHead
                title="Weak"
                range={`below ${WORTH_MIN}`}
                aside="Kept for the record, never notified"
              />
              {showWeak ? (
                <AnimatePresence initial={false} mode="popLayout">
                  {bands.weak.map((c) => (
                    <motion.div key={c.id} {...feedItemMotion} layout="position">
                      <CandidateRow {...rowProps(c)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              ) : (
                <div className="flex flex-wrap items-center gap-2 border-t border-border py-3 text-dense text-muted-foreground">
                  <span>{summariseWeak(bands.weak)}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setShowWeak(true)}>
                      Show {bands.weak.length}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void dismissMany(bands.weak)}
                    >
                      Dismiss all {bands.weak.length}
                    </Button>
                  </span>
                </div>
              )}
            </section>
          )}

          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3.5 text-meta text-muted-foreground">
            <span>
              <Kbd>J</Kbd> <Kbd>K</Kbd> move
            </span>
            <span>
              <Kbd>↵</Kbd> evidence
            </span>
            <span>
              <Kbd>T</Kbd> track
            </span>
            <span>
              <Kbd>XIcon</Kbd> dismiss
            </span>
            <span className="ml-auto">
              Dismissing teaches the relevance threshold for the next scan.
            </span>
          </p>
        </div>
      )}

      {/* Dismissed */}
      {tab === "dismissed" && items !== null && (
        <div className="flex flex-col">
          {ranked.length === 0 ? (
            <EmptyState
              icon={ArchiveIcon}
              title="Nothing dismissed"
              description="Suggestions you turn down land here, and are never suggested again. You can restore any of them."
            />
          ) : (
            <AnimatePresence initial={false} mode="popLayout">
              {ranked.map((c) => (
                <motion.div key={c.id} {...feedItemMotion} layout="position">
                  <CandidateRow {...rowProps(c)} />
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      )}

      {/* Added */}
      {tab === "added" && (
        <div className="flex flex-col">
          {addedQ.isPending ? (
            <TableSkeleton rows={3} columns={4} />
          ) : (addedQ.data?.added.length ?? 0) === 0 ? (
            <EmptyState
              icon={BinocularsIcon}
              title="Nothing tracked from discovery yet"
              description="Companies you track from the queue land here with what they have captured since, so a seat that produces nothing is visible."
            />
          ) : (
            <section>
              <BandHead
                title="Added from discovery"
                range={`${addedQ.data!.added.length} ${plural(addedQ.data!.added.length, "company", "companies")}`}
                aside="What the queue bought you"
              />
              {addedQ.data!.added.map((item) => (
                <AddedRow key={item.id} item={item} />
              ))}
              {addedQ.data!.added.some((a) => a.competitor && a.signalCount === 0) && (
                <p className="border-t border-border pt-3 text-dense text-muted-foreground">
                  A seat that captures nothing is a seat you can spend elsewhere.
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-sm border border-b-2 border-border bg-surface px-1 py-px font-mono text-meta text-muted-foreground">
      {children}
    </kbd>
  );
}
