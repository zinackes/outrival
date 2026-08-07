"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { myProductQuery, myProductChangesQuery, productsListQuery } from "@/lib/queries";
import {
  ArrowsClockwiseIcon,
  BroadcastIcon,
  NotePencilIcon,
  SpinnerIcon,
  ClockIcon,
  WarningIcon,
  BriefcaseIcon,
  CurrencyDollarIcon,
  ArrowSquareOutIcon,
  FileTextIcon,
  SparkleIcon,
  StorefrontIcon,
  UsersIcon,
  CaretDownIcon,
} from "@/components/icons";
import { EmptyState } from "@/components/dashboard/empty-state";
import { toast } from "@/lib/toast";
import { toastApiError, toastRescanLimit } from "@/lib/error-helpers";
import { friendlyScrapeError } from "@/lib/scrape-errors";
import { formatDistanceToNow } from "date-fns";
import {
  api,
  type MyProductPatch,
  type MyProductRescanCategory,
  type ProductLinkedCompetitor,
  type SelfProductChange,
} from "@/lib/api";
import { cn, prettyUrl } from "@/lib/utils";
import { ProductTile } from "@/components/dashboard/product-tile";
import { SelfChangesPanel } from "@/components/outrival/self-change-review";
import { AnalysisNotice, AnalysisProgress } from "@/components/outrival/analysis-status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PageHead } from "@/components/dashboard/page-head";
import { useSetAskContext } from "@/components/dashboard/ask-context";
import { ChangeProductUrlDialog } from "@/components/outrival/change-product-url-dialog";
import { UpdateProfileDialog } from "@/components/outrival/update-profile-dialog";
// Blocks live in ./product-detail: this file owns the page (data, scan state,
// mutations), they own their own editing state.
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProductActionsMenu } from "./product-actions";
import { EditableList, EditableText } from "./product-detail/fields";
import { PricingCard } from "./product-detail/pricing-card";
import { JobsCard } from "./product-detail/jobs-card";
import { RescanMenu } from "./product-detail/rescan-menu";
import { useScanPoll } from "./product-detail/use-scan-poll";
import { ProductLead } from "./product-detail/product-lead";
import { PriceLadder } from "./product-detail/price-ladder";
import { ProductCompetitors } from "./product-detail/competitors-tab";

// The reading tabs. Positioning leads because it is what the rest is measured
// against; Competitors and Hiring only exist when there is something behind them.
const TAB_KEYS = ["positioning", "pricing", "competitors", "hiring"] as const;
type ProductTabKey = (typeof TAB_KEYS)[number];

const TAB_PANEL_CLASS = "animate-in fade-in slide-in-from-bottom-1 duration-300";

export function MyProductView({
  productId,
  title = "My product",
  isPrimary = productId === undefined,
  competitors,
}: {
  // patch-28 — scope the view to a given product's self-competitor. Omitted → the
  // primary self (legacy "My product"). The /dashboard/products/[id] page passes both.
  productId?: string;
  title?: string;
  // The org-coupled "Update profile" dialog (onboarding profile + project stage) only
  // makes sense for the primary product; secondary products edit inline / re-scan.
  isPrimary?: boolean;
  // The product's linked competitors, when the caller has them (the [id] page).
  // Absent on the legacy self view, which has no product row and so no tab.
  competitors?: ProductLinkedCompetitor[];
} = {}) {
  // Server-seeded on first paint (products/[id]/page.tsx). product is
  // undefined while loading, null when no product site is set yet (or on error).
  const queryClient = useQueryClient();
  const productQ = useQuery(myProductQuery(productId));
  const changesQ = useQuery(myProductChangesQuery(productId));
  const product = productQ.isError ? null : productQ.data;
  const changes = changesQ.data ?? [];
  const error = productQ.error;
  // The portfolio row for this product, for the lead's rail. It is the list the
  // sidebar switcher already keeps warm, so this costs no extra request; absent
  // (legacy self view, cold cache) simply drops the two stats it feeds.
  const { data: allProducts } = useQuery(productsListQuery());
  const row = productId ? allProducts?.find((r) => r.id === productId) : undefined;

  const [tab, setTab] = useState<ProductTabKey>("positioning");
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
  const [notLiveOpen, setNotLiveOpen] = useState(false);
  const profileCardRef = useRef<HTMLDivElement>(null);

  // Refresh both queries (called by the scan poller and after every mutation).
  async function load() {
    await Promise.all([productQ.refetch(), changesQ.refetch()]);
  }

  // Going live (or setting a repo) rewrites the name/URL the ["products"] caches
  // carry — the sidebar switcher's roster, this page's title (products.detail) and
  // the settings list. Without this they kept the pre-update name/favicon until a
  // hard reload. Not folded into load(): the scan poller calls load() every 4s.
  async function loadAndRefreshIdentity() {
    await load();
    void queryClient.invalidateQueries({ queryKey: ["products"] });
  }

  // Optimistic write-through for the pending-changes list (accept / ignore a change).
  function setChanges(updater: (prev: SelfProductChange[]) => SelfProductChange[]) {
    queryClient.setQueryData(
      myProductChangesQuery(productId).queryKey,
      (prev: SelfProductChange[] | undefined) => updater(prev ?? []),
    );
  }

  // Scope Ask to the current product while its page is open.
  useSetAskContext(
    product
      ? {
          kind: "product",
          label: `${isPrimary ? "My product" : "Product"}: ${product.name}`,
        }
      : null,
  );

  useScanPoll({ product, productId, load });

  // Adopt ?tab= on mount so a link into a tab lands on it, and mirror every switch
  // back (replaceState, so tabbing does not fill the back button).
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (raw && (TAB_KEYS as readonly string[]).includes(raw)) setTab(raw as ProductTabKey);
  }, []);

  function selectTab(key: ProductTabKey) {
    setTab(key);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", key);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  async function patch(body: MyProductPatch) {
    await api.updateMyProduct(body, productId);
    await load();
    toast.success("Profile updated");
  }

  async function enableMonitoring() {
    const url = siteUrl.trim();
    if (!url) return;
    setEnabling(true);
    try {
      await api.setMyProductSite(url, productId);
      toast.success("Monitoring enabled", { description: "Your site will be scanned shortly." });
      setSiteUrl("");
      await loadAndRefreshIdentity();
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
      await api.setMyProductRepo(url, productId);
      toast.success("Repo tracked", { description: "Its activity will be scanned shortly." });
      setRepoUrl("");
      await loadAndRefreshIdentity();
    } catch (e) {
      toastApiError(e, { title: "Couldn't track repo" });
    } finally {
      setTrackingRepo(false);
    }
  }

  async function rescan(categories?: MyProductRescanCategory[]) {
    setRescanning(true);
    try {
      const res = await api.rescanMyProduct(categories, productId);
      if (res.limitReached) {
        // Some sources ran, then the daily re-scan cap (patch-27) was hit.
        toast.warning("Re-scan partially started, daily re-scan limit reached.", {
          description: `Scanning ${res.monitors} source${res.monitors === 1 ? "" : "s"}; the rest resume on the next automatic check. The limit resets tomorrow.`,
          action: {
            label: "View plans",
            onClick: () => {
              window.location.href = "/dashboard/settings/billing";
            },
          },
        });
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
        <SpinnerIcon className="size-5 animate-spin" />
      </div>
    );
  }

  if (product === null) {
    return (
      <div>
        <PageHead title={title} />
        <EmptyState
          icon={StorefrontIcon}
          title="No product site to monitor yet"
          description={
            error
              ? "We couldn't load your product."
              : isPrimary
                ? "Add a product URL to track your own site like a competitor: pricing, features and changes."
                : "Add a product URL to track this product's site: pricing, features and changes."
          }
          actions={
            <Button onClick={() => setChangeUrlOpen(true)}>Set a product URL</Button>
          }
        />

        <ChangeProductUrlDialog
          open={changeUrlOpen}
          onOpenChange={setChangeUrlOpen}
          currentUrl={null}
          productId={productId}
          onSaved={loadAndRefreshIdentity}
        />
      </div>
    );
  }

  const p = product;
  const profile = p.profile ?? {};

  return (
    <div className="xl:px-6 2xl:px-12">
      <PageHead
        title={title}
        // The product's own mark, the same favicon its competitors are shown with,
        // so a multi-SKU workspace can tell at a glance which one is open.
        icon={
          <ProductTile
            name={p.name}
            url={p.url}
            repoUrl={p.repoUrl}
            position={row?.position}
            size={30}
            ring={Boolean(row)}
            className="mr-0.5"
          />
        }
        sub={
          <span className="inline-flex items-center gap-2">
            {p.url || p.repoUrl ? (
              <a
                href={(p.url ?? p.repoUrl)!}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                {prettyUrl(p.url ?? p.repoUrl!)} <ArrowSquareOutIcon className="size-3.5" />
              </a>
            ) : (
              <span>No site or repo yet</span>
            )}
            <span className="text-[var(--muted-2)]">·</span>
            {p.scanning ? (
              <span className="inline-flex items-center gap-1 text-foreground">
                <SpinnerIcon className="size-3.5 animate-spin" /> Scanning…
              </span>
            ) : p.scanQueued ? (
              // A clock, not a spinner: nothing is turning while the job waits its
              // turn, and the wait routinely runs into the tens of minutes.
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <ClockIcon className="size-3.5" /> Queued for a scan
              </span>
            ) : p.scanError ? (
              <span className="inline-flex items-center gap-1 text-destructive">
                <WarningIcon className="size-3.5" /> Last scan failed
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
                idea/document with no live URL yet. Org-coupled (onboarding profile +
                project stage), so it's the primary product's tool only. */}
            {isPrimary && (
              <Button onClick={() => setUpdateOpen(true)} variant="outline" size="sm">
                <NotePencilIcon className="size-4" />
                Update profile
              </Button>
            )}
            {/* What we collect on this product — the same manage-sources sheet a
                competitor gets (toggle, cadence, URL, custom pages), on the self
                monitors. Needs the product route, so the legacy no-product view
                (productId undefined) doesn't offer it. */}
            {productId && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/products/${productId}/sources`}>
                  <BroadcastIcon className="size-4" />
                  Sources
                </Link>
              </Button>
            )}
            {p.url ? (
              // Live product: site + pricing monitors exist, so offer selective re-scan.
              <RescanMenu
                busy={rescanning || p.scanning}
                queued={Boolean(p.scanQueued)}
                onRescan={(categories) => void rescan(categories)}
              />
            ) : p.repoUrl ? (
              // Repo-only (developing) product: nothing to scope, plain re-scan.
              <Button
                onClick={() => rescan()}
                disabled={rescanning || p.scanning || p.scanQueued}
                variant="outline"
                size="sm"
              >
                {rescanning || p.scanning ? (
                  <SpinnerIcon className="size-4 animate-spin" />
                ) : p.scanQueued ? (
                  <ClockIcon className="size-4" />
                ) : (
                  <ArrowsClockwiseIcon className="size-4" />
                )}
                {p.scanning ? "Scanning…" : p.scanQueued ? "Queued" : "Re-scan"}
              </Button>
            ) : null}
            {/* Lifecycle verbs (rename, promote, remove) — the portfolio rows' menu,
                here so the product on screen can be managed without going back to
                the list. Needs the product row, so the legacy no-product view
                doesn't offer it. */}
            {productId && (
              <ProductActionsMenu
                productId={productId}
                name={title}
                isPrimary={isPrimary}
              />
            )}
          </div>
        }
      />

      {/* Prominent stepper while the first analysis runs — mirrors the competitor
          page so the profile cards below read as "in progress", not empty. Only the
          in-flight case; scan failures stay owned by the scanError card below and
          the summary-slot notice keeps handling needs_attention. */}
      {p.analysis.pending && <AnalysisProgress analysis={p.analysis} className="mb-4" />}

      <SelfChangesPanel changes={changes} actingId={actingId} onResolve={resolve} />

      {/* Surface the last scan failure inline (not just a transient toast) so the
          user can see *why* their own product couldn't be read and act on it —
          retry, or fall back to the hand-editable fields below. */}
      {p.scanError && !p.scanning && (
        <Card className="p-3.5 mb-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-start gap-2.5">
            <WarningIcon className="size-4 shrink-0 text-destructive mt-0.5" />
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold mb-1">Last scan failed</h2>
              <p className="text-sm text-muted-foreground max-w-prose">
                {friendlyScrapeError(p.scanError, p.scanErrorSource ?? undefined)}
              </p>
              <p className="text-dense text-muted-foreground mt-1.5 max-w-prose">
                It&apos;s your own product, so you can fill in the details below by hand (your edits
                stick and won&apos;t be overwritten), or try the scan again.
              </p>
              {(p.url || p.repoUrl) && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2.5"
                  onClick={() => void rescan()}
                  disabled={rescanning || p.scanning}
                >
                  {rescanning ? (
                    <SpinnerIcon className="size-4 animate-spin" />
                  ) : (
                    <ArrowsClockwiseIcon className="size-4" />
                  )}
                  Try again
                </Button>
              )}
            </div>
          </div>
        </Card>
      )}

      {!p.url && (
        <Card className="p-3.5 mb-4 border-dashed">
          <button
            type="button"
            onClick={() => setNotLiveOpen((o) => !o)}
            aria-expanded={notLiveOpen}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <h2 className="text-sm font-semibold">Not live yet</h2>
            <CaretDownIcon
              className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                notLiveOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {notLiveOpen && (
            <div className="mt-2.5">
              <p className="text-sm text-muted-foreground mb-2.5 max-w-prose">
                Add a public site URL to monitor pricing, features and changes, or track its GitHub
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
                  {enabling ? <SpinnerIcon className="size-4 animate-spin" /> : <SparkleIcon className="size-4" />}
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
                      <ArrowSquareOutIcon className="size-3.5" />
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
                        <SpinnerIcon className="size-4 animate-spin" />
                      ) : (
                        <ArrowsClockwiseIcon className="size-4" />
                      )}
                      Track repo
                    </Button>
                  </form>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      <ProductLead
        product={p}
        row={row}
        competitorCount={competitors ? competitors.length : (row?.competitorCount ?? null)}
        onEdit={() => {
          // "positioning" is the default tab, so selecting it alone was a no-op on
          // first load — the button visibly did nothing. Primary product: open the
          // guided profile dialog (stage + source + required fields). Secondary:
          // land on the inline profile fields.
          if (isPrimary) {
            setUpdateOpen(true);
            return;
          }
          selectTab("positioning");
          requestAnimationFrame(() =>
            profileCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
          );
        }}
        onRescan={() => void rescan(["profile"])}
        canRescan={Boolean(p.url)}
      />

      <Tabs value={tab} onValueChange={(v) => selectTab(v as ProductTabKey)} className="mt-5">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="positioning">
            <FileTextIcon size={16} /> Positioning
          </TabsTrigger>
          <TabsTrigger value="pricing">
            <CurrencyDollarIcon size={16} /> Pricing
          </TabsTrigger>
          {competitors && (
            <TabsTrigger value="competitors">
              <UsersIcon size={16} /> Competitors
              <span className="ml-1.5 text-meta text-muted-foreground tabular-nums">
                {competitors.length}
              </span>
            </TabsTrigger>
          )}
          {(p.url || p.jobs.total > 0) && (
            <TabsTrigger value="hiring">
              <BriefcaseIcon size={16} /> Hiring
              {p.jobs.total > 0 && (
                <span className="ml-1.5 text-meta text-muted-foreground tabular-nums">
                  {p.jobs.total}
                </span>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="positioning" className={cn(TAB_PANEL_CLASS, "mt-4 flex flex-col gap-6")}>
          <Card ref={profileCardRef} className="scroll-mt-20 bg-gradient-card-strong p-4">
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
              label="What it does"
              field={profile.whatItDoes}
              multiline
              onSave={(v) => patch({ whatItDoes: v })}
            />
            <EditableText
              label="Value prop"
              field={profile.valueProp}
              multiline
              onSave={(v) => patch({ valueProp: v })}
            />
            <EditableText
              label="Pricing model"
              field={profile.pricingModel}
              onSave={(v) => patch({ pricingModel: v })}
            />
          </Card>

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

          {(p.analysis.pending || p.analysis.stage === "needs_attention") && (
            <Card className="px-4 py-3 border-dashed">
              <AnalysisNotice analysis={p.analysis} />
            </Card>
          )}
          {p.aiSummary && (
            <Card className="bg-gradient-card-strong p-4">
              <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Summary
              </h3>
              <p className="text-content text-muted-foreground leading-relaxed">{p.aiSummary}</p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pricing" className={cn(TAB_PANEL_CLASS, "mt-4 flex flex-col gap-6")}>
          {/* The ladder leads: where you sit is the question, your own plan table
              is the evidence behind it. */}
          {productId && (
            <Card className="bg-gradient-card-strong p-4">
              <h3 className="text-dense font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Where your entry price sits
              </h3>
              <Separator className="mb-3" />
              <PriceLadder
                productId={productId}
                name={p.name}
                url={p.url}
                repoUrl={p.repoUrl}
                position={row?.position}
              />
            </Card>
          )}
          <PricingCard pricing={p.pricing} onSave={(pr) => patch({ pricing: pr })} />
        </TabsContent>

        {competitors && (
          <TabsContent value="competitors" className={cn(TAB_PANEL_CLASS, "mt-4")}>
            <ProductCompetitors productId={productId!} competitors={competitors} />
          </TabsContent>
        )}

        {(p.url || p.jobs.total > 0) && (
          <TabsContent value="hiring" className={cn(TAB_PANEL_CLASS, "mt-4")}>
            {/* The jobs source is monitored independently of the homepage URL — its
                careers target lives in monitor.config.url (scrape-monitor derives
                scrapeUrl = configUrl ?? competitor.url). So a product with detected
                openings but no live homepage URL must still surface them here. */}
            <JobsCard jobs={p.jobs} />
          </TabsContent>
        )}
      </Tabs>

      <ChangeProductUrlDialog
        open={changeUrlOpen}
        onOpenChange={setChangeUrlOpen}
        currentUrl={p.url}
        productId={productId}
        onSaved={loadAndRefreshIdentity}
      />

      <UpdateProfileDialog
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        onSaved={loadAndRefreshIdentity}
      />

      <Dialog open={rediscover !== null} onOpenChange={(o) => !o && setRediscover(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-evaluate your competitors?</DialogTitle>
            <DialogDescription>{rediscover?.reason}</DialogDescription>
          </DialogHeader>
          <p className="text-dense text-muted-foreground">
            Some of your current competitors may be less relevant, and new ones could appear. Your
            existing competitors are kept, and nothing is removed automatically.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRediscover(null)} disabled={discovering}>
              Keep as is
            </Button>
            <Button onClick={launchRediscovery} disabled={discovering}>
              {discovering && <SpinnerIcon className="size-4 animate-spin" />}
              Launch re-discovery
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
