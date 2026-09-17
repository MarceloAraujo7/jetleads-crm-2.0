"use client";

import { useEffect, useRef } from "react";
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
  const mountedRef = useRef(false);

  useEffect(() => {
    // Avoid double mounting effects in React StrictMode
    if (mountedRef.current) return;
    mountedRef.current = true;

    const supabase = createClient();

    const channel = supabase
      .channel("global-sound-notification-listener")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new as Message;
          // Inbound message from a customer
          if (msg.sender_type === "customer") {
            soundEffects.playMessageSound();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const n = payload.new as Notification;
          if (!n.read_at) {
            soundEffects.playNotificationSound();
          }
        },
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return null;
}
