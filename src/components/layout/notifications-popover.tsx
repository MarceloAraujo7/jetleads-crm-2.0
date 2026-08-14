"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import type { Notification } from "@/types";
import { Bell, CheckCheck, Loader2, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR, enUS } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
};

const LIST_LIMIT = 20;

export function NotificationsPopover() {
  const t = useTranslations("Header");
  const locale = useLocale();
  const router = useRouter();
  const { accountId } = useAuth();
  const unreadCount = useUnreadNotifications();

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    setNotifications((data ?? []) as Notification[]);
  }, [accountId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("notifications-popover")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Notification;
            setNotifications((prev) => {
              if (!prev) return [row];
              if (prev.some((n) => n.id === row.id)) return prev;
              return [row, ...prev].slice(0, LIST_LIMIT);
            });
          } else if (payload.eventType === "UPDATE") {
            const row = payload.new as Notification;
            setNotifications(
              (prev) => prev?.map((n) => (n.id === row.id ? { ...n, ...row } : n)) ?? prev,
            );
          } else if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Notification>;
            setNotifications((prev) => prev?.filter((n) => n.id !== oldRow.id) ?? prev);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const markRead = useCallback(async (id: string) => {
    setNotifications(
      (prev) =>
        prev?.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: new Date().toISOString() } : n)) ??
        prev,
    );
    const supabase = createClient();
    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .is("read_at", null);
  }, []);

  const handleClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      setOpen(false);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router],
  );

  const unreadIds = notifications?.filter((n) => !n.read_at).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications((prev) => prev?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? prev);
    const supabase = createClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: now })
      .is("read_at", null);
    setMarkingAll(false);
    if (error) {
      toast.error(t("notificationsMarkAllFailed"));
      load();
    }
  }, [unreadIds.length, load, t]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={
          unreadCount > 0 ? t("unreadNotifications", { count: unreadCount }) : t("notifications")
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-80 bg-popover p-0 text-popover-foreground ring-border sm:w-96"
      >
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <p className="text-sm font-semibold text-foreground">{t("notifications")}</p>
          <button
            type="button"
            disabled={unreadIds.length === 0 || markingAll}
            onClick={markAllRead}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:hover:bg-transparent"
          >
            {markingAll ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <CheckCheck className="h-3 w-3" />
            )}
            {t("notificationsMarkAllRead")}
          </button>
        </div>

        <div className="max-h-[min(70vh,420px)] overflow-y-auto px-2 pb-2">
          {notifications === null ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
              <Bell className="mb-1 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">{t("notificationsEmpty")}</p>
              <p className="max-w-56 text-xs text-muted-foreground">{t("notificationsEmptyHint")}</p>
            </div>
          ) : (
            <ul className="space-y-1">
              {notifications.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                const isUnread = !n.read_at;
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => handleClick(n)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors",
                        isUnread ? "bg-primary-soft hover:bg-primary-soft-2" : "hover:bg-muted/60",
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg",
                          isUnread ? "bg-primary/15" : "bg-muted",
                        )}
                        aria-hidden
                      >
                        <Icon
                          className={cn("h-4 w-4", isUnread ? "text-primary" : "text-muted-foreground")}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "truncate text-[13px] font-semibold",
                              isUnread ? "text-foreground" : "text-muted-foreground",
                            )}
                          >
                            {n.title}
                          </span>
                          {isUnread && (
                            <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                          )}
                        </div>
                        {n.body && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.body}</p>
                        )}
                        <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">
                          {formatDistanceToNow(new Date(n.created_at), {
                            addSuffix: true,
                            locale: locale === "pt" ? ptBR : enUS,
                          })}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="block rounded-b-lg px-3 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/60"
        >
          {t("notificationsViewAll")}
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
