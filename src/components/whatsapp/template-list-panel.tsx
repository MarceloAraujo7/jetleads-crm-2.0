"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Copy, Trash2, RefreshCw, Loader2, MessageSquareText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { templateStatusConfig } from "@/lib/template-status";
import { TemplateBubblePreview } from "@/components/whatsapp/template-bubble-preview";
import { TemplateWizardDialog } from "@/components/whatsapp/template-wizard-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { MessageTemplate, MessageTemplateStatus } from "@/types";
import { useTranslations } from "next-intl";

type FilterTab = "all" | "approved" | "pending";

/**
 * Renders inline in the WhatsApp module's "Modelos" tab — the list
 * loads as soon as the tab is active, no extra click to reveal it.
 * Only creating/editing a template opens a dialog (TemplateWizardDialog);
 * browsing the catalog is just page content.
 */
export function TemplateListPanel() {
  const t = useTranslations("Settings.templates.list");
  const tStatus = useTranslations("Settings.templates.status");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [templateToDelete, setTemplateToDelete] = useState<MessageTemplate | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [duplicateFrom, setDuplicateFrom] = useState<MessageTemplate | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const { data, error } = await supabase
      .from("message_templates")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(t("toastLoadFailed"));
      return;
    }
    setTemplates((data ?? []) as MessageTemplate[]);
  }, [accountId, supabase, t]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!templates) return [];
    if (filter === "approved") return templates.filter((tpl) => tpl.status === "APPROVED");
    if (filter === "pending") return templates.filter((tpl) => tpl.status === "PENDING");
    return templates;
  }, [templates, filter]);

  const selected = templates?.find((tpl) => tpl.id === selectedId) ?? filtered[0] ?? null;

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/whatsapp/templates/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || t("toastSyncFailed"));
      toast.success(t("toastSyncSuccess", { total: data.total ?? 0 }));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastSyncFailed"));
    } finally {
      setSyncing(false);
    }
  }

  async function confirmDelete() {
    const target = templateToDelete;
    if (!target || deletingId) return;
    setDeletingId(target.id);
    try {
      const res = await fetch(`/api/whatsapp/templates/${target.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || t("toastDeleteFailed"));
      toast.success(t("toastDeleteSuccess"));
      setTemplateToDelete(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastDeleteFailed"));
    } finally {
      setDeletingId(null);
    }
  }

  function openNew() {
    setEditingTemplate(null);
    setDuplicateFrom(null);
    setWizardOpen(true);
  }

  function openEdit(tpl: MessageTemplate) {
    setEditingTemplate(tpl);
    setDuplicateFrom(null);
    setWizardOpen(true);
  }

  function openDuplicate(tpl: MessageTemplate) {
    setEditingTemplate(null);
    setDuplicateFrom(tpl);
    setWizardOpen(true);
  }

  if (templates === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          {(["all", "approved", "pending"] as FilterTab[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === f ? "bg-primary-soft text-primary" : "bg-card-2 text-muted-foreground hover:bg-muted"
              }`}
            >
              {t(`filter.${f}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={syncing ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {t("syncFromMeta")}
          </button>
          <button
            type="button"
            onClick={openNew}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("newTemplate")}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center gap-3 rounded-2xl bg-card p-10 text-center shadow-[var(--shadow)]">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <MessageSquareText className="h-6 w-6" />
          </div>
          <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
          <div className="space-y-2">
            {filtered.map((tpl) => {
              const statusKey = (tpl.status ?? "DRAFT") as MessageTemplateStatus;
              const status = templateStatusConfig[statusKey];
              const isSelected = selected?.id === tpl.id;
              return (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setSelectedId(tpl.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-left transition-colors ${
                    isSelected ? "bg-primary-soft" : "bg-card shadow-[var(--shadow)] hover:bg-muted"
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{tpl.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {tpl.category} · {tpl.language}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${status.classes}`}>
                      {tStatus(statusKey)}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(tpl);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && openEdit(tpl)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDuplicate(tpl);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && openDuplicate(tpl)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        setTemplateToDelete(tpl);
                      }}
                      onKeyDown={(e) => e.key === "Enter" && setTemplateToDelete(tpl)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-0 flex items-center justify-between">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("previewTitle")}
              </p>
              {selected && (
                <span
                  className={`mb-2 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${
                    templateStatusConfig[(selected.status ?? "DRAFT") as MessageTemplateStatus].classes
                  }`}
                >
                  {tStatus((selected.status ?? "DRAFT") as MessageTemplateStatus)}
                </span>
              )}
            </div>
            {selected ? (
              <div className="sticky top-6 rounded-2xl bg-card p-2 shadow-[var(--shadow)]">
                <TemplateBubblePreview
                  headerType={selected.header_type}
                  headerContent={selected.header_content}
                  headerMediaUrl={selected.header_media_url}
                  headerSamples={selected.sample_values?.header ?? []}
                  bodyText={selected.body_text}
                  bodySamples={selected.sample_values?.body ?? []}
                  footerText={selected.footer_text}
                  buttons={selected.buttons}
                />
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-2xl bg-card text-xs text-muted-foreground shadow-[var(--shadow)]">
                {t("noPreview")}
              </div>
            )}
          </div>
        </div>
      )}

      <TemplateWizardDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        template={editingTemplate}
        duplicateFrom={duplicateFrom}
        onSaved={load}
        onDeleted={load}
      />

      <Dialog open={templateToDelete !== null} onOpenChange={(o) => !o && setTemplateToDelete(null)}>
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-sm">
          <div className="p-4">
            <h3 className="text-sm font-semibold text-popover-foreground">{t("deleteDialogTitle")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {templateToDelete?.meta_template_id
                ? t("deleteMetaDesc", { name: templateToDelete?.name ?? "" })
                : t("deleteLocalDesc", { name: templateToDelete?.name ?? "" })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTemplateToDelete(null)}
                disabled={deletingId !== null}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deletingId !== null}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deletingId !== null ? t("deleting") : t("delete")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
