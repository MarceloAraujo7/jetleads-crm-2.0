"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type {
  AccountMember,
  Campaign,
  CampaignAction,
  CampaignActionType,
  CampaignStatus,
  LeadDistributionStrategy,
  MessageTemplate,
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
import { Plus, Trash2, Radio, Zap, Workflow, Bot, Loader2, Upload, UserPlus, Send, Check } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { ImportModal } from "@/components/contacts/import-modal";
import { InviteMemberDialog } from "@/components/settings/invite-member-dialog";
import { useBroadcastSending } from "@/hooks/use-broadcast-sending";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";

interface EntityOption {
  id: string;
  label: string;
}

interface LeadBaseOption {
  id: string;
  name: string;
}

const NEW_LEAD_BASE = "__new__";
// 'manual' isn't a stored strategy value — it maps to
// lead_bases.distribution_enabled=false, matching the account-wide
// distribution-settings-dialog.tsx convention.
type StrategyChoice = "manual" | LeadDistributionStrategy;
const STRATEGY_CHOICES: StrategyChoice[] = ["manual", "least_loaded", "round_robin", "equal"];

interface ActionRow {
  localId: string;
  action_type: CampaignActionType;
  title: string;
  linkedId: string;
  /** Broadcast rows only — the template picked before "Criar e enviar
   *  disparo" is clicked. Cleared (and irrelevant) once linkedId is
   *  set, since a campaign always creates a brand-new broadcast
   *  rather than reusing an existing one. */
  pendingTemplateId?: string;
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

  const [approvedTemplates, setApprovedTemplates] = useState<MessageTemplate[]>([]);
  const [automations, setAutomations] = useState<EntityOption[]>([]);
  const [flows, setFlows] = useState<EntityOption[]>([]);
  const [aiConfigId, setAiConfigId] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [creatingBroadcastFor, setCreatingBroadcastFor] = useState<string | null>(null);
  const { createAndSendBroadcast } = useBroadcastSending();

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Lead base — the campaign's real, contact-linked audience. Empty
  // string keeps the legacy free-text audienceLabel/audienceCount
  // path for campaigns that don't need one.
  const [leadBases, setLeadBases] = useState<LeadBaseOption[]>([]);
  const [leadBaseId, setLeadBaseId] = useState<string>("");
  const [newBaseName, setNewBaseName] = useState("");
  const [creatingBase, setCreatingBase] = useState(false);
  const [liveContactCount, setLiveContactCount] = useState<number | null>(null);
  const [leadBaseDetailsLoading, setLeadBaseDetailsLoading] = useState(false);

  const [accountMembers, setAccountMembers] = useState<AccountMember[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set());
  const [quotaByUser, setQuotaByUser] = useState<Map<string, string>>(new Map());
  const [distributionChoice, setDistributionChoice] = useState<StrategyChoice>("manual");

  const [importOpen, setImportOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

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
    setNewBaseName("");
    setLeadBaseId(campaign?.lead_base_id ?? "");
    if (!campaign?.lead_base_id) {
      setSelectedMemberIds(new Set());
      setQuotaByUser(new Map());
      setDistributionChoice("manual");
      setLiveContactCount(null);
    }
  }, [open, campaign, initialActions]);

  // Lead bases (for the picker) + account roster (for the team
  // checklist) — fetched once per open, independent of the action
  // entity lists below.
  useEffect(() => {
    if (!open || !accountId) return;
    (async () => {
      const [basesRes, membersRes] = await Promise.all([
        supabase.from("lead_bases").select("id, name").order("created_at", { ascending: false }),
        fetch("/api/account/members", { cache: "no-store" }),
      ]);
      setLeadBases((basesRes.data ?? []).map((b) => ({ id: b.id, name: b.name })));
      if (membersRes.ok) {
        const data = (await membersRes.json()) as { members: AccountMember[] };
        setAccountMembers(data.members ?? []);
      }
    })();
  }, [open, accountId, supabase]);

  const loadLeadBaseDetails = useCallback(
    async (id: string) => {
      setLeadBaseDetailsLoading(true);
      try {
        const [baseRes, membersRes, countRes] = await Promise.all([
          supabase
            .from("lead_bases")
            .select("distribution_enabled, distribution_strategy")
            .eq("id", id)
            .maybeSingle(),
          supabase.from("lead_base_members").select("user_id, daily_lead_quota").eq("lead_base_id", id),
          supabase.from("contacts").select("id", { count: "exact", head: true }).eq("lead_base_id", id),
        ]);
        setDistributionChoice(
          baseRes.data?.distribution_enabled
            ? ((baseRes.data.distribution_strategy as LeadDistributionStrategy) ?? "least_loaded")
            : "manual",
        );
        setSelectedMemberIds(new Set((membersRes.data ?? []).map((m) => m.user_id as string)));
        setQuotaByUser(
          new Map(
            (membersRes.data ?? []).map((m) => [
              m.user_id as string,
              m.daily_lead_quota != null ? String(m.daily_lead_quota) : "",
            ]),
          ),
        );
        setLiveContactCount(countRes.count ?? 0);
      } finally {
        setLeadBaseDetailsLoading(false);
      }
    },
    [supabase],
  );

  useEffect(() => {
    if (!open) return;
    if (leadBaseId && leadBaseId !== NEW_LEAD_BASE) {
      loadLeadBaseDetails(leadBaseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadBaseId]);

  async function handleCreateBase() {
    if (!accountId || !newBaseName.trim() || creatingBase) return;
    setCreatingBase(true);
    try {
      const { data, error } = await supabase
        .from("lead_bases")
        .insert({ account_id: accountId, name: newBaseName.trim() })
        .select("id, name")
        .single();
      if (error) throw error;
      setLeadBases((prev) => [{ id: data.id, name: data.name }, ...prev]);
      setLeadBaseId(data.id);
      setLiveContactCount(0);
      setSelectedMemberIds(new Set());
      setQuotaByUser(new Map());
      setDistributionChoice("manual");
      setNewBaseName("");
    } catch {
      toast.error(t("toastFailedCreateBase"));
    } finally {
      setCreatingBase(false);
    }
  }

  function toggleMember(userId: string) {
    setSelectedMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  useEffect(() => {
    if (!open || !accountId) return;
    setOptionsLoading(true);
    (async () => {
      const [templatesRes, automationsRes, flowsRes, aiConfigRes] = await Promise.all([
        supabase
          .from("message_templates")
          .select("*")
          .eq("status", "APPROVED")
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
      // Restricted to 0-or-1 body variable so it can be auto-mapped to
      // the contact's name with no personalization step here — a
      // template with more variables needs the full /broadcasts/new
      // wizard to map them correctly.
      setApprovedTemplates(
        ((templatesRes.data ?? []) as MessageTemplate[]).filter(
          (tpl) => extractVariableIndices(tpl.body_text).length <= 1,
        ),
      );
      setAutomations((automationsRes.data ?? []).map((a) => ({ id: a.id, label: a.name })));
      setFlows((flowsRes.data ?? []).map((f) => ({ id: f.id, label: f.name })));
      setAiConfigId(aiConfigRes.data?.id ?? null);
      setOptionsLoading(false);
    })();
  }, [open, accountId, supabase]);

  const optionsForType = useCallback(
    (type: CampaignActionType): EntityOption[] => {
      if (type === "automation") return automations;
      if (type === "flow") return flows;
      if (type === "agent") return aiConfigId ? [{ id: aiConfigId, label: tType("agent") }] : [];
      return [];
    },
    [automations, flows, aiConfigId, tType],
  );

  async function handleCreateBroadcast(row: ActionRow) {
    const template = approvedTemplates.find((tpl) => tpl.id === row.pendingTemplateId);
    if (!template || !accountId || leadBaseId === NEW_LEAD_BASE || !leadBaseId) return;
    if (!window.confirm(t("confirmSendBroadcast", { count: liveContactCount ?? 0 }))) return;

    setCreatingBroadcastFor(row.localId);
    try {
      const bodyVarCount = extractVariableIndices(template.body_text).length;
      const variables: Record<string, { type: "field"; value: string }> =
        bodyVarCount > 0 ? { "1": { type: "field", value: "name" } } : {};
      const broadcastId = await createAndSendBroadcast({
        name: row.title.trim() || template.name,
        template,
        audience: { type: "lead_base", leadBaseId },
        variables,
      });
      updateRow(row.localId, { linkedId: broadcastId, pendingTemplateId: undefined });
      toast.success(t("toastBroadcastCreated"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toastBroadcastFailed"));
    } finally {
      setCreatingBroadcastFor(null);
    }
  }

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
    rows.every((r) => r.title.trim().length > 0 && r.linkedId.length > 0) &&
    leadBaseId !== NEW_LEAD_BASE;

  async function handleSave() {
    if (!accountId || !canSave) return;
    setSaving(true);
    try {
      const hasLeadBase = leadBaseId && leadBaseId !== NEW_LEAD_BASE;

      if (hasLeadBase) {
        const { error: baseError } = await supabase
          .from("lead_bases")
          .update({
            distribution_enabled: distributionChoice !== "manual",
            distribution_strategy: distributionChoice === "manual" ? "least_loaded" : distributionChoice,
          })
          .eq("id", leadBaseId);
        if (baseError) throw baseError;

        const { error: delMembersError } = await supabase
          .from("lead_base_members")
          .delete()
          .eq("lead_base_id", leadBaseId);
        if (delMembersError) throw delMembersError;

        if (selectedMemberIds.size > 0) {
          const memberRows = Array.from(selectedMemberIds).map((userId) => ({
            lead_base_id: leadBaseId,
            user_id: userId,
            daily_lead_quota: quotaByUser.get(userId)?.trim() ? Number(quotaByUser.get(userId)) : null,
          }));
          const { error: insMembersError } = await supabase.from("lead_base_members").insert(memberRows);
          if (insMembersError) throw insMembersError;
        }
      }

      let campaignId = campaign?.id;
      const payload = {
        account_id: accountId,
        name: name.trim(),
        audience_label: hasLeadBase ? null : audienceLabel.trim() || null,
        audience_count: hasLeadBase ? null : audienceCount ? Number(audienceCount) : null,
        lead_base_id: hasLeadBase ? leadBaseId : null,
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
    <>
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

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("leadBase")}</Label>
              <select
                value={leadBaseId}
                onChange={(e) => setLeadBaseId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("leadBaseNone")}</option>
                {leadBases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value={NEW_LEAD_BASE}>{t("leadBaseCreateNew")}</option>
              </select>
            </div>

            {leadBaseId === NEW_LEAD_BASE && (
              <div className="flex gap-2">
                <Input
                  value={newBaseName}
                  onChange={(e) => setNewBaseName(e.target.value)}
                  placeholder={t("leadBaseNamePlaceholder")}
                  className="border-border bg-muted text-foreground"
                />
                <Button
                  type="button"
                  onClick={handleCreateBase}
                  disabled={creatingBase || !newBaseName.trim()}
                  className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {creatingBase ? <Loader2 className="h-4 w-4 animate-spin" /> : t("leadBaseCreate")}
                </Button>
              </div>
            )}

            {!leadBaseId && (
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
            )}

            {leadBaseId && leadBaseId !== NEW_LEAD_BASE && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {leadBaseDetailsLoading ? t("loadingBaseDetails") : t("leadBaseContactCount", { count: liveContactCount ?? 0 })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setImportOpen(true)}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                  >
                    <Upload className="h-3 w-3" />
                    {t("importLeads")}
                  </button>
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-muted-foreground">{t("team")}</Label>
                    <button
                      type="button"
                      onClick={() => setInviteOpen(true)}
                      className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
                    >
                      <UserPlus className="h-3 w-3" />
                      {t("inviteMember")}
                    </button>
                  </div>
                  {accountMembers.length === 0 ? (
                    <p className="rounded-xl bg-card-2 px-3 py-3 text-xs text-muted-foreground">{t("noMembers")}</p>
                  ) : (
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl bg-card-2 p-2">
                      {accountMembers.map((m) => {
                        const checked = selectedMemberIds.has(m.user_id);
                        return (
                          <div key={m.user_id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMember(m.user_id)}
                              className="h-3.5 w-3.5 accent-primary"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                              {m.full_name || m.email || m.user_id}
                            </span>
                            {checked && distributionChoice !== "manual" && (
                              <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                placeholder={t("noLimit")}
                                value={quotaByUser.get(m.user_id) ?? ""}
                                onChange={(e) =>
                                  setQuotaByUser((prev) => new Map(prev).set(m.user_id, e.target.value))
                                }
                                className="h-7 w-16 shrink-0 rounded-md border border-border bg-muted px-1.5 text-[11px] text-foreground outline-none focus:border-primary"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("distribution")}</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {STRATEGY_CHOICES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDistributionChoice(s)}
                        className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                          distributionChoice === s
                            ? "border-primary bg-primary-soft text-primary"
                            : "border-border text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {t(`strategy.${s}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

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
                        ) : row.action_type === "broadcast" ? (
                          row.linkedId ? (
                            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-primary">
                              <Check className="h-3 w-3" />
                              {t("broadcastCreated")}
                            </p>
                          ) : !leadBaseId || leadBaseId === NEW_LEAD_BASE ? (
                            <p className="mt-1.5 text-[11px] text-amber-500">{t("broadcastNeedsBase")}</p>
                          ) : (
                            <div className="mt-2 space-y-2">
                              <select
                                value={row.pendingTemplateId ?? ""}
                                onChange={(e) => updateRow(row.localId, { pendingTemplateId: e.target.value })}
                                className="h-8 w-full rounded-lg border border-border bg-muted px-2 text-xs text-foreground outline-none focus:border-primary"
                              >
                                <option value="">{t("selectTemplate")}</option>
                                {approvedTemplates.map((tpl) => (
                                  <option key={tpl.id} value={tpl.id}>
                                    {tpl.name}
                                  </option>
                                ))}
                              </select>
                              {approvedTemplates.length === 0 && (
                                <p className="text-[11px] text-amber-500">{t("noCompatibleTemplates")}</p>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleCreateBroadcast(row)}
                                disabled={!row.pendingTemplateId || creatingBroadcastFor === row.localId}
                                className="h-8 w-full bg-primary text-xs text-primary-foreground hover:bg-primary/90"
                              >
                                {creatingBroadcastFor === row.localId ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Send className="h-3.5 w-3.5" />
                                )}
                                {t("createAndSendBroadcast")}
                              </Button>
                            </div>
                          )
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
                        {options.length === 0 && row.action_type !== "agent" && row.action_type !== "broadcast" && (
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

    {leadBaseId && leadBaseId !== NEW_LEAD_BASE && (
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        defaultLeadBaseId={leadBaseId}
        lockLeadBase
        onImported={() => loadLeadBaseDetails(leadBaseId)}
      />
    )}

    <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} onCreated={() => {}} />
    </>
  );
}
