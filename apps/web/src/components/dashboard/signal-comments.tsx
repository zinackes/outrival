"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, RotateCw, Trash2 } from "lucide-react";
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

/**
 * The discussion on a signal.
 *
 * Built for a thread that outlives its first day: a comment appears the moment
 * it is sent and carries its own state (sending, or failed and still editable),
 * consecutive comments from one author collapse into a block so the name is
 * said once, and the destructive step is reversible. The previous version
 * posted blind, dropped a failed delete without telling anyone, and handed a
 * single-line input to people writing sentences.
 */

/** A comment the server has not confirmed yet. `error` = the send failed. */
type Pending = {
  localId: string;
  body: string;
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
  const [text, setText] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
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

  // Open with the caret in the composer: the reason this section gets opened at
  // all is almost always to write.
  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  async function send(body: string, localId: string) {
    try {
      const r = await api.addSignalComment(signalId, body);
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

  function submit() {
    const body = text.trim();
    if (!body) return;
    const localId = `local-${seq.current++}`;
    setPending((p) => [
      ...p,
      { localId, body, createdAt: new Date().toISOString(), error: false },
    ]);
    setText("");
    void send(body, localId);
  }

  function retry(item: Pending) {
    setPending((p) =>
      p.map((x) => (x.localId === item.localId ? { ...x, error: false } : x)),
    );
    void send(item.body, item.localId);
  }

  // Delete leaves immediately but only commits when the undo window closes, so
  // the reversible path costs nothing and a rejected delete puts the row back
  // instead of leaving a thread the server disagrees with.
  function remove(comment: SignalComment) {
    setComments((prev) => prev.filter((c) => c.id !== comment.id));
    let undone = false;
    const commit = () => {
      if (undone) return;
      void api.deleteSignalComment(signalId, comment.id).catch(() => {
        restore(comment);
        toast.error("Couldn't delete the comment. It's still here.");
      });
    };
    toast("Comment deleted", {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          restore(comment);
        },
      },
      onAutoClose: commit,
      onDismiss: commit,
    });
  }

  const items: Array<
    { kind: "posted"; c: SignalComment } | { kind: "pending"; p: Pending }
  > = [
    ...(comments ?? []).map((c) => ({ kind: "posted" as const, c })),
    ...pending.map((p) => ({ kind: "pending" as const, p })),
  ];

  return (
    <div className="mt-4 border-t border-border pt-4">
      {commentsQ.isLoading && (
        <div className="mb-4 space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {items.length > 0 && (
        <ul className="mb-4 space-y-3">
          {items.map((item, i) => {
            const author =
              item.kind === "pending"
                ? "You"
                : item.c.mine
                  ? "You"
                  : item.c.authorName;
            const prev = items[i - 1];
            const prevAuthor = !prev
              ? null
              : prev.kind === "pending"
                ? "You"
                : prev.c.mine
                  ? "You"
                  : prev.c.authorName;
            // Consecutive comments from one author read as one block: the name
            // and the mark are said once, the rest hangs under them.
            const grouped = prevAuthor === author;

            return (
              <li
                key={item.kind === "posted" ? item.c.id : item.p.localId}
                className={cn("group flex gap-2.5", grouped && "-mt-1.5")}
              >
                <div className="w-6 shrink-0">
                  {!grouped && <Initial name={author} />}
                </div>

                <div className="min-w-0 flex-1">
                  {!grouped && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-dense font-medium text-foreground">
                        {author}
                      </span>
                      <Stamp
                        iso={
                          item.kind === "posted"
                            ? item.c.createdAt
                            : item.p.createdAt
                        }
                      />
                    </div>
                  )}
                  <p
                    className={cn(
                      "whitespace-pre-wrap text-sm leading-relaxed",
                      item.kind === "pending" && !item.p.error
                        ? "text-muted-foreground"
                        : "text-foreground",
                      !grouped && "mt-0.5",
                    )}
                  >
                    {item.kind === "posted" ? item.c.body : item.p.body}
                  </p>

                  {item.kind === "pending" && item.p.error && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
                      <span className="text-critical">Not sent.</span>
                      <button
                        type="button"
                        onClick={() => retry(item.p)}
                        className="inline-flex items-center gap-1 rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <RotateCw size={11} aria-hidden /> Retry
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPending((p) =>
                            p.filter((x) => x.localId !== item.p.localId),
                          )
                        }
                        className="rounded-sm text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        Discard
                      </button>
                    </div>
                  )}
                </div>

                {item.kind === "posted" && item.c.mine && (
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
                      <DropdownMenuItem onSelect={() => remove(item.c)}>
                        <Trash2 size={13} /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!commentsQ.isLoading && items.length === 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          No one has weighed in yet. Say what you make of this move.
        </p>
      )}

      <div className="rounded-md border border-border bg-surface-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <Textarea
          ref={composerRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="Add a comment…"
          className="max-h-48 min-h-0 resize-none border-0 bg-transparent px-3 py-2 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2">
          <span className="text-meta text-muted-foreground">
            <kbd className="font-mono">Enter</kbd> to send,{" "}
            <kbd className="font-mono">Shift</kbd>+
            <kbd className="font-mono">Enter</kbd> for a new line
          </span>
          <Button size="sm" className="h-7" onClick={submit} disabled={!text.trim()}>
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Author mark. Initial only — the app has no avatar upload to fall back on. */
function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-6 items-center justify-center rounded-full bg-surface-3 text-meta font-semibold text-muted-foreground"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
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
