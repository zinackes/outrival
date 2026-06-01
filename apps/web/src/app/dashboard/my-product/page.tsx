"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  RefreshCw,
  Loader2,
  Pencil,
  Check,
  X,
  AlertTriangle,
  ExternalLink,
  Sparkles,
  Store,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import {
  api,
  type MyProduct,
  type MyProductPatch,
  type SelfProfileField,
  type SelfProductChange,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
      <span className="text-[11px] text-[var(--muted-2)] inline-flex items-center gap-1">
        <Sparkles className="size-3" /> detected auto
      </span>
    );
  }
  return (
    <span className="text-[11px] text-[var(--muted-2)]">
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
      <div className="text-[13px] text-muted-foreground pt-1">{label}</div>
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
              <div className="text-[14px] break-words">
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
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
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
        <div className="text-[13px] text-[var(--muted-2)]">Nothing detected yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {items.map((it, i) => (
            <div key={`${it}-${i}`} className="flex items-center gap-2 text-[14px]">
              <Check className="size-3.5 text-primary shrink-0" />
              <span className="break-words">{it}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const SEVERITY_STYLE: Record<string, string> = {
  minor: "border-l-2 border-l-primary",
  major: "border-l-2 border-l-destructive",
};

export default function MyProductPage() {
  const [product, setProduct] = useState<MyProduct | null | undefined>(undefined);
  const [changes, setChanges] = useState<SelfProductChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [rediscover, setRediscover] = useState<{ reason: string } | null>(null);
  const [discovering, setDiscovering] = useState(false);

  async function load() {
    try {
      const [{ product }, { changes }] = await Promise.all([
        api.getMyProduct(),
        api.listMyProductChanges("pending"),
      ]);
      setProduct(product);
      setChanges(changes);
    } catch (e) {
      setError(String(e));
      setProduct(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function patch(body: MyProductPatch) {
    await api.updateMyProduct(body);
    await load();
    toast.success("Profile updated");
  }

  async function rescan() {
    setRescanning(true);
    try {
      await api.rescanMyProduct();
      toast.success("Re-scan started", { description: "Fresh data will appear shortly." });
    } catch (e) {
      toast.error("Re-scan failed", { description: String(e) });
    } finally {
      setRescanning(false);
    }
  }

  async function resolve(change: SelfProductChange, action: "accept" | "modify" | "ignore") {
    setActingId(change.id);
    try {
      if (action === "accept") {
        const { suggestion } = await api.acceptMyProductChange(change.id);
        if (suggestion?.action === "rediscover") setRediscover({ reason: suggestion.reason });
      } else if (action === "modify") {
        await api.modifyMyProductChange(change.id);
        toast.info("Edit the field below to record your version.");
      } else {
        await api.ignoreMyProductChange(change.id);
      }
      setChanges((cs) => cs.filter((c) => c.id !== change.id));
    } catch (e) {
      toast.error("Action failed", { description: String(e) });
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
      toast.error("Re-discovery failed", { description: String(e) });
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
          <div className="text-[15px] font-semibold">No product site to monitor yet</div>
          <p className="text-[13px] text-muted-foreground max-w-sm">
            {error
              ? "We couldn't load your product."
              : "Add a product URL to track your own site like a competitor — pricing, features and changes."}
          </p>
          <Button asChild>
            <Link href="/onboarding">Set a product URL</Link>
          </Button>
        </Card>
      </div>
    );
  }

  const p = product;
  const profile = p.profile ?? {};

  return (
    <div>
      <PageHead
        title="My product"
        sub={
          <span className="inline-flex items-center gap-2">
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 hover:text-foreground"
            >
              {p.name} <ExternalLink className="size-3" />
            </a>
            <span className="text-[var(--muted-2)]">·</span>
            <span>
              {p.lastScanAt
                ? `Last scan ${formatDistanceToNow(new Date(p.lastScanAt), { addSuffix: true })}`
                : "Not scanned yet"}
            </span>
          </span>
        }
        actions={
          <Button onClick={rescan} disabled={rescanning} variant="outline" size="sm">
            {rescanning ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Re-scan
          </Button>
        }
      />

      {changes.length > 0 && (
        <Card className="p-4 mb-6">
          <h2 className="text-[14px] font-semibold mb-3">
            {changes.length} change{changes.length > 1 ? "s" : ""} detected on your site
          </h2>
          <div className="flex flex-col gap-3">
            {changes.map((ch) => (
              <div key={ch.id} className={`pl-3 ${SEVERITY_STYLE[ch.severity] ?? ""}`}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[12px] font-medium capitalize">{ch.fieldPath}</span>
                  {ch.severity === "major" && (
                    <Badge variant="destructive" className="text-[10px]">
                      major
                    </Badge>
                  )}
                </div>
                <div className="text-[13px] text-muted-foreground mb-2">
                  {ch.summary ?? "Change detected."}
                </div>
                {ch.severity === "major" && (
                  <div className="text-[12px] text-[var(--muted-2)] inline-flex items-start gap-1 mb-2">
                    <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
                    This is a major change — your competitors may need re-evaluating.
                  </div>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => resolve(ch, "accept")}
                    disabled={actingId === ch.id}
                  >
                    {ch.severity === "major" ? "Accept & re-scan" : "Accept"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => resolve(ch, "modify")}
                    disabled={actingId === ch.id}
                  >
                    Modify
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => resolve(ch, "ignore")}
                    disabled={actingId === ch.id}
                  >
                    Ignore
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-6">
        <Card className="p-4">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
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

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
              Pricing
            </h3>
            <div className="flex items-center gap-2">
              {p.pricing.promotional && (
                <Badge variant="secondary" className="text-[10px]">
                  promo
                </Badge>
              )}
              <Badge variant="outline" className="text-[11px]">
                {PRICING_LABELS[p.pricing.status ?? "unknown"] ?? "Unknown"}
              </Badge>
            </div>
          </div>
          {p.pricing.tiers.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {p.pricing.tiers.map((t, i) => (
                <div
                  key={`${t.plan_name}-${i}`}
                  className="flex items-center justify-between text-[14px]"
                >
                  <span>{t.plan_name}</span>
                  <span style={mono} className="text-foreground">
                    {t.price === 0 ? "Free" : `${t.price} ${t.currency}`}
                    <span className="text-[var(--muted-2)]">/{t.billing_period}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[13px] text-[var(--muted-2)]">No pricing tiers detected yet.</div>
          )}
          {(p.pricing.observedRegion || p.pricing.note) && (
            <div className="text-[11px] text-[var(--muted-2)] mt-2">
              {p.pricing.observedRegion ? `Seen from ${p.pricing.observedRegion}` : ""}
              {p.pricing.note ? ` · ${p.pricing.note}` : ""}
            </div>
          )}
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

        {p.aiSummary && (
          <Card className="p-4">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Summary
            </h3>
            <p className="text-[14px] text-muted-foreground leading-relaxed">{p.aiSummary}</p>
          </Card>
        )}
      </div>

      <Dialog open={rediscover !== null} onOpenChange={(o) => !o && setRediscover(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-evaluate your competitors?</DialogTitle>
            <DialogDescription>{rediscover?.reason}</DialogDescription>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground">
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
