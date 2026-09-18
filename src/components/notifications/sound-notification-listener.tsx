"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { soundEffects } from "@/lib/sound-effects";
import type { Message, Notification } from "@/types";

/**
 * Headless listener mounted globally in DashboardShell.
 * Subscribes to realtime incoming messages and notifications to play
 * distinct audio chimes across all dashboard pages.
 */
export function SoundNotificationListener() {
  const { accountId } = useAuth();

  useEffect(() => {
    if (!accountId) return;

    try {
      const supabase = createClient();

      const channel = supabase
        .channel("global-sound-notification-listener")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => {
            try {
              const msg = payload.new as Message;
              if (msg && msg.sender_type === "customer") {
                soundEffects.playMessageSound();
              }
            } catch (err) {
              console.warn("[SoundNotificationListener] Error handling message sound:", err);
            }
          },
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications" },
          (payload) => {
            try {
              const n = payload.new as Notification;
              if (n && !n.read_at) {
                soundEffects.playNotificationSound();
              }
            } catch (err) {
              console.warn("[SoundNotificationListener] Error handling notification sound:", err);
            }
          },
        )
        .subscribe();

      return () => {
        try {
          supabase.removeChannel(channel);
        } catch {
          // Ignore removal errors
        }
      };
    } catch (err) {
      console.warn("[SoundNotificationListener] Error initializing listener:", err);
    }
  }, [accountId]);

  return null;
}
