"use client";

import { useEffect, useState } from "react";
import { Trash2, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { api, type SignalComment } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SignalComments({
  signalId,
  onCountChange,
}: {
  signalId: string;
  onCountChange?: (n: number) => void;
}) {
  const [comments, setComments] = useState<SignalComment[] | null>(null);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    api
      .listSignalComments(signalId)
      .then((r) => {
        setComments(r.comments);
        onCountChange?.(r.comments.length);
      })
      .catch(() => setComments([]));
  }, [signalId, onCountChange]);

  async function add() {
    const body = text.trim();
    if (!body) return;
    setPosting(true);
    try {
      const r = await api.addSignalComment(signalId, body);
      setComments((p) => {
        const next = p ? [...p, r.comment] : [r.comment];
        onCountChange?.(next.length);
        return next;
      });
      setText("");
    } catch {
      // Keep the draft so the user can retry, but surface the failure (silent was wrong).
      toast.error("Couldn't post the comment. Try again.");
    } finally {
      setPosting(false);
    }
  }

  async function remove(id: string) {
    setComments((p) => {
      const next = p ? p.filter((c) => c.id !== id) : p;
      if (next) onCountChange?.(next.length);
      return next;
    });
    await api.deleteSignalComment(signalId, id).catch(() => {});
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      {comments && comments.length > 0 && (
        <ul className="mb-3 space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="group flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium">{c.authorName}</span>
                  <span className="text-muted-foreground font-mono text-micro">
                    {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-foreground/85 whitespace-pre-wrap text-dense leading-snug">
                  {c.body}
                </p>
              </div>
              {c.mine && (
                <button
                  onClick={() => remove(c.id)}
                  aria-label="Delete comment"
                  className="text-muted-foreground hover:text-foreground opacity-0 transition group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a comment…"
          className="h-8 text-dense"
        />
        <Button size="sm" onClick={add} disabled={posting || !text.trim()} aria-label="Post comment">
          <Send size={12} />
        </Button>
      </div>
    </div>
  );
}
