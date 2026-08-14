"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { GatedButton } from "@/components/ui/gated-button";
import { Button } from "@/components/ui/button";
import { CampaignForm } from "@/components/campaigns/campaign-form";
import { loadCampaignActionsWithProgress } from "@/lib/campaigns/action-progress";
import { actionStatusConfig, campaignStatusConfig } from "@/lib/campaigns/action-status";
import type {
  Campaign,
  CampaignAction,
  CampaignActionWithProgress,
  CampaignStatus,
} from "@/types";
import {
  Loader2,
  Megaphone,
  Plus,
  Pencil,
  Copy,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

type StatusFilter = CampaignStatus;

interface CampaignWithActions {
  campaign: Campaign;
  actions: CampaignActionWithProgress[];
}

function ActionCard({ action }: { action: CampaignActionWithProgress }) {
  const t = useTranslations("Campaigns");
  const status = actionStatusConfig[action.statusKey];

  return (
    <div className="min-w-0 rounded-xl bg-card-2 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {t(`actionType.${action.action_type}`)}
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${status.classes}`}
        >
          {status.pulse && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
          )}
          {t(`actionStatus.${action.statusKey}`)}
        </span>
      </div>
      <p className="mt-2 truncate text-[13px] font-semibold text-foreground">{action.title}</p>
      {action.subtitle && (
        <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{action.subtitle}</p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-1.5 rounded-full bg-primary"
            style={{ width: `${action.progressPercent ?? 0}%` }}
          />
        </div>
        <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {action.progressPercent != null ? `${action.progressPercent}%` : "—"}
        </span>
      </div>
    </div>
  );
}

function CampaignCard({
  entry,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  entry: CampaignWithActions;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("Campaigns");
  const { campaign, actions } = entry;
  const status = campaignStatusConfig[campaign.status];

  return (
    <div className="rounded-2xl bg-card p-[18px] shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-bold text-foreground">{campaign.name}</h3>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.classes}`}
            >
              {status.pulse && (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
                </span>
              )}
              {t(`status.${campaign.status}`)}
            </span>
          </div>
          {(campaign.audience_label || campaign.audience_count != null) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {[campaign.audience_label, campaign.audience_count != null ? t("audienceLeads", { count: campaign.audience_count }) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("actionsInParallel", { count: actions.length })}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t("edit")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDuplicate}
            className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
            {t("duplicate")}
          </Button>
          <button
            type="button"
            onClick={onDelete}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {actions.map((action) => (
          <ActionCard key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}

export default function CampaignsPage() {
  const t = useTranslations("Campaigns");
  const { accountId } = useAuth();
  const canCreate = useCan("send-messages");

  const [entries, setEntries] = useState<CampaignWithActions[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("running");

  const [formOpen, setFormOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<CampaignWithActions | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: campaigns, error: campaignsError } = await supabase
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (campaignsError) throw campaignsError;

      const { data: actions, error: actionsError } = await supabase
        .from("campaign_actions")
        .select("*")
        .order("position", { ascending: true });
      if (actionsError) throw actionsError;

      const actionsByCampaign = new Map<string, CampaignAction[]>();
      for (const action of actions ?? []) {
        const list = actionsByCampaign.get(action.campaign_id) ?? [];
        list.push(action);
        actionsByCampaign.set(action.campaign_id, list);
      }

      const withProgress = await Promise.all(
        (campaigns ?? []).map(async (campaign) => ({
          campaign,
          actions: await loadCampaignActionsWithProgress(
            actionsByCampaign.get(campaign.id) ?? [],
            t,
          ),
        })),
      );

      setEntries(withProgress);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errorLoad"));
    } finally {
      setLoading(false);
    }
    // `t` is stable across renders for a fixed locale — omitting it keeps
    // this from re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const counts = useMemo(() => {
    const c = { running: 0, scheduled: 0, completed: 0 };
    for (const e of entries ?? []) c[e.campaign.status]++;
    return c;
  }, [entries]);

  const visible = useMemo(
    () => (entries ?? []).filter((e) => e.campaign.status === filter),
    [entries, filter],
  );

  async function handleDuplicate(entry: CampaignWithActions) {
    if (!accountId) return;
    const supabase = createClient();
    const { data: newCampaign, error: campaignError } = await supabase
      .from("campaigns")
      .insert({
        account_id: accountId,
        name: t("duplicateName", { name: entry.campaign.name }),
        audience_label: entry.campaign.audience_label,
        audience_count: entry.campaign.audience_count,
        status: "scheduled",
      })
      .select("id")
      .single();
    if (campaignError || !newCampaign) {
      toast.error(t("toastFailedDuplicate"));
      return;
    }
    const actionRows = entry.actions.map((a, i) => ({
      campaign_id: newCampaign.id,
      action_type: a.action_type,
      title: a.title,
      position: i,
      broadcast_id: a.broadcast_id,
      automation_id: a.automation_id,
      flow_id: a.flow_id,
      ai_config_id: a.ai_config_id,
    }));
    if (actionRows.length > 0) {
      await supabase.from("campaign_actions").insert(actionRows);
    }
    toast.success(t("toastDuplicated"));
    fetchCampaigns();
  }

  async function handleDelete(entry: CampaignWithActions) {
    if (!window.confirm(t("deleteConfirm", { name: entry.campaign.name }))) return;
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("campaigns")
      .delete()
      .eq("id", entry.campaign.id);
    if (deleteError) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    fetchCampaigns();
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("subtitle", { count: entries?.length ?? 0, actionCount: (entries ?? []).reduce((sum, e) => sum + e.actions.length, 0) })}
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create campaigns"
          onClick={() => {
            setEditingEntry(null);
            setFormOpen(true);
          }}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t("newCampaign")}
        </GatedButton>
      </div>

      <div className="flex items-center gap-2">
        {(["running", "scheduled", "completed"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === s
                ? "bg-primary-soft text-primary"
                : "bg-card-2 text-muted-foreground hover:bg-muted"
            }`}
          >
            {t(`status.${s}`)} · {counts[s]}
          </button>
        ))}
      </div>

      {(entries?.length ?? 0) === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center rounded-2xl bg-card shadow-[var(--shadow)]">
          <Megaphone className="mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">{t("noCampaignsYet")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("createFirst")}</p>
          <GatedButton
            canAct={canCreate}
            gateReason="create campaigns"
            onClick={() => {
              setEditingEntry(null);
              setFormOpen(true);
            }}
            className="mt-4 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t("newCampaign")}
          </GatedButton>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl bg-card shadow-[var(--shadow)]">
          <p className="text-sm text-muted-foreground">{t("noCampaignsInFilter")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((entry) => (
            <CampaignCard
              key={entry.campaign.id}
              entry={entry}
              onEdit={() => {
                setEditingEntry(entry);
                setFormOpen(true);
              }}
              onDuplicate={() => handleDuplicate(entry)}
              onDelete={() => handleDelete(entry)}
            />
          ))}
        </div>
      )}

      <CampaignForm
        open={formOpen}
        onOpenChange={setFormOpen}
        campaign={editingEntry?.campaign ?? null}
        initialActions={editingEntry?.actions}
        onSaved={fetchCampaigns}
      />
    </div>
  );
}
