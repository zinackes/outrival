"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

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

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Notification | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  async function loadInitial() {
    try {
      const [listRes, countRes] = await Promise.all([
        fetch(`${BASE}/api/notifications?limit=20`, { credentials: "include" }),
        fetch(`${BASE}/api/notifications/unread-count`, { credentials: "include" }),
      ]);
      if (listRes.ok) {
        const { notifications } = (await listRes.json()) as { notifications: Notification[] };
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
        setItems((prev) => {
          if (prev.some((p) => p.id === notif.id)) return prev;
          return [notif, ...prev].slice(0, 20);
        });
        if (!notif.isRead) setUnreadCount((c) => c + 1);
        setToast(notif);
        setTimeout(() => setToast(null), 4500);
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
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Notifications"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
          className="relative p-2 hover:opacity-90"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span
              style={{ background: "var(--accent)", color: "#000" }}
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
            }}
            className="absolute right-0 top-12 w-96 max-h-[480px] flex flex-col z-50"
          >
            <div
              className="flex items-center justify-between px-3 py-2"
              style={{ borderBottom: "1px solid var(--border)" }}
            >
              <span className="text-xs uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Notifications
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs flex items-center gap-1 hover:opacity-80"
                  style={{ color: "var(--accent)" }}
                >
                  <Check size={11} /> Tout marquer lu
                </button>
              )}
            </div>
            <ul className="overflow-y-auto flex-1">
              {items.length === 0 ? (
                <li className="p-6 text-center text-xs" style={{ color: "var(--muted)" }}>
                  Aucune notification
                </li>
              ) : (
                items.map((n) => (
                  <li
                    key={n.id}
                    style={{ borderBottom: "1px solid var(--border)" }}
                    className="p-3 hover:bg-white/[0.02]"
                  >
                    <a
                      href={n.linkUrl ?? "#"}
                      onClick={() => {
                        if (!n.isRead) markRead(n.id);
                        if (n.linkUrl) setOpen(false);
                      }}
                      className="flex flex-col gap-1"
                    >
                      <div className="flex items-start gap-2">
                        {!n.isRead && (
                          <span
                            style={{ background: "var(--accent)" }}
                            className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium leading-tight">{n.title}</p>
                          {n.body && (
                            <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                              {n.body}
                            </p>
                          )}
                          <p className="text-[10px] mt-1.5" style={{ color: "var(--muted)" }}>
                            il y a {formatDistanceToNow(new Date(n.createdAt), { locale: fr })}
                          </p>
                        </div>
                      </div>
                    </a>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>

      {toast && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius)",
            boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
          }}
          className="fixed bottom-6 right-6 max-w-sm p-3 flex items-start gap-2 z-50"
        >
          <Bell size={14} style={{ color: "var(--accent)" }} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-tight">{toast.title}</p>
            {toast.body && (
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                {toast.body}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
