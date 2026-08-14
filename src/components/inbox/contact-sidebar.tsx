"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Contact, Deal, ContactNote, Tag } from "@/types";
import {
  Phone,
  Mail,
  Copy,
  Check,
  Tag as TagIcon,
  DollarSign,
  StickyNote,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

interface ContactSidebarProps {
  contact: Contact | null;
}

export function ContactSidebar({ contact }: ContactSidebarProps) {
  const tSidebar = useTranslations("Inbox.sidebar");
  const tThread = useTranslations("Inbox.messageThread");

  const { accountId } = useAuth();
  const [copied, setCopied] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [tags, setTags] = useState<(Tag & { contact_tag_id: string })[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const fetchContactData = useCallback(async () => {
    if (!contact) return;

    const supabase = createClient();

    // Fetch deals, notes, and tags in parallel
    const [dealsRes, notesRes, tagsRes] = await Promise.all([
      supabase
        .from("deals")
        .select("*, stage:pipeline_stages(*)")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_notes")
        .select("*")
        .eq("contact_id", contact.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("contact_tags")
        .select("id, tag_id, tags(*)")
        .eq("contact_id", contact.id),
    ]);

    if (dealsRes.data) setDeals(dealsRes.data);
    if (notesRes.data) setNotes(notesRes.data);
    if (tagsRes.data) {
      const mapped = tagsRes.data
        .filter((ct: Record<string, unknown>) => ct.tags)
        .map((ct: Record<string, unknown>) => ({
          ...(ct.tags as Tag),
          contact_tag_id: ct.id as string,
        }));
      setTags(mapped);
    }
  }, [contact]);

  // Load on contact change. setContactData/setTags run inside async
  // Supabase callbacks, not synchronously in the effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContactData();
  }, [fetchContactData]);

  const handleCopyPhone = useCallback(async () => {
    if (!contact?.phone) return;
    await navigator.clipboard.writeText(contact.phone);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    // Dep is the whole `contact` object (not `contact?.phone`) so the
    // React Compiler's inference agrees with the manual dep list —
    // fixes the `preserve-manual-memoization` lint error.
  }, [contact]);

  const handleAddNote = useCallback(async () => {
    if (!contact || !newNote.trim()) return;
    if (!accountId) return;
    setAddingNote(true);

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;

    const { data, error } = await supabase
      .from("contact_notes")
      .insert({
        contact_id: contact.id,
        account_id: accountId,
        user_id: user?.id,
        note_text: newNote.trim(),
      })
      .select()
      .single();

    if (!error && data) {
      setNotes((prev) => [data, ...prev]);
      setNewNote("");
    }
    setAddingNote(false);
  }, [contact, newNote, accountId]);

  if (!contact) {
    return (
      <div className="flex h-full w-70 items-center justify-center rounded-2xl bg-card shadow-[var(--shadow)]">
        <p className="text-sm text-muted-foreground">{tThread("selectConversation")}</p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <div className="h-full w-70">
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-4 p-4">
          {/* Card A — identity + quick actions */}
          <div className="shrink-0 rounded-2xl bg-card p-[18px] shadow-[var(--shadow)]">
            <div className="flex flex-col items-center gap-1 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-lg font-bold text-primary">
                {contact.avatar_url ? (
                  <img
                    src={contact.avatar_url}
                    alt={displayName}
                    className="h-14 w-14 rounded-full object-cover"
                  />
                ) : (
                  initials
                )}
              </div>
              <h3 className="mt-1.5 text-[15px] font-bold text-foreground">
                {displayName}
              </h3>
              {contact.company && (
                <p className="text-xs text-muted-foreground">{contact.company}</p>
              )}
            </div>

            <div className="mt-3.5 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-auto justify-center rounded-xl border-transparent bg-card-2 py-2.5 text-xs font-semibold text-foreground hover:bg-muted"
                render={<Link href={`/contacts?contact=${contact.id}`} />}
              >
                {tSidebar("viewLead")}
              </Button>
              <Button
                size="sm"
                className="h-auto justify-center rounded-xl bg-primary-soft py-2.5 text-xs font-semibold text-primary hover:bg-primary-soft-2"
                render={<Link href={`/pipelines?newDealContactId=${contact.id}`} />}
              >
                {tSidebar("createDeal")}
              </Button>
            </div>

            <div className="mt-3.5 space-y-1 border-t border-border pt-3.5">
              <button
                onClick={handleCopyPhone}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
              >
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="flex-1 text-left">{contact.phone}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-primary" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>

              {contact.email && (
                <div className="flex items-center gap-2 rounded-lg px-1 py-1 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{contact.email}</span>
                </div>
              )}
            </div>
          </div>

          {/* Card B — tags / deals / notes */}
          <div className="shrink-0 rounded-2xl bg-card p-[18px] shadow-[var(--shadow)]">
            {/* Tags */}
            <div>
              <div className="flex items-center gap-2 text-[13.5px] font-bold text-foreground">
                <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {tSidebar("tags")}
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {tags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tSidebar("noTags")}</p>
                ) : (
                  tags.map((tag) => (
                    <span
                      key={tag.contact_tag_id}
                      className="rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Deals */}
            <div className="mt-4.5">
              <div className="flex items-center gap-2 text-[13.5px] font-bold text-foreground">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                {tSidebar("deals")}
              </div>
              <div className="mt-2.5 space-y-2">
                {deals.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tSidebar("noDeals")}</p>
                ) : (
                  deals.map((deal) => (
                    <div key={deal.id} className="rounded-xl bg-card-2 px-3.5 py-3">
                      <p className="text-[13px] font-semibold text-foreground">
                        {deal.title}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>
                          {deal.currency ?? "$"}
                          {deal.value.toLocaleString()}
                        </span>
                        {deal.stage && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{
                              backgroundColor: `${deal.stage.color}20`,
                              color: deal.stage.color,
                            }}
                          >
                            {deal.stage.name}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="mt-4.5">
              <div className="flex items-center gap-2 text-[13.5px] font-bold text-foreground">
                <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
                {tSidebar("notes")}
              </div>
              <div className="mt-2.5">
                <div className="flex gap-2">
                  <textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder={tSidebar("addNotePlaceholder")}
                    rows={2}
                    className="flex-1 resize-none rounded-xl border border-hairline bg-card-2 px-3 py-2 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
                  />
                  <Button
                    size="sm"
                    className="h-auto bg-primary px-2 hover:bg-primary/90"
                    onClick={handleAddNote}
                    disabled={!newNote.trim() || addingNote}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>

                <div className="mt-2 space-y-2">
                  {notes.map((note) => (
                    <div key={note.id} className="rounded-xl bg-card-2 px-3.5 py-3">
                      <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {note.note_text}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {format(new Date(note.created_at), "MMM d, yyyy HH:mm")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
