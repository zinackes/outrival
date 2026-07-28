"use client";

import { useState } from "react";
import {
  CheckIcon,
  CircleNotchIcon,
  PencilIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import { formatDistanceToNow } from "date-fns";
import type { SelfProfileField } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** "Detected automatically" / "Edited by you N ago" badge for a profile field. */
export function FieldMeta({ field }: { field?: SelfProfileField<unknown> }) {
  if (!field) return null;
  if (field.isFromAutoDetect) {
    return (
      <span className="text-meta text-[var(--muted-2)] inline-flex items-center gap-1">
        <SparkleIcon className="size-3" /> detected auto
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

export function EditableText({
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
    <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3 items-start py-2">
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
                {saving ? <CircleNotchIcon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
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
                <XIcon className="size-3.5" /> Cancel
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
              <PencilIcon className="size-3.5" /> Edit
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function EditableList({
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
            <PencilIcon className="size-3.5" /> Edit
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
              {saving ? <CircleNotchIcon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              <XIcon className="size-3.5" /> Cancel
            </Button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-[var(--muted-2)]">Nothing detected yet.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
          {items.map((it, i) => (
            <div key={`${it}-${i}`} className="flex items-center gap-2 text-content">
              <CheckIcon className="size-3.5 text-primary shrink-0" />
              <span className="break-words">{it}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
