"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, RotateCw, Trash2 } from "lucide-react";
import { format, formatDistanceToNow, isToday } from "date-fns";
import { toast } from "sonner";
import { api, type SignalComment } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { UserAvatar } from "./user-avatar";

/**
 * The discussion on a signal.
 *
 * Threading is SINGLE LEVEL: a reply answers a root comment and nothing answers
 * a reply. That is the shape Slack, Linear and GitHub review threads all
 * converged on — a root gives a topic and a place for the back-and-forth to
 * live, while unbounded nesting turns a thread into a tree nobody can read at a
 * glance. The server refuses a reply-to-a-reply rather than flattening it, so
 * the depth rendered here is the depth the data can hold.
 *
 * Everything a reader can lose is reversible or recoverable: a failed send stays
 * in place and retryable instead of vanishing with the text, and delete only
 * commits once the undo window closes.
 */

/** A comment the server has not confirmed yet. `error` = the send failed. */
type Pending = {
  localId: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  error: boolean;
};

const KEY = (signalId: string) => ["signalComments", signalId] as const;

export function SignalComments({ signalId }: { signalId: string }) {
  const queryClient = useQueryClient();
  const commentsQ = useQuery({
    queryKey: KEY(signalId),
    queryFn: () => api.listSignalComments(signalId).then((r) => r.comments),
  });
  const comments = commentsQ.data ?? null;

  const [pending, setPending] = useState<Pending[]>([]);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const seq = useRef(0);

  function setComments(next: (prev: SignalComment[]) => SignalComment[]) {
    queryClient.setQueryData<SignalComment[]>(KEY(signalId), (prev) =>
      next(prev ?? []),
    );
  }

  function restore(comment: SignalComment) {
    setComments((prev) =>
      [...prev, comment].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  async function send(body: string, parentId: string | null, localId: string) {
    try {
      const r = await api.addSignalComment(signalId, body, parentId ?? undefined);
      setComments((prev) => [...prev, r.comment]);
      setPending((p) => p.filter((x) => x.localId !== localId));
    } catch {
      // Stays in the thread, marked, with retry and discard: a failed send that
      // vanishes takes the text the user wrote with it.
      setPending((p) =>
        p.map((x) => (x.localId === localId ? { ...x, error: true } : x)),
      );
    }
  }

  function submit(body: string, parentId: string | null) {
    const text = body.trim();
    if (!text) return;
    const localId = `local-${seq.current++}`;
    setPending((p) => [
      ...p,
      {
        localId,
        body: text,
        parentId,
        createdAt: new Date().toISOString(),
        error: false,
      },
    ]);
    setReplyTo(null);
    void send(text, parentId, localId);
  }

  function retry(item: Pending) {
    setPending((p) =>
      p.map((x) => (x.localId === item.localId ? { ...x, error: false } : x)),
    );
    void send(item.body, item.parentId, item.localId);
  }

  async function saveEdit(comment: SignalComment, body: string) {
    const text = body.trim();
    setEditing(null);
    if (!text || text === comment.body) return;
    const before = comment.body;
    setComments((prev) =>
      prev.map((c) =>
        c.id === comment.id
          ? { ...c, body: text, editedAt: new Date().toISOString() }
          : c,
      ),
    );
    try {
      await api.editSignalComment(signalId, comment.id, text);
    } catch {
      setComments((prev) =>
        prev.map((c) =>
          c.id === comment.id ? { ...c, body: before, editedAt: comment.editedAt } : c,
        ),
      );
      toast.error("Couldn't save the edit. The comment is unchanged.");
    }
  }

  // Delete leaves immediately but only commits when the undo window closes, so
  // the reversible path costs nothing and a rejected delete puts the row back
  // instead of leaving a thread the server disagrees with. Deleting a root takes
  // its replies with it, server-side and here.
  function remove(comment: SignalComment) {
    const replies = (comments ?? []).filter((c) => c.parentId === comment.id);
    const removed = [comment, ...replies];
    const ids = new Set(removed.map((c) => c.id));
    setComments((prev) => prev.filter((c) => !ids.has(c.id)));

    let undone = false;
    const commit = () => {
      if (undone) return;
      void api.deleteSignalComment(signalId, comment.id).catch(() => {
        removed.forEach(restore);
        toast.error("Couldn't delete the comment. It's still here.");
      });
    };
    toast(
      replies.length > 0
        ? `Comment and ${replies.length} ${replies.length === 1 ? "reply" : "replies"} deleted`
        : "Comment deleted",
      {
        duration: 6000,
        action: {
          label: "Undo",
          onClick: () => {
            undone = true;
            removed.forEach(restore);
          },
        },
        onAutoClose: commit,
        onDismiss: commit,
      },
    );
  }

  // One entry per root, each carrying its replies — pending items included, so a
  // reply in flight sits under the comment it answers rather than at the end.
  const threads = useMemo(() => {
    const all: Entry[] = [
      ...(comments ?? []).map((c) => ({ kind: "posted" as const, c })),
      ...pending.map((p) => ({ kind: "pending" as const, p })),
    ];
    const roots = all.filter((e) => parentOf(e) === null);
    return roots.map((root) => ({
      root,
      replies: all.filter((e) => parentOf(e) === idOf(root)),
    }));
  }, [comments, pending]);

  const orphanReplies = useMemo(() => {
    const rootIds = new Set(threads.map((t) => idOf(t.root)));
    return [
      ...(comments ?? []).map((c) => ({ kind: "posted" as const, c })),
      ...pending.map((p) => ({ kind: "pending" as const, p })),
    ].filter((e) => {
      const parent = parentOf(e);
      return parent !== null && !rootIds.has(parent);
    });
  }, [comments, pending, threads]);

  const empty = threads.length === 0 && orphanReplies.length === 0;

  return (
    <div className="mt-4 border-t border-border pt-4">
      {commentsQ.isLoading && (
        <div className="mb-4 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {!empty && (
        <ul className="mb-4 space-y-4">
          {threads.map(({ root, replies }) => (
            <li key={idOf(root)}>
              <Comment
                entry={root}
                editing={editing === idOf(root)}
                onEdit={() => setEditing(idOf(root))}
                onCancelEdit={() => setEditing(null)}
                onSaveEdit={saveEdit}
                onDelete={remove}
                onRetry={retry}
                onDiscard={(localId) =>
                  setPending((p) => p.filter((x) => x.localId !== localId))
                }
                onReply={
                  root.kind === "posted" ? () => setReplyTo(idOf(root)) : undefined
                }
              />

              {(replies.length > 0 || replyTo === idOf(root)) && (
                // One indent, once. The rail marks "these answer the comment
                // above" without turning the thread into a tree.
                <ul className="mt-3 space-y-3 border-l border-border pl-4 sm:ml-3.5">
                  {replies.map((reply) => (
                    <li key={idOf(reply)}>
                      <Comment
                        entry={reply}
                        editing={editing === idOf(reply)}
                        onEdit={() => setEditing(idOf(reply))}
                        onCancelEdit={() => setEditing(null)}
                        onSaveEdit={saveEdit}
                        onDelete={remove}
                        onRetry={retry}
                        onDiscard={(localId) =>
                          setPending((p) => p.filter((x) => x.localId !== localId))
                        }
                      />
                    </li>
                  ))}
                  {replyTo === idOf(root) && (
                    <li>
                      <Composer
                        autoFocus
                        placeholder="Reply…"
                        submitLabel="Reply"
                        onSubmit={(body) => submit(body, idOf(root))}
                        onCancel={() => setReplyTo(null)}
                      />
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}

          {/* A reply whose root is gone (deleted in another tab) still belongs
              to the reader who wrote it — show it rather than dropping it. */}
          {orphanReplies.map((entry) => (
            <li key={idOf(entry)}>
              <Comment
                entry={entry}
                editing={editing === idOf(entry)}
                onEdit={() => setEditing(idOf(entry))}
                onCancelEdit={() => setEditing(null)}
                onSaveEdit={saveEdit}
                onDelete={remove}
                onRetry={retry}
                onDiscard={(localId) =>
                  setPending((p) => p.filter((x) => x.localId !== localId))
                }
              />
            </li>
          ))}
        </ul>
      )}

      {!commentsQ.isLoading && empty && (
        <p className="mb-4 text-sm text-muted-foreground">
          No one has weighed in yet. Say what you make of this move.
        </p>
      )}

      <Composer
        autoFocus={empty}
        placeholder="Add a comment…"
        submitLabel="Comment"
        onSubmit={(body) => submit(body, null)}
      />
    </div>
  );
}

/* ── thread entries ──────────────────────────────────────────────────────── */

type Entry =
  | { kind: "posted"; c: SignalComment }
  | { kind: "pending"; p: Pending };

const idOf = (e: Entry) => (e.kind === "posted" ? e.c.id : e.p.localId);
const parentOf = (e: Entry) => (e.kind === "posted" ? e.c.parentId : e.p.parentId);

function Comment({
  entry,
  editing,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onRetry,
  onDiscard,
  onReply,
}: {
  entry: Entry;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (comment: SignalComment, body: string) => void;
  onDelete: (comment: SignalComment) => void;
  onRetry: (item: Pending) => void;
  onDiscard: (localId: string) => void;
  /** Absent on replies — threading is single level. */
  onReply?: () => void;
}) {
  const posted = entry.kind === "posted" ? entry.c : null;
  const unsent = entry.kind === "pending" ? entry.p : null;
  const author = !posted ? "You" : posted.mine ? "You" : posted.authorName;
  const inFlight = Boolean(unsent && !unsent.error);

  if (posted && editing) {
    return (
      <div className="flex gap-2.5">
        <Mark comment={posted} name={author} />
        <div className="min-w-0 flex-1">
          <Composer
            autoFocus
            initial={posted.body}
            placeholder="Edit your comment…"
            submitLabel="Save"
            onSubmit={(body) => onSaveEdit(posted, body)}
            onCancel={onCancelEdit}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="group flex gap-2.5">
      <Mark comment={posted} name={author} />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-dense font-medium text-foreground">{author}</span>
          <Stamp iso={posted ? posted.createdAt : unsent!.createdAt} />
          {posted?.editedAt && (
            <span className="text-meta text-muted-foreground">edited</span>
          )}
          {inFlight && (
            <span className="text-meta text-muted-foreground">sending…</span>
          )}
        </div>

        <p
          className={cn(
            "mt-0.5 whitespace-pre-wrap text-sm leading-relaxed",
            inFlight ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {posted ? posted.body : unsent!.body}
        </p>

        {unsent?.error && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
            <span className="text-critical">Not sent.</span>
            <button
              type="button"
              onClick={() => onRetry(unsent)}
              className="inline-flex items-center gap-1 rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <RotateCw size={11} aria-hidden /> Retry
            </button>
            <button
              type="button"
              onClick={() => onDiscard(unsent.localId)}
              className="rounded-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Discard
            </button>
          </div>
        )}

        {onReply && posted && (
          <button
            type="button"
            onClick={onReply}
            className="mt-1 rounded-sm text-meta text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Reply
          </button>
        )}
      </div>

      {posted?.mine && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Comment actions"
              className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal size={14} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={13} /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDelete(posted)}>
              <Trash2 size={13} /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

/**
 * The author's mark: the real photo when the account has one (Google sign-in is
 * the only source — the product has no avatar upload), otherwise the same
 * generated mark the topbar shows, seeded on the same email so one account
 * always looks like one account.
 */
function Mark({ comment, name }: { comment: SignalComment | null; name: string }) {
  const [broken, setBroken] = useState(false);
  const image = comment?.authorImage;

  if (image && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote avatar host
      // (Google CDN) not in next.config remotePatterns; a 24px mark gains nothing
      // from the optimiser and a broken URL falls back below.
      <img
        src={image}
        alt=""
        width={24}
        height={24}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="size-6 shrink-0 rounded-full border border-border object-cover"
      />
    );
  }
  return (
    <UserAvatar
      seed={comment?.authorEmail || comment?.userId || name}
      size={24}
      className="mt-px"
    />
  );
}

/** Relative time to read, absolute time on hover — precision without clutter. */
function Stamp({ iso }: { iso: string }) {
  const d = new Date(iso);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={iso}
          className="cursor-default text-meta text-muted-foreground"
        >
          {formatDistanceToNow(d, { addSuffix: true })}
        </time>
      </TooltipTrigger>
      <TooltipContent>
        {format(d, isToday(d) ? "'today at' HH:mm" : "MMM d, yyyy 'at' HH:mm")}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * One composer for the three places text is written — new comment, reply, edit —
 * so the keys, the hint and the shape never drift apart between them.
 */
function Composer({
  initial = "",
  placeholder,
  submitLabel,
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  placeholder: string;
  submitLabel: string;
  autoFocus?: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  function send() {
    if (!text.trim()) return;
    onSubmit(text);
    setText("");
  }

  return (
    <div className="rounded-md border border-border bg-surface-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          } else if (e.key === "Escape" && onCancel) {
            e.preventDefault();
            onCancel();
          }
        }}
        rows={2}
        placeholder={placeholder}
        className="max-h-48 min-h-0 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2">
        <span className="text-meta text-muted-foreground">
          <kbd className="font-mono">Enter</kbd> to send,{" "}
          <kbd className="font-mono">Shift</kbd>+<kbd className="font-mono">Enter</kbd>{" "}
          for a new line
        </span>
        <div className="flex items-center gap-1.5">
          {onCancel && (
            <Button variant="ghost" size="sm" className="h-7" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="sm" className="h-7" onClick={send} disabled={!text.trim()}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
