"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

interface Notification {
  id: string;
  type: "signal" | "new_competitor";
  title: string;
  body: string | null;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export function NotificationsBell({ compact = false }: { compact?: boolean } = {}) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const esRef = useRef<EventSource | null>(null);
  const seenIds = useRef<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);

  async function loadInitial() {
    try {
      const [listRes, countRes] = await Promise.all([
        fetch(`${BASE}/api/notifications?limit=20`, { credentials: "include" }),
        fetch(`${BASE}/api/notifications/unread-count`, { credentials: "include" }),
      ]);
      if (listRes.ok) {
        const { notifications } = (await listRes.json()) as { notifications: Notification[] };
        for (const n of notifications) seenIds.current.add(n.id);
        setItems(notifications);
      }
      if (countRes.ok) {
        const { count } = (await countRes.json()) as { count: number };
        setUnreadCount(count);
      }
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    loadInitial();
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

        toast(notif.title, {
          id: notif.id,
          description: notif.body ?? undefined,
          icon: <Bell size={14} className="text-[var(--link)]" />,
          action: notif.linkUrl
            ? { label: "View", onClick: () => router.push(notif.linkUrl!) }
            : undefined,
        });
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      /* let browser auto-reconnect */
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
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

  return (
    <>
      <div ref={dropdownRef} className="relative">
        <Tooltip>
          <TooltipTrigger asChild>
            {compact ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen((o) => !o)}
                aria-label="Notifications"
                className="relative w-8 h-8 hover:bg-accent hover:text-foreground"
              >
                <Bell size={14} />
                {unreadCount > 0 && (
                  <span
                    className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary border-2 border-background"
                    aria-hidden
                  />
                )}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="icon"
                onClick={() => setOpen((o) => !o)}
                aria-label="Notifications"
                className="relative"
              >
                <Bell size={16} />
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
          <Card className="absolute right-0 top-12 w-96 max-w-[calc(100vw-2rem)] max-h-[480px] overflow-hidden z-50 shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Notifications
              </span>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={markAllRead}
                  className="h-7 px-2 text-xs text-primary hover:text-primary"
                >
                  <Check size={11} /> Mark all read
                </Button>
              )}
            </div>
            <ul className="overflow-y-auto flex-1 min-h-0">
              {items.length === 0 ? (
                <li className="flex flex-col items-center gap-2 p-8 text-center">
                  <span className="inline-flex size-9 items-center justify-center rounded-md border border-positive/25 bg-positive/10 text-positive">
                    <CheckCheck size={17} aria-hidden />
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
                  <li key={n.id} className="border-b border-border last:border-0 hover:bg-white/[0.02]">
                    <a
                      href={n.linkUrl ?? "#"}
                      onClick={() => {
                        if (!n.isRead) markRead(n.id);
                        if (n.linkUrl) setOpen(false);
                      }}
                      className="flex flex-col gap-1 p-3"
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
