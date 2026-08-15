"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Copy, Trash2, RefreshCw, Loader2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { templateStatusConfig } from "@/lib/template-status";
import { TemplateBubblePreview } from "@/components/whatsapp/template-bubble-preview";
import { TemplateWizardDialog } from "@/components/whatsapp/template-wizard-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { MessageTemplate, MessageTemplateStatus } from "@/types";
import { useTranslations } from "next-intl";

type FilterTab = "all" | "approved" | "pending";

interface TemplateListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TemplateListDialog({ open, onOpenChange }: TemplateListDialogProps) {
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
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setFilter("all");
  }, [open]);

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

  return (
    <>
      <Dialog open={open && !wizardOpen} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[min(90vh,720px)] w-full flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground sm:max-w-4xl">
          <div className="flex items-start justify-between gap-3 border-b border-border/50 p-4">
            <div>
              <h2 className="text-base font-bold text-popover-foreground">{t("title")}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("subtitle", { count: templates?.length ?? 0 })}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                title={t("syncFromMeta")}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={syncing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1fr_280px]">
            <div className="flex min-h-0 flex-col gap-3">
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

              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                {templates === null ? (
                  <div className="flex items-center justify-center py-10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="rounded-xl bg-card-2 px-3.5 py-6 text-center text-xs text-muted-foreground">
                    {t("noTemplates")}
                  </p>
                ) : (
                  filtered.map((tpl) => {
                    const statusKey = (tpl.status ?? "DRAFT") as MessageTemplateStatus;
                    const status = templateStatusConfig[statusKey];
                    const isSelected = selected?.id === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => setSelectedId(tpl.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-left transition-colors ${
                          isSelected ? "bg-primary-soft" : "bg-card-2 hover:bg-muted"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{tpl.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {tpl.category} · {tpl.language}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${status.classes}`}
                          >
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
                  })
                )}
              </div>

              <button
                type="button"
                onClick={openNew}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2.5 text-xs font-medium text-primary hover:bg-primary-soft"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("newTemplate")}
              </button>
            </div>

            <div className="hidden lg:block">
              <div className="flex items-center justify-between">
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
                <div className="rounded-2xl bg-card p-2 shadow-[var(--shadow)]">
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

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/50 bg-popover/80 p-4">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
            >
              {t("close")}
            </button>
            <button
              type="button"
              onClick={openNew}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              {t("newTemplate")}
            </button>
          </div>
        </DialogContent>
      </Dialog>

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
