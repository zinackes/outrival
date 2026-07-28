"use client";

import { useState, type ReactNode } from "react";
import {
  ChatIcon,
  CheckCircleIcon,
  CheckIcon,
  CopyIcon,
  QuestionIcon,
  ShieldCheckIcon,
  ShieldIcon,
  TargetIcon,
  XCircleIcon,
  XIcon,
} from "@/components/icons";
import type { BattleCardContent } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { Icon as PhosphorIcon } from "@/components/icons";

export type IconType = PhosphorIcon;

// The six sections, in the order a card is used rather than the order the columns
// were declared: where each side stands, then where they are weak, then what to say,
// then whether the deal is worth the cycle. Caps mirror the API's Zod schema exactly —
// a 5th "when we win" line 400s on save, so the editor must not offer one.
export const SECTION_MAX = {
  their_strengths: 5,
  our_strengths: 5,
  their_weaknesses: 5,
  common_objections: 5,
  when_we_win: 4,
  when_we_lose: 4,
} as const;

/** Section heading. Carries a semantic colour so our edge and theirs read apart. */
export function SectionHeading({
  icon: Icon,
  color,
  count,
  action,
  children,
}: {
  icon: IconType;
  color?: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3
        className={cn(
          "flex items-center gap-2 text-content font-semibold tracking-tight leading-tight",
          color,
        )}
      >
        <Icon size={16} className={cn("shrink-0", !color && "text-muted-foreground")} />
        {children}
        {count !== undefined && count > 0 && (
          <span className="font-mono text-meta font-normal tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </h3>
      {action}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Not enough verified data yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5 text-content leading-relaxed">
          {/* Muted marker, not the brand accent: twelve accent bullets on one screen
              spend the one colour the page has on decoration. */}
          <span className="mt-px shrink-0 text-muted-foreground" aria-hidden>
            •
          </span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

function EditableList({
  items,
  onChange,
  max,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  max: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={it}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            className="flex-1"
          />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                aria-label="Remove"
              >
                <XIcon size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove</TooltipContent>
          </Tooltip>
        </div>
      ))}
      {items.length < max && (
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onChange([...items, ""])}
          className="self-start text-link"
        >
          + Add
        </Button>
      )}
    </div>
  );
}

function ListBlock({
  title,
  icon,
  color,
  items,
  editing,
  max,
  onChange,
}: {
  title: string;
  icon: IconType;
  color?: string;
  items: string[];
  editing: boolean;
  max: number;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SectionHeading icon={icon} color={color} count={editing ? undefined : items.length}>
        {title}
      </SectionHeading>
      {editing ? (
        <EditableList items={items} onChange={onChange} max={max} />
      ) : (
        <BulletList items={items} />
      )}
    </div>
  );
}

/** Copy one answer. Reps paste into Slack and the CRM far more than they download. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className={cn(
            "shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/obj:opacity-100",
            done && "text-positive opacity-100",
          )}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setDone(true);
              setTimeout(() => setDone(false), 1300);
            } catch {
              // Clipboard denied (insecure context / permission) — no toast for a
              // convenience action the user can still select by hand.
            }
          }}
        >
          {done ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{done ? "Copied" : label}</TooltipContent>
    </Tooltip>
  );
}

function ObjectionsSection({
  items,
  editing,
  onChange,
}: {
  items: Array<{ objection: string; response: string }>;
  editing: boolean;
  onChange: (items: Array<{ objection: string; response: string }>) => void;
}) {
  const [copiedAll, setCopiedAll] = useState(false);
  const asText = items
    .map((o) => `${o.objection}\n${o.response}`)
    .join("\n\n");

  return (
    <section className="flex flex-col gap-3 p-5">
      <SectionHeading
        icon={ChatIcon}
        count={editing ? undefined : items.length}
        action={
          <div className="flex items-center gap-1">
            {!editing && items.length > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(asText);
                    setCopiedAll(true);
                    setTimeout(() => setCopiedAll(false), 1300);
                  } catch {
                    // see CopyButton
                  }
                }}
              >
                {copiedAll ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
                {copiedAll ? "Copied" : "Copy all"}
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex cursor-help p-1 text-muted-foreground">
                  <QuestionIcon size={16} />
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Objections a prospect might raise to pick this competitor over you, each
                paired with a sales response to counter it.
              </TooltipContent>
            </Tooltip>
          </div>
        }
      >
        Common objections
      </SectionHeading>

      {editing ? (
        <div className="flex flex-col gap-2">
          {items.map((o, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-md border border-border p-2">
              <Input
                value={o.objection}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...o, objection: e.target.value };
                  onChange(next);
                }}
                placeholder="Objection..."
              />
              <Textarea
                value={o.response}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...o, response: e.target.value };
                  onChange(next);
                }}
                placeholder="Response..."
                rows={2}
              />
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="self-start"
              >
                Remove
              </Button>
            </div>
          ))}
          {items.length < SECTION_MAX.common_objections && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onChange([...items, { objection: "", response: "" }])}
              className="self-start text-link"
            >
              + Add an objection
            </Button>
          )}
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not enough verified data yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {items.map((o, i) => (
            <div
              key={i}
              className="group/obj flex items-start gap-2 py-3.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                {/* The quote sets up quietly and the answer carries the reading size:
                    on a live call the line you say is what has to be findable, and the
                    old treatment bolded the objection and greyed the response. */}
                <p className="text-sm leading-relaxed text-muted-foreground">
                  “{o.objection}”
                </p>
                <p className="mt-1.5 text-content leading-relaxed">{o.response}</p>
              </div>
              <CopyButton text={o.response} label="Copy this answer" />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The card body: the same six sections the card has always had, regrouped so the
 * positioning triad reads as one unit and the deal-shape pair as another.
 */
export function BattleCardSections({
  content,
  editing,
  draft,
  setDraft,
}: {
  content: BattleCardContent;
  editing: boolean;
  draft: BattleCardContent;
  setDraft: (next: BattleCardContent) => void;
}) {
  return (
    <>
      <section className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:grid-cols-2 lg:grid-cols-3">
        <ListBlock
          title="Their strengths"
          icon={ShieldIcon}
          color="text-critical"
          items={content.their_strengths}
          editing={editing}
          max={SECTION_MAX.their_strengths}
          onChange={(items) => setDraft({ ...draft, their_strengths: items })}
        />
        <ListBlock
          title="Our strengths"
          icon={ShieldCheckIcon}
          color="text-positive"
          items={content.our_strengths}
          editing={editing}
          max={SECTION_MAX.our_strengths}
          onChange={(items) => setDraft({ ...draft, our_strengths: items })}
        />
        <ListBlock
          title="Their weaknesses"
          icon={TargetIcon}
          color="text-medium"
          items={content.their_weaknesses}
          editing={editing}
          max={SECTION_MAX.their_weaknesses}
          onChange={(items) => setDraft({ ...draft, their_weaknesses: items })}
        />
      </section>

      <ObjectionsSection
        items={content.common_objections}
        editing={editing}
        onChange={(items) => setDraft({ ...draft, common_objections: items })}
      />

      <section className="grid grid-cols-1 gap-x-8 gap-y-6 p-5 sm:grid-cols-2">
        <ListBlock
          title="When we win"
          icon={CheckCircleIcon}
          color="text-positive"
          items={content.when_we_win}
          editing={editing}
          max={SECTION_MAX.when_we_win}
          onChange={(items) => setDraft({ ...draft, when_we_win: items })}
        />
        <ListBlock
          title="When we lose"
          icon={XCircleIcon}
          color="text-critical"
          items={content.when_we_lose}
          editing={editing}
          max={SECTION_MAX.when_we_lose}
          onChange={(items) => setDraft({ ...draft, when_we_lose: items })}
        />
      </section>
    </>
  );
}

/** The six section labels, reused by the empty state and the build view. */
export const SECTION_META: Array<{
  key: keyof BattleCardContent;
  title: string;
  icon: IconType;
  color?: string;
  from: string;
}> = [
  { key: "their_strengths", title: "Their strengths", icon: ShieldIcon, color: "text-critical", from: "homepage, pricing" },
  { key: "our_strengths", title: "Our strengths", icon: ShieldCheckIcon, color: "text-positive", from: "your product profile" },
  { key: "their_weaknesses", title: "Their weaknesses", icon: TargetIcon, color: "text-medium", from: "pricing, reviews" },
  { key: "common_objections", title: "Common objections", icon: ChatIcon, from: "reviews, pricing" },
  { key: "when_we_win", title: "When we win", icon: CheckCircleIcon, color: "text-positive", from: "both profiles" },
  { key: "when_we_lose", title: "When we lose", icon: XCircleIcon, color: "text-critical", from: "both profiles" },
];
