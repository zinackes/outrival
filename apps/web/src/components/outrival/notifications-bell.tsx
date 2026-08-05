"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BellIcon, CheckIcon, ChecksIcon, TrashIcon, XIcon } from "@/components/icons";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notificationsBellQuery } from "@/lib/queries";
import type { AppNotification as Notification } from "@/lib/api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// One scrape that lands five signals emits five notifications within a few seconds.
// Toasting each one buried the screen to say what the bell was already showing, so
// only the first of a burst is shown in full; the rest fold into it as a count.
const BURST_TOAST_ID = "notifications";
const BURST_WINDOW_MS = 10_000;

export function NotificationsBell({ compact = false }: { compact?: boolean } = {}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const esRef = useRef<EventSource | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const burstRef = useRef<{ count: number; timer: ReturnType<typeof setTimeout> | null }>({
    count: 0,
    timer: null,
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The opening snapshot. Seeded by the dashboard layout, so on a cold load it is
  // already in the cache and no request leaves the browser; without a seed the query
  // fetches once, which is what the two mount-time fetches used to do. Everything
  // after this point is local state driven by the SSE stream below.
  const snapshot = useQuery(notificationsBellQuery());

  useEffect(() => {
    if (!snapshot.data) return;
    for (const n of snapshot.data.items) seenIds.current.add(n.id);
    setItems(snapshot.data.items);
    setUnreadCount(snapshot.data.unreadCount);
  }, [snapshot.data]);

  useEffect(() => {
    const es = new EventSource(`${BASE}/api/notifications/stream`, {
      withCredentials: true,
    });
    esRef.current = es;
    es.addEventListener("notification", (e) => {
      try {
        const notif = JSON.parse((e as MessageEvent).data) as Notification;
        // Dedup by id: the SSE stream can replay a notification, and React
        // Strict Mode can briefly open two connections. Never toast/count twice.
        if (seenIds.current.has(notif.id)) return;
        seenIds.current.add(notif.id);

        setItems((prev) => [notif, ...prev].slice(0, 20));
        if (!notif.isRead) setUnreadCount((c) => c + 1);

        const burst = burstRef.current;
        burst.count += 1;
        if (burst.timer) clearTimeout(burst.timer);
        burst.timer = setTimeout(() => {
          burst.count = 0;
          burst.timer = null;
        }, BURST_WINDOW_MS);

        const icon = <BellIcon size={16} className="text-[var(--link)]" />;
        if (burst.count === 1) {
          toast(notif.title, {
            id: BURST_TOAST_ID,
            description: notif.body ?? undefined,
            icon,
            action: notif.linkUrl
              ? { label: "View", onClick: () => router.push(notif.linkUrl!) }
              : undefined,
          });
        } else {
          // Same toast, now standing for the whole burst: the newest title is the
          // description so the user still knows what just arrived.
          toast(`${burst.count} new notifications`, {
            id: BURST_TOAST_ID,
            description: notif.title,
            icon,
            action: { label: "View all", onClick: () => setOpen(true) },
          });
        }
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      /* let browser auto-reconnect */
    };
    const burst = burstRef.current;
    return () => {
      es.close();
      esRef.current = null;
      if (burst.timer) clearTimeout(burst.timer);
      burst.timer = null;
      burst.count = 0;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus(); // return focus to the trigger, not the void
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function markRead(id: string) {
    try {
      await fetch(`${BASE}/api/notifications/${id}/read`, {
        method: "PATCH",
        credentials: "include",
      });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {
      /* ignore */
    }
  }

  async function markAllRead() {
    try {
      await fetch(`${BASE}/api/notifications/read-all`, {
        method: "POST",
        credentials: "include",
      });
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      /* ignore */
    }
  }

  async function deleteOne(id: string, wasUnread: boolean) {
    // Optimistic: drop it now, the row stays gone (the SSE poll only re-sends
    // rows newer than lastCheck, and a deleted row no longer exists to match).
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch(`${BASE}/api/notifications/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      /* ignore */
    }
  }

  async function clearAll() {
    setItems([]);
    setUnreadCount(0);
    try {
      await fetch(`${BASE}/api/notifications`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div ref={dropdownRef} className="relative">
        <Tooltip>
          <TooltipTrigger asChild>
            {compact ? (
              <Button
                ref={triggerRef}
                variant="ghost"
                size="icon-sm"
                onClick={() => setOpen((o) => !o)}
                aria-label="Notifications"
                aria-haspopup="true"
                aria-expanded={open}
                aria-controls="notifications-panel"
                className="relative"
              >
                <BellIcon size={16} />
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary border-2 border-background"
                    aria-hidden
                  />
                )}
              </Button>
            ) : (
              <Button
                ref={triggerRef}
                variant="outline"
                size="icon"
                onClick={() => setOpen((o) => !o)}
                aria-label="Notifications"
                aria-haspopup="true"
                aria-expanded={open}
                aria-controls="notifications-panel"
                className="relative"
              >
                <BellIcon size={16} />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-meta font-bold flex items-center justify-center bg-primary text-primary-foreground">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Button>
            )}
          </TooltipTrigger>
          <TooltipContent>
            Notifications{unreadCount > 0 ? ` (${unreadCount} unread)` : ""}
          </TooltipContent>
        </Tooltip>

        {open && (
          <Card
            id="notifications-panel"
            role="region"
            aria-label="Notifications"
            className="fixed inset-x-4 top-14 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-96 max-h-[480px] overflow-hidden z-50 shadow-lg"
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Notifications
              </span>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={markAllRead}
                    className="h-7 px-2 text-xs text-primary hover:text-primary"
                  >
                    <CheckIcon size={16} /> Mark all read
                  </Button>
                )}
                {items.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearAll}
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <TrashIcon size={16} /> Clear all
                  </Button>
                )}
              </div>
            </div>
            <ul className="overflow-y-auto flex-1 min-h-0">
              {items.length === 0 ? (
                <li className="flex flex-col items-center gap-2 p-8 text-center">
                  <span className="inline-flex size-9 items-center justify-center rounded-md border border-positive/25 bg-positive/10 text-positive">
                    <ChecksIcon size={20} aria-hidden />
                  </span>
                  <span className="text-sm font-medium text-foreground">
                    You&apos;re all caught up
                  </span>
                  <span className="text-xs text-muted-foreground">
                    New competitor moves will show up here.
                  </span>
                </li>
              ) : (
                items.map((n) => (
                  <li key={n.id} className="group relative border-b border-border last:border-0 hover:bg-white/[0.02]">
                    <a
                      href={n.linkUrl ?? "#"}
                      onClick={() => {
                        if (!n.isRead) markRead(n.id);
                        if (n.linkUrl) setOpen(false);
                      }}
                      className="flex flex-col gap-1 p-3 pr-9"
                    >
                      <div className="flex items-start gap-2">
                        {!n.isRead && (
                          <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0 bg-primary" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight">{n.title}</p>
                          {n.body && (
                            <p className="text-xs mt-1 text-muted-foreground">
                              {n.body}
                            </p>
                          )}
                          <p className="text-meta mt-1.5 text-muted-foreground">
                            {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => deleteOne(n.id, !n.isRead)}
                      aria-label="Delete notification"
                      className="absolute right-1.5 top-2 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <XIcon />
                    </Button>
                  </li>
                ))
              )}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
