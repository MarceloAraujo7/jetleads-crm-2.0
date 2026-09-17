"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { soundEffects } from "@/lib/sound-effects";
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import type { Notification, Conversation } from "@/types";
import {
  Bell,
  CheckCheck,
  Loader2,
  UserPlus,
  MessageSquare,
  Volume2,
  VolumeX,
  ExternalLink,
  User,
} from "lucide-react";
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
  const unreadNotificationsCount = useUnreadNotifications();
  const unreadMessagesCount = useTotalUnread();
  const totalUnread = unreadMessagesCount + unreadNotificationsCount;

  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"messages" | "notifications">("messages");
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Data states
  const [notifications, setNotifications] = useState<Notification[] | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Sync sound status
  useEffect(() => {
    setSoundEnabled(soundEffects.isEnabled());
  }, []);

  const handleToggleSound = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const next = soundEffects.toggle();
    setSoundEnabled(next);
    toast.info(next ? t("soundEnabled") : t("soundDisabled"));
  }, [t]);

  // Load system notifications
  const loadNotifications = useCallback(async () => {
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

  // Load recent conversations with unread / new messages
  const loadConversations = useCallback(async () => {
    if (!accountId) return;
    setLoadingMessages(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(LIST_LIMIT);

      if (!error && data) {
        setConversations(normalizeConversations(data as unknown as Parameters<typeof normalizeConversations>[0]));
      }
    } finally {
      setLoadingMessages(false);
    }
  }, [accountId]);

  // If opening and user has notifications but no unread messages, default tab logically
  useEffect(() => {
    if (open) {
      loadNotifications();
      loadConversations();
      if (unreadMessagesCount === 0 && unreadNotificationsCount > 0) {
        setActiveTab("notifications");
      }
    }
  }, [open, loadNotifications, loadConversations, unreadMessagesCount, unreadNotificationsCount]);

  // Realtime updates for notifications
  useEffect(() => {
    const supabase = createClient();
    const notifChannel = supabase
      .channel("notifications-popover-live")
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

    const convChannel = supabase
      .channel("conversations-popover-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => {
          // Re-fetch conversations if popover is open
          loadConversations();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(convChannel);
    };
  }, [loadConversations]);

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

  const handleNotificationClick = useCallback(
    (n: Notification) => {
      if (!n.read_at) markRead(n.id);
      setOpen(false);
      if (n.conversation_id) {
        router.push(`/inbox?c=${n.conversation_id}`);
      }
    },
    [markRead, router],
  );

  const handleConversationClick = useCallback(
    (convId: string) => {
      setOpen(false);
      router.push(`/inbox?c=${convId}`);
    },
    [router],
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
      loadNotifications();
    }
  }, [unreadIds.length, loadNotifications, t]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        aria-label={
          totalUnread > 0 ? t("totalUnread", { count: totalUnread }) : t("notifications")
        }
        className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
      >
        <Bell className="h-[18px] w-[18px]" />
        {totalUnread > 0 && (
          <span
            aria-hidden
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground animate-pulse"
          >
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="w-80 sm:w-[400px] bg-popover p-0 text-popover-foreground ring-border shadow-xl rounded-xl"
      >
        {/* Header with Title & Action Icons */}
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{t("notifications")}</p>
            {totalUnread > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {totalUnread}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {/* Sound Toggle */}
            <button
              type="button"
              onClick={handleToggleSound}
              title={soundEnabled ? t("soundEnabled") : t("soundDisabled")}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {soundEnabled ? (
                <Volume2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <VolumeX className="h-4 w-4 text-muted-foreground/60" />
              )}
            </button>

            {/* Mark all read button (only in notifications tab) */}
            {activeTab === "notifications" && unreadIds.length > 0 && (
              <button
                type="button"
                disabled={markingAll}
                onClick={markAllRead}
                title={t("notificationsMarkAllRead")}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
              >
                {markingAll ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">{t("notificationsMarkAllRead")}</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-border/70 bg-muted/40 p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveTab("messages")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors",
              activeTab === "messages"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span>{t("tabMessages")}</span>
            {unreadMessagesCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white">
                {unreadMessagesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("notifications")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition-colors",
              activeTab === "notifications"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Bell className="h-3.5 w-3.5" />
            <span>{t("tabNotifications")}</span>
            {unreadNotificationsCount > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {unreadNotificationsCount}
              </span>
            )}
          </button>
        </div>

        {/* Tab 1: Messages List */}
        {activeTab === "messages" && (
          <div className="max-h-[min(70vh,420px)] overflow-y-auto px-2 py-2">
            {loadingMessages && conversations === null ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : !conversations || conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
                <MessageSquare className="mb-1 h-6 w-6 text-muted-foreground/60" />
                <p className="text-sm font-medium text-foreground">{t("messagesEmpty")}</p>
                <p className="max-w-56 text-xs text-muted-foreground">{t("messagesEmptyHint")}</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {conversations.map((c) => {
                  const hasUnread = (c.unread_count ?? 0) > 0;
                  const contactName = c.contact?.name || c.contact?.phone || "Lead";
                  const initial = contactName.charAt(0).toUpperCase();

                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleConversationClick(c.id)}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors",
                          hasUnread
                            ? "bg-emerald-500/10 hover:bg-emerald-500/15"
                            : "hover:bg-muted/60",
                        )}
                      >
                        {/* Avatar */}
                        <div
                          className={cn(
                            "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                            hasUnread
                              ? "bg-emerald-600 text-white shadow-xs"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {initial ? initial : <User className="h-4 w-4" />}
                        </div>

                        {/* Content */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={cn(
                                "truncate text-xs font-semibold",
                                hasUnread ? "text-foreground font-bold" : "text-foreground/90",
                              )}
                            >
                              {contactName}
                            </span>
                            {c.last_message_at && (
                              <span className="text-[10px] text-muted-foreground/70 shrink-0">
                                {formatDistanceToNow(new Date(c.last_message_at), {
                                  addSuffix: true,
                                  locale: locale === "pt" ? ptBR : enUS,
                                })}
                              </span>
                            )}
                          </div>

                          <div className="mt-0.5 flex items-center justify-between gap-2">
                            <p className="truncate text-xs text-muted-foreground">
                              {c.last_message_text || "..."}
                            </p>
                            {hasUnread && (
                              <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white">
                                {c.unread_count}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Tab 2: System Notifications List */}
        {activeTab === "notifications" && (
          <div className="max-h-[min(70vh,420px)] overflow-y-auto px-2 py-2">
            {notifications === null ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
                <Bell className="mb-1 h-6 w-6 text-muted-foreground/60" />
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
                        onClick={() => handleNotificationClick(n)}
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
        )}

        {/* Footer Navigation */}
        <div className="border-t border-border/70 bg-muted/20">
          {activeTab === "messages" ? (
            <Link
              href="/inbox"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/60 transition-colors"
            >
              <span>{t("viewAllInbox")}</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          ) : (
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/60 transition-colors"
            >
              <span>{t("notificationsViewAll")}</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
