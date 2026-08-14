"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  Campaign,
  CampaignAction,
  CampaignActionType,
  CampaignStatus,
} from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Radio, Zap, Workflow, Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface EntityOption {
  id: string;
  label: string;
}

interface ActionRow {
  localId: string;
  action_type: CampaignActionType;
  title: string;
  linkedId: string;
}

interface CampaignFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign?: Campaign | null;
  initialActions?: CampaignAction[];
  onSaved: () => void;
}

const ACTION_TYPE_ICON: Record<CampaignActionType, typeof Radio> = {
  broadcast: Radio,
  automation: Zap,
  flow: Workflow,
  agent: Bot,
};

function newRow(action_type: CampaignActionType): ActionRow {
  return { localId: crypto.randomUUID(), action_type, title: "", linkedId: "" };
}

export function CampaignForm({
  open,
  onOpenChange,
  campaign,
  initialActions,
  onSaved,
}: CampaignFormProps) {
  const t = useTranslations("Campaigns.form");
  const tType = useTranslations("Campaigns.actionType");
  const supabase = createClient();
  const { accountId } = useAuth();

  const [name, setName] = useState("");
  const [audienceLabel, setAudienceLabel] = useState("");
  const [audienceCount, setAudienceCount] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("scheduled");
  const [rows, setRows] = useState<ActionRow[]>([]);

  const [broadcasts, setBroadcasts] = useState<EntityOption[]>([]);
  const [automations, setAutomations] = useState<EntityOption[]>([]);
  const [flows, setFlows] = useState<EntityOption[]>([]);
  const [aiConfigId, setAiConfigId] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(campaign?.name ?? "");
    setAudienceLabel(campaign?.audience_label ?? "");
    setAudienceCount(campaign?.audience_count?.toString() ?? "");
    setStatus(campaign?.status ?? "scheduled");
    setRows(
      (initialActions ?? []).map((a) => ({
        localId: a.id,
        action_type: a.action_type,
        title: a.title,
        linkedId: a.broadcast_id ?? a.automation_id ?? a.flow_id ?? a.ai_config_id ?? "",
      })),
    );
    setConfirmDelete(false);
  }, [open, campaign, initialActions]);

  useEffect(() => {
    if (!open || !accountId) return;
    setOptionsLoading(true);
    (async () => {
      const [broadcastsRes, automationsRes, flowsRes, aiConfigRes] = await Promise.all([
        supabase
          .from("broadcasts")
          .select("id, name")
          .order("created_at", { ascending: false }),
        supabase
          .from("automations")
          .select("id, name")
          .order("created_at", { ascending: false }),
        supabase
          .from("flows")
          .select("id, name")
          .order("created_at", { ascending: false }),
        supabase.from("ai_configs").select("id").maybeSingle(),
      ]);
      setBroadcasts((broadcastsRes.data ?? []).map((b) => ({ id: b.id, label: b.name })));
      setAutomations((automationsRes.data ?? []).map((a) => ({ id: a.id, label: a.name })));
      setFlows((flowsRes.data ?? []).map((f) => ({ id: f.id, label: f.name })));
      setAiConfigId(aiConfigRes.data?.id ?? null);
      setOptionsLoading(false);
    })();
  }, [open, accountId, supabase]);

  const optionsForType = useCallback(
    (type: CampaignActionType): EntityOption[] => {
      if (type === "broadcast") return broadcasts;
      if (type === "automation") return automations;
      if (type === "flow") return flows;
      return aiConfigId ? [{ id: aiConfigId, label: tType("agent") }] : [];
    },
    [broadcasts, automations, flows, aiConfigId, tType],
  );

  const availableTypes = useMemo<CampaignActionType[]>(() => {
    const types: CampaignActionType[] = ["broadcast", "automation", "flow"];
    if (aiConfigId) types.push("agent");
    return types;
  }, [aiConfigId]);

  function updateRow(localId: string, patch: Partial<ActionRow>) {
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, newRow(availableTypes[0] ?? "broadcast")]);
  }

  function removeRow(localId: string) {
    setRows((prev) => prev.filter((r) => r.localId !== localId));
  }

  const canSave =
    name.trim().length > 0 &&
    rows.length > 0 &&
    rows.every((r) => r.title.trim().length > 0 && r.linkedId.length > 0);

  async function handleSave() {
    if (!accountId || !canSave) return;
    setSaving(true);
    try {
      let campaignId = campaign?.id;
      const payload = {
        account_id: accountId,
        name: name.trim(),
        audience_label: audienceLabel.trim() || null,
        audience_count: audienceCount ? Number(audienceCount) : null,
        status,
      };

      if (campaignId) {
        const { error } = await supabase.from("campaigns").update(payload).eq("id", campaignId);
        if (error) throw error;
        const { error: delError } = await supabase
          .from("campaign_actions")
          .delete()
          .eq("campaign_id", campaignId);
        if (delError) throw delError;
      } else {
        const { data, error } = await supabase
          .from("campaigns")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        campaignId = data.id;
      }

      const actionRows = rows.map((r, i) => ({
        campaign_id: campaignId,
        action_type: r.action_type,
        title: r.title.trim(),
        position: i,
        broadcast_id: r.action_type === "broadcast" ? r.linkedId : null,
        automation_id: r.action_type === "automation" ? r.linkedId : null,
        flow_id: r.action_type === "flow" ? r.linkedId : null,
        ai_config_id: r.action_type === "agent" ? r.linkedId : null,
      }));
      const { error: actionsError } = await supabase.from("campaign_actions").insert(actionRows);
      if (actionsError) throw actionsError;

      toast.success(campaign ? t("toastSaved") : t("toastCreated"));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t("toastFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!campaign) return;
    setDeleting(true);
    const { error } = await supabase.from("campaigns").delete().eq("id", campaign.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,760px)] w-full flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground sm:max-w-lg">
        <div className="flex h-full flex-col">
          <DialogHeader className="shrink-0 border-b border-border/50 p-4">
            <DialogTitle className="text-popover-foreground">
              {campaign ? t("editCampaign") : t("newCampaign")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("audienceLabel")}</Label>
                <Input
                  value={audienceLabel}
                  onChange={(e) => setAudienceLabel(e.target.value)}
                  placeholder={t("audienceLabelPlaceholder")}
                  className="border-border bg-muted text-foreground"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("audienceCount")}</Label>
                <Input
                  type="number"
                  value={audienceCount}
                  onChange={(e) => setAudienceCount(e.target.value)}
                  placeholder="0"
                  className="border-border bg-muted text-foreground"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("status")}</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as CampaignStatus)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="running">{t("statusRunning")}</option>
                <option value="scheduled">{t("statusScheduled")}</option>
                <option value="completed">{t("statusCompleted")}</option>
              </select>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-muted-foreground">{t("actions")}</Label>
                <button
                  type="button"
                  onClick={addRow}
                  disabled={optionsLoading}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" />
                  {t("addAction")}
                </button>
              </div>

              {optionsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : rows.length === 0 ? (
                <p className="rounded-xl bg-card-2 px-3 py-3 text-xs text-muted-foreground">
                  {t("noActionsYet")}
                </p>
              ) : (
                <div className="space-y-2">
                  {rows.map((row) => {
                    const Icon = ACTION_TYPE_ICON[row.action_type];
                    const options = optionsForType(row.action_type);
                    return (
                      <div key={row.localId} className="rounded-xl bg-card-2 p-3">
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <select
                            value={row.action_type}
                            onChange={(e) =>
                              updateRow(row.localId, {
                                action_type: e.target.value as CampaignActionType,
                                linkedId: "",
                              })
                            }
                            className="h-8 rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                          >
                            {availableTypes.map((type) => (
                              <option key={type} value={type}>
                                {tType(type)}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => removeRow(row.localId)}
                            className="ml-auto text-muted-foreground hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <Input
                          value={row.title}
                          onChange={(e) => updateRow(row.localId, { title: e.target.value })}
                          placeholder={t("actionTitlePlaceholder")}
                          className="mt-2 h-8 border-border bg-muted text-xs text-foreground"
                        />

                        {row.action_type === "agent" ? (
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            {t("agentLinkedNote")}
                          </p>
                        ) : (
                          <select
                            value={row.linkedId}
                            onChange={(e) => updateRow(row.localId, { linkedId: e.target.value })}
                            className="mt-2 h-8 w-full rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                          >
                            <option value="">{t("selectEntity")}</option>
                            {options.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        )}
                        {options.length === 0 && row.action_type !== "agent" && (
                          <p className="mt-1.5 text-[11px] text-amber-500">
                            {t("noEntitiesOfType", { type: tType(row.action_type) })}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !canSave}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : campaign ? t("saveChanges") : t("createCampaign")}
              </Button>
            </div>

            {campaign &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteCampaign")}
                </button>
              ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
