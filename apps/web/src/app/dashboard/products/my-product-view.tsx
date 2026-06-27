"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { myProductQuery, myProductChangesQuery } from "@/lib/queries";
import {
  RefreshCw,
  Loader2,
  Pencil,
  Check,
  X,
  Plus,
  Trash2,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  Store,
  ChevronDown,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { toastApiError, toastRescanLimit } from "@/lib/error-helpers";
import { formatDistanceToNow } from "date-fns";
import {
  api,
  type MyProduct,
  type MyProductJob,
  type MyProductPatch,
  type MyProductPricingTier,
  type MyProductRescanCategory,
  type SelfProfileField,
  type SelfProductChange,
} from "@/lib/api";
import { SelfChangesPanel } from "@/components/outrival/self-change-review";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { PageHead } from "@/components/dashboard/page-head";
import { useSetAskContext } from "@/components/dashboard/ask-context";
import { ChangeProductUrlDialog } from "@/components/outrival/change-product-url-dialog";
import { UpdateProfileDialog } from "@/components/outrival/update-profile-dialog";

const PRICING_LABELS: Record<string, string> = {
  public: "Public",
  public_partial: "Partially public",
  gated_demo: "Demo-gated",
  gated_signup: "Signup-gated",
  dynamic: "Dynamic / quote-based",
  unknown: "Unknown",
};

const mono = { fontFamily: "var(--font-mono)" } as const;

/** "Detected automatically" / "Edited by you N ago" badge for a profile field. */
function FieldMeta({ field }: { field?: SelfProfileField<unknown> }) {
  if (!field) return null;
  if (field.isFromAutoDetect) {
    return (
      <span className="text-meta text-[var(--muted-2)] inline-flex items-center gap-1">
        <Sparkles className="size-3" /> detected auto
      </span>
    );
  }
  return (
    <span className="text-meta text-[var(--muted-2)]">
      edited by you
      {field.lastEditedByUserAt
        ? ` ${formatDistanceToNow(new Date(field.lastEditedByUserAt), { addSuffix: true })}`
        : ""}
    </span>
  );
}

function EditableText({
  label,
  field,
  multiline,
  onSave,
}: {
  label: string;
  field?: SelfProfileField<string>;
  multiline?: boolean;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field?.value ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-start py-2">
      <div className="text-dense text-muted-foreground pt-1">{label}</div>
      <div className="min-w-0">
        {editing ? (
          <div className="flex flex-col gap-2">
            {multiline ? (
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
            ) : (
              <Input value={draft} onChange={(e) => setDraft(e.target.value)} />
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(field?.value ?? "");
                  setEditing(false);
                }}
                disabled={saving}
              >
                <X className="size-3.5" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-content break-words">
                {field?.value || <span className="text-[var(--muted-2)]">Not set</span>}
              </div>
              <div className="mt-0.5">
                <FieldMeta field={field} />
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => {
                setDraft(field?.value ?? "");
                setEditing(true);
              }}
            >
              <Pencil className="size-3.5" /> Edit
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function EditableList({
  label,
  field,
  onSave,
}: {
  label: string;
  field?: SelfProfileField<string[]>;
  onSave: (value: string[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState((field?.value ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const items = field?.value ?? [];

  async function save() {
    setSaving(true);
    try {
      const next = draft
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="bg-gradient-card-strong p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </h3>
          <FieldMeta field={field} />
        </div>
        {!editing && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setDraft(items.join("\n"));
              setEditing(true);
            }}
          >
            <Pencil className="size-3.5" /> Edit
          </Button>
        )}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.max(4, items.length + 1)}
            placeholder="One item per line"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              <X className="size-3.5" /> Cancel
            </Button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-[var(--muted-2)]">Nothing detected yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {items.map((it, i) => (
            <div key={`${it}-${i}`} className="flex items-center gap-2 text-content">
              <Check className="size-3.5 text-primary shrink-0" />
              <span className="break-words">{it}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const PRICING_STATUS_OPTIONS = Object.entries(PRICING_LABELS).map(([value, label]) => ({
  value,
  label,
}));

/** Editable pricing block: hand-entered tiers (sticky vs scrapes) plus status,
 * promo flag and note. Tiers are the only pricing surface with no source outside
 * scraped history, so without it the user can still maintain them by hand. */
function PricingCard({
  pricing,
  onSave,
}: {
  pricing: MyProduct["pricing"];
  onSave: (p: NonNullable<MyProductPatch["pricing"]>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tiers, setTiers] = useState<MyProductPricingTier[]>([]);
  const [status, setStatus] = useState("unknown");
  const [promotional, setPromotional] = useState(false);
  const [note, setNote] = useState("");

  function startEdit() {
    setTiers(pricing.tiers.map((t) => ({ ...t })));
    setStatus(pricing.status ?? "unknown");
    setPromotional(pricing.promotional);
    setNote(pricing.note ?? "");
    setEditing(true);
  }

  function setTier(i: number, patch: Partial<MyProductPricingTier>) {
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({
        status,
        promotional,
        note: note.trim() || null,
        tiers: tiers
          .filter((t) => t.plan_name.trim())
          .map((t) => ({
            plan_name: t.plan_name.trim(),
            price: Number.isFinite(t.price) ? t.price : 0,
            currency: (t.currency || "USD").trim(),
            billing_period: (t.billing_period || "monthly").trim(),
          })),
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="bg-gradient-card-strong p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground">
            Pricing
          </h3>
          {pricing.tiers.length > 0 && (
            <span className="text-meta text-[var(--muted-2)] inline-flex items-center gap-1">
              {pricing.tiersManual ? (
                <>
                  edited by you
                  {pricing.tiersEditedAt
                    ? ` ${formatDistanceToNow(new Date(pricing.tiersEditedAt), { addSuffix: true })}`
                    : ""}
                </>
              ) : (
                <>
                  <Sparkles className="size-3" /> detected auto
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing && pricing.promotional && (
            <Badge variant="secondary" className="text-meta">
              promo
            </Badge>
          )}
          {!editing && (
            <Badge variant="outline" className="text-meta">
              {PRICING_LABELS[pricing.status ?? "unknown"] ?? "Unknown"}
            </Badge>
          )}
          {!editing && (
            <Button size="sm" variant="ghost" onClick={startEdit}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={t.plan_name}
                  onChange={(e) => setTier(i, { plan_name: e.target.value })}
                  placeholder="Plan name"
                  className="flex-1"
                />
                <Input
                  type="number"
                  min={0}
                  value={t.price ?? 0}
                  onChange={(e) =>
                    setTier(i, { price: e.target.value === "" ? 0 : Number(e.target.value) })
                  }
                  placeholder="0"
                  className="w-24"
                />
                <Input
                  value={t.currency}
                  onChange={(e) => setTier(i, { currency: e.target.value })}
                  placeholder="USD"
                  className="w-20"
                />
                <Input
                  value={t.billing_period}
                  onChange={(e) => setTier(i, { billing_period: e.target.value })}
                  placeholder="monthly"
                  className="w-28"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => setTiers((ts) => ts.filter((_, idx) => idx !== i))}
                  aria-label="Remove tier"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="self-start"
              onClick={() =>
                setTiers((ts) => [
                  ...ts,
                  { plan_name: "", price: 0, currency: "USD", billing_period: "monthly" },
                ])
              }
            >
              <Plus className="size-3.5" /> Add tier
            </Button>
          </div>

          <div className="grid grid-cols-[140px_1fr] gap-3 items-center">
            <div className="text-dense text-muted-foreground">Pricing model</div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICING_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="text-dense text-muted-foreground">Note</div>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional context (e.g. enterprise only on request)"
            />

            <div className="text-dense text-muted-foreground">Promotional</div>
            <label className="inline-flex items-center gap-2 text-dense">
              <Checkbox
                checked={promotional}
                onCheckedChange={(v) => setPromotional(v === true)}
              />
              Pricing currently shows a promotion
            </label>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              <X className="size-3.5" /> Cancel
            </Button>
          </div>
        </div>
      ) : pricing.tiers.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {pricing.tiers.map((t, i) => (
            <div key={`${t.plan_name}-${i}`} className="flex items-center justify-between text-sm">
              <span>{t.plan_name}</span>
              <span style={mono} className="text-foreground">
                {t.price === null ? (
                  "Custom"
                ) : (
                  <>
                    {t.price === 0 ? "Free" : `${t.price} ${t.currency}`}
                    <span className="text-[var(--muted-2)]">/{t.billing_period}</span>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-dense text-[var(--muted-2)]">
          No pricing tiers yet.{" "}
          <button type="button" className="underline" onClick={startEdit}>
            Add them by hand
          </button>{" "}
          or re-scan your pricing page.
        </div>
      )}

      {!editing && (pricing.observedRegion || pricing.note) && (
        <div className="text-meta text-[var(--muted-2)] mt-2">
          {pricing.observedRegion ? `Seen from ${pricing.observedRegion}` : ""}
          {pricing.note ? ` · ${pricing.note}` : ""}
        </div>
      )}
    </Card>
  );
}

const RESCAN_CATEGORIES: { key: MyProductRescanCategory; label: string }[] = [
  { key: "profile", label: "Profile" },
  { key: "pricing", label: "Pricing" },
  { key: "features", label: "Features" },
  { key: "techStack", label: "Tech stack" },
  { key: "jobs", label: "Hiring" },
];

/** Re-scan control with selective targets. Picking cards re-scans only their sources
 * (Features + Tech stack share one homepage scrape server-side); "Everything" re-scans
 * every card shown here (homepage, pricing, jobs).
 * Shown for live products; repo/idea stages use a plain button. */
function RescanMenu({
  busy,
  onRescan,
}: {
  busy: boolean;
  onRescan: (categories?: MyProductRescanCategory[]) => void;
}) {
  const [selected, setSelected] = useState<Set<MyProductRescanCategory>>(new Set());
  const toggle = (key: MyProductRescanCategory) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {busy ? "Scanning…" : "Re-scan"}
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Re-scan only</DropdownMenuLabel>
        {RESCAN_CATEGORIES.map((cat) => (
          <DropdownMenuCheckboxItem
            key={cat.key}
            checked={selected.has(cat.key)}
            onCheckedChange={() => toggle(cat.key)}
            onSelect={(e) => e.preventDefault()}
          >
            {cat.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuItem
          disabled={selected.size === 0}
          onSelect={() => {
            onRescan([...selected]);
            setSelected(new Set());
          }}
        >
          Re-scan selected{selected.size > 0 ? ` (${selected.size})` : ""}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onRescan(RESCAN_CATEGORIES.map((c) => c.key))}>
          Everything
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Active job postings detected on the self product's site. Read-only: the page
 *  monitors the `jobs` source (and surfaces hiring changes for review), so the
 *  current openings belong here too. */
function JobsCard({ jobs }: { jobs: { total: number; items: MyProductJob[] } }) {
  return (
    <Card className="bg-gradient-card-strong p-4">
      <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground mb-1">
        <span className="inline-flex items-center gap-1.5">
          <Briefcase className="size-3.5" />
          Hiring{jobs.total > 0 ? ` (${jobs.total})` : ""}
        </span>
      </h3>
      <Separator className="mb-2" />
      {jobs.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open roles detected on your site yet.</p>
      ) : (
        <ul className="divide-y divide-border max-h-80 overflow-y-auto">
          {jobs.items.map((job) => (
            <li key={job.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{job.title}</p>
                {(job.department || job.location) && (
                  <p className="truncate text-dense text-muted-foreground">
                    {[job.department, job.location].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
              {job.url && (
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 text-dense font-medium text-link no-underline hover:underline"
                >
                  View
                  <ExternalLink className="size-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function MyProductView() {
  // Server-seeded on first paint (products/my-product/page.tsx). product is
  // undefined while loading, null when no product site is set yet (or on error).
  const queryClient = useQueryClient();
  const productQ = useQuery(myProductQuery());
  const changesQ = useQuery(myProductChangesQuery());
  const product = productQ.isError ? null : productQ.data;
  const changes = changesQ.data ?? [];
  const error = productQ.error;
  const [rescanning, setRescanning] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rediscover, setRediscover] = useState<{ reason: string } | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [enabling, setEnabling] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [trackingRepo, setTrackingRepo] = useState(false);
  const [changeUrlOpen, setChangeUrlOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  // Refresh both queries (called by the scan poller and after every mutation).
  async function load() {
    await Promise.all([productQ.refetch(), changesQ.refetch()]);
  }

  // Optimistic write-through for the pending-changes list (accept / ignore a change).
  function setChanges(updater: (prev: SelfProductChange[]) => SelfProductChange[]) {
    queryClient.setQueryData(
      myProductChangesQuery().queryKey,
      (prev: SelfProductChange[] | undefined) => updater(prev ?? []),
    );
  }

  // Scope Ask to the current product while its page is open.
  useSetAskContext(product ? { kind: "product", label: `My product: ${product.name}` } : null);

  // While a scan is in progress, poll until it settles, then refresh + toast the
  // outcome — so a re-scan visibly finishes instead of leaving the user guessing.
  const wasScanning = useRef(false);
  useEffect(() => {
    const scanning = product?.scanning ?? false;
    if (scanning) {
      wasScanning.current = true;
      const t = setInterval(() => load(), 4000);
      return () => clearInterval(t);
    }
    if (wasScanning.current) {
      wasScanning.current = false;
      if (product?.scanError) {
        toast.error("Scan failed", { description: product.scanError });
      } else {
        toast.success("Scan complete", { description: "Your profile is up to date." });
        // Profile-divergence proposals + features/tech stack are written by
        // downstream AI tasks (extract-self-profile, …) that finish a few seconds
        // AFTER scrapeStartedAt clears, so a single reload races them. Keep polling
        // a few more cycles to surface those late changes.
        let n = 0;
        const t = setInterval(() => {
          void load();
          if (++n >= 5) clearInterval(t);
        }, 4000);
        return () => clearInterval(t);
      }
    }
  }, [product?.scanning, product?.scanError]);

  async function patch(body: MyProductPatch) {
    await api.updateMyProduct(body);
    await load();
    toast.success("Profile updated");
  }

  async function enableMonitoring() {
    const url = siteUrl.trim();
    if (!url) return;
    setEnabling(true);
    try {
      await api.setMyProductSite(url);
      toast.success("Monitoring enabled", { description: "Your site will be scanned shortly." });
      setSiteUrl("");
      await load();
    } catch (e) {
      toastApiError(e, { title: "Couldn't enable monitoring" });
    } finally {
      setEnabling(false);
    }
  }

  async function trackRepo() {
    const url = repoUrl.trim();
    if (!url) return;
    setTrackingRepo(true);
    try {
      await api.setMyProductRepo(url);
      toast.success("Repo tracked", { description: "Its activity will be scanned shortly." });
      setRepoUrl("");
      await load();
    } catch (e) {
      toastApiError(e, { title: "Couldn't track repo" });
    } finally {
      setTrackingRepo(false);
    }
  }

  async function rescan(categories?: MyProductRescanCategory[]) {
    setRescanning(true);
    try {
      const res = await api.rescanMyProduct(categories);
      if (res.limitReached) {
        // Some sources ran, then the daily re-scan cap (patch-27) was hit.
        toast.warning("Re-scan partially started — daily re-scan limit reached.", {
          description: `Scanning ${res.monitors} source${res.monitors === 1 ? "" : "s"}; the rest resume on the next automatic check. The limit resets tomorrow.`,
          action: {
            label: "View plans",
            onClick: () => {
              window.location.href = "/dashboard/settings/billing";
            },
          },
        });
      } else {
        toast.success("Re-scan started", { description: "Scanning your sources now…" });
      }
      await load(); // pick up scanning=true so the progress poll kicks in
    } catch (e) {
      // The cap was already fully spent → friendly limit toast + upgrade nudge.
      if (!toastRescanLimit(e)) toastApiError(e, { title: "Re-scan failed" });
    } finally {
      setRescanning(false);
    }
  }

  async function resolve(
    change: SelfProductChange,
    action: "accept" | "ignore",
    value?: string | string[],
  ) {
    setActingId(change.id);
    try {
      if (action === "accept") {
        const { suggestion } = await api.acceptMyProductChange(change.id, value);
        if (suggestion?.action === "rediscover") setRediscover({ reason: suggestion.reason });
        toast.success("Change accepted");
      } else {
        await api.ignoreMyProductChange(change.id);
      }
      setChanges((cs) => cs.filter((c) => c.id !== change.id));
    } catch (e) {
      toastApiError(e, { title: "Action failed" });
    } finally {
      setActingId(null);
    }
  }

  async function launchRediscovery() {
    setDiscovering(true);
    try {
      const { detected } = await api.detectCandidates();
      toast.success(
        detected > 0
          ? `${detected} new competitor${detected > 1 ? "s" : ""} suggested`
          : "No new competitors found",
        { description: "Your existing competitors were kept and re-scored." },
      );
      setRediscover(null);
    } catch (e) {
      toastApiError(e, { title: "Re-discovery failed" });
    } finally {
      setDiscovering(false);
    }
  }

  if (product === undefined) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (product === null) {
    return (
      <div>
        <PageHead title="My product" />
        <Card className="p-8 flex flex-col items-center text-center gap-3 max-w-lg mx-auto">
          <Store className="size-8 text-[var(--muted-2)]" />
          <div className="text-content font-semibold">No product site to monitor yet</div>
          <p className="text-sm text-muted-foreground max-w-sm">
            {error
              ? "We couldn't load your product."
              : "Add a product URL to track your own site like a competitor — pricing, features and changes."}
          </p>
          <Button onClick={() => setChangeUrlOpen(true)}>Set a product URL</Button>
        </Card>

        <ChangeProductUrlDialog
          open={changeUrlOpen}
          onOpenChange={setChangeUrlOpen}
          currentUrl={null}
          onSaved={load}
        />
      </div>
    );
  }

  const p = product;
  const profile = p.profile ?? {};

  return (
    <div className="xl:px-6 2xl:px-12">
      <PageHead
        title="My product"
        sub={
          <span className="inline-flex items-center gap-2">
            {p.url || p.repoUrl ? (
              <a
                href={(p.url ?? p.repoUrl)!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                {p.name} <ExternalLink className="size-3" />
              </a>
            ) : (
              <span>{p.name}</span>
            )}
            <span className="text-[var(--muted-2)]">·</span>
            {p.scanning ? (
              <span className="inline-flex items-center gap-1 text-foreground">
                <Loader2 className="size-3 animate-spin" /> Scanning…
              </span>
            ) : p.scanError ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="size-3" /> Last scan failed
              </span>
            ) : (
              <span>
                {!p.url && !p.repoUrl
                  ? "Not live yet"
                  : p.lastScanAt
                    ? `Last scan ${formatDistanceToNow(new Date(p.lastScanAt), { addSuffix: true })}`
                    : "Not scanned yet"}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            {/* Stage / source / profile update — works at every stage, including
                idea/document with no live URL yet. */}
            <Button onClick={() => setUpdateOpen(true)} variant="outline" size="sm">
              <RefreshCw className="size-3.5" />
              Update profile
            </Button>
            {p.url ? (
              // Live product: site + pricing monitors exist, so offer selective re-scan.
              <RescanMenu
                busy={rescanning || p.scanning}
                onRescan={(categories) => void rescan(categories)}
              />
            ) : p.repoUrl ? (
              // Repo-only (developing) product: nothing to scope, plain re-scan.
              <Button
                onClick={() => rescan()}
                disabled={rescanning || p.scanning}
                variant="outline"
                size="sm"
              >
                {rescanning || p.scanning ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                {p.scanning ? "Scanning…" : "Re-scan"}
              </Button>
            ) : null}
          </div>
        }
      />

      <SelfChangesPanel changes={changes} actingId={actingId} onResolve={resolve} />

      {!p.url && (
        <Card className="p-3.5 mb-4 border-dashed">
          <h2 className="text-sm font-semibold mb-1">Not live yet</h2>
          <p className="text-sm text-muted-foreground mb-2.5 max-w-prose">
            Add a public site URL to monitor pricing, features and changes — or track its GitHub
            repo while you build. The profile below stays editable by hand.
          </p>
          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              void enableMonitoring();
            }}
          >
            <Input
              type="url"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="https://yourproduct.com"
              className="sm:max-w-sm"
            />
            <Button type="submit" disabled={enabling || !siteUrl.trim()}>
              {enabling ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Enable monitoring
            </Button>
          </form>

          <div className="mt-2.5 pt-2.5 border-t border-border">
            {p.repoUrl ? (
              <p className="text-dense text-muted-foreground">
                Tracking repo:{" "}
                <a
                  href={p.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-foreground underline"
                >
                  {p.repoUrl.replace(/^https?:\/\//, "")}
                  <ExternalLink className="size-3" />
                </a>
              </p>
            ) : (
              <form
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  void trackRepo();
                }}
              >
                <Input
                  type="url"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  placeholder="https://github.com/you/your-repo"
                  className="sm:max-w-sm"
                />
                <Button type="submit" variant="outline" disabled={trackingRepo || !repoUrl.trim()}>
                  {trackingRepo ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Track repo
                </Button>
              </form>
            )}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-6">
        <Card className="bg-gradient-card-strong p-4">
          <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground mb-1">
            Profile
          </h3>
          <Separator className="mb-1" />
          <EditableText
            label="Category"
            field={profile.category}
            onSave={(v) => patch({ category: v })}
          />
          <EditableText
            label="Audience"
            field={profile.audience}
            multiline
            onSave={(v) => patch({ audience: v })}
          />
          <EditableText
            label="Value prop"
            field={profile.valueProp}
            multiline
            onSave={(v) => patch({ valueProp: v })}
          />
        </Card>

        <PricingCard pricing={p.pricing} onSave={(pr) => patch({ pricing: pr })} />

        {p.url && <JobsCard jobs={p.jobs} />}

        <EditableList
          label={`Features detected${profile.features?.value?.length ? ` (${profile.features.value.length})` : ""}`}
          field={profile.features}
          onSave={(v) => patch({ features: v })}
        />

        <EditableList
          label="Tech stack detected"
          field={profile.techStack}
          onSave={(v) => patch({ techStack: v })}
        />

        {p.aiSummary && (
          <Card className="bg-gradient-card-strong p-4">
            <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Summary
            </h3>
            <p className="text-content text-muted-foreground leading-relaxed">{p.aiSummary}</p>
          </Card>
        )}
      </div>

      <ChangeProductUrlDialog
        open={changeUrlOpen}
        onOpenChange={setChangeUrlOpen}
        currentUrl={p.url}
        onSaved={load}
      />

      <UpdateProfileDialog open={updateOpen} onOpenChange={setUpdateOpen} onSaved={load} />

      <Dialog open={rediscover !== null} onOpenChange={(o) => !o && setRediscover(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-evaluate your competitors?</DialogTitle>
            <DialogDescription>{rediscover?.reason}</DialogDescription>
          </DialogHeader>
          <p className="text-dense text-muted-foreground">
            Some of your current competitors may be less relevant, and new ones could appear. Your
            existing competitors are kept — nothing is removed automatically.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRediscover(null)} disabled={discovering}>
              Keep as is
            </Button>
            <Button onClick={launchRediscovery} disabled={discovering}>
              {discovering && <Loader2 className="size-3.5 animate-spin" />}
              Launch re-discovery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
