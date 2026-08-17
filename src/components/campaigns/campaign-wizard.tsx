"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  Plus,
  Trash2,
  Radio,
  Zap,
  Workflow,
  Bot,
  Loader2,
  Upload,
  UserPlus,
  Send,
  Check,
  ArrowLeft,
  ArrowRight,
  Users,
  ExternalLink,
} from "lucide-react";
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
const STEP_KEYS = ["details", "audience", "team", "broadcast", "flow", "actions"] as const;
type StepKey = (typeof STEP_KEYS)[number];
const STEP_LABEL_KEY: Record<StepKey, string> = {
  details: "stepDetails",
  audience: "stepAudience",
  team: "stepTeam",
  broadcast: "stepBroadcast",
  flow: "stepFlow",
  actions: "stepActions",
};
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

interface CampaignWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent (undefined/null) = creating a new campaign. */
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

/**
 * Campaign create/edit wizard — the account's central "everything
 * starts from a campaign" flow: lead base, team + distribution, the
 * broadcast(s) that reach that base, and the AI agent that qualifies
 * replies before handoff, all in one place. Rendered as a (large)
 * modal from the Campaigns list; the caller must pass a stable `key`
 * (e.g. the campaign id, or "new") when switching which campaign is
 * being edited so this remounts fresh — its initial state is seeded
 * once from props via lazy useState initializers, not re-synced on
 * prop changes.
 */
export function CampaignWizard({
  open,
  onOpenChange,
  campaign,
  initialActions,
  onSaved,
}: CampaignWizardProps) {
  const t = useTranslations("Campaigns.form");
  const tType = useTranslations("Campaigns.actionType");
  const router = useRouter();
  const supabase = createClient();
  const { accountId } = useAuth();

  const [name, setName] = useState(campaign?.name ?? "");
  const [audienceLabel, setAudienceLabel] = useState(campaign?.audience_label ?? "");
  const [audienceCount, setAudienceCount] = useState(campaign?.audience_count?.toString() ?? "");
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status ?? "scheduled");
  const [rows, setRows] = useState<ActionRow[]>(() =>
    (initialActions ?? []).map((a) => ({
      localId: a.id,
      action_type: a.action_type,
      title: a.title,
      linkedId: a.broadcast_id ?? a.automation_id ?? a.flow_id ?? a.ai_config_id ?? "",
    })),
  );

  const [approvedTemplates, setApprovedTemplates] = useState<MessageTemplate[]>([]);
  const [automations, setAutomations] = useState<EntityOption[]>([]);
  const [flows, setFlows] = useState<EntityOption[]>([]);
  const [aiConfigId, setAiConfigId] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const { createAndSendBroadcast } = useBroadcastSending();

  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Lead base — the campaign's real, contact-linked audience. Empty
  // string keeps the legacy free-text audienceLabel/audienceCount
  // path for campaigns that don't need one.
  const [leadBases, setLeadBases] = useState<LeadBaseOption[]>([]);
  const [leadBaseId, setLeadBaseId] = useState<string>(campaign?.lead_base_id ?? "");
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

  const [currentStepKey, setCurrentStepKey] = useState<StepKey>("details");
  const hasLeadBase = leadBaseId !== "" && leadBaseId !== NEW_LEAD_BASE;
  const steps = useMemo(
    () =>
      STEP_KEYS.filter((k) => k !== "team" || hasLeadBase).map((key) => ({
        key,
        label: t(STEP_LABEL_KEY[key]),
      })),
    [hasLeadBase, t],
  );
  const currentStepIndex = steps.findIndex((s) => s.key === currentStepKey);
  const isFirstStep = currentStepIndex <= 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  // "Team" only makes sense once a lead base is picked — if the user
  // clears the base while sitting on that step, bump forward rather
  // than stranding them on a step that just vanished from the list.
  useEffect(() => {
    if (currentStepKey === "team" && !hasLeadBase) {
      setCurrentStepKey("actions");
    }
  }, [currentStepKey, hasLeadBase]);

  function goNext() {
    if (currentStepIndex < steps.length - 1) setCurrentStepKey(steps[currentStepIndex + 1].key);
  }
  function goBack() {
    if (currentStepIndex > 0) setCurrentStepKey(steps[currentStepIndex - 1].key);
  }

  const canAdvanceFromCurrentStep =
    currentStepKey === "details"
      ? name.trim().length > 0
      : currentStepKey === "audience"
        ? leadBaseId !== NEW_LEAD_BASE
        : true;

  // Lead bases (for the picker) + account roster (for the team
  // checklist) — fetched once on mount, independent of the action
  // entity lists below.
  useEffect(() => {
    if (!accountId) return;
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
  }, [accountId, supabase]);

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
    if (leadBaseId && leadBaseId !== NEW_LEAD_BASE) {
      loadLeadBaseDetails(leadBaseId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadBaseId]);

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
    if (!accountId) return;
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
  }, [accountId, supabase]);

  const optionsForType = useCallback(
    (type: CampaignActionType): EntityOption[] => {
      if (type === "automation") return automations;
      if (type === "flow") return flows;
      if (type === "agent") return aiConfigId ? [{ id: aiConfigId, label: tType("agent") }] : [];
      return [];
    },
    [automations, flows, aiConfigId, tType],
  );

  /**
   * Sends one broadcast row's configured template — called from inside
   * handleSave's "Iniciar campanha" step, never directly from the
   * Disparo step's UI. A campaign's disparo(s) only actually go out
   * once every step is configured and the whole campaign is started,
   * not the moment a template is picked.
   */
  async function sendPendingBroadcast(row: ActionRow): Promise<string | null> {
    const template = approvedTemplates.find((tpl) => tpl.id === row.pendingTemplateId);
    if (!template || !accountId || !hasLeadBase) return null;
    const bodyVarCount = extractVariableIndices(template.body_text).length;
    const variables: Record<string, { type: "field"; value: string }> =
      bodyVarCount > 0 ? { "1": { type: "field", value: "name" } } : {};
    return createAndSendBroadcast({
      name: row.title.trim() || template.name,
      template,
      audience: { type: "lead_base", leadBaseId },
      variables,
    });
  }

  // "Disparo" and "Agente de IA" each have their own dedicated step now
  // (added to the wizard alongside Base de leads/Equipe) — this list is
  // only for the catch-all "Outras ações" step's per-row type picker.
  const availableTypes = useMemo<CampaignActionType[]>(() => {
    const types: CampaignActionType[] = ["automation"];
    if (aiConfigId) types.push("agent");
    return types;
  }, [aiConfigId]);

  function updateRow(localId: string, patch: Partial<ActionRow>) {
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));
  }

  function addRow(type: CampaignActionType) {
    setRows((prev) => [...prev, newRow(type)]);
  }

  function removeRow(localId: string) {
    setRows((prev) => prev.filter((r) => r.localId !== localId));
  }

  // Rows are grouped into steps by action_type — Disparo and Agente de
  // IA (Fluxo) get their own dedicated steps; automation/agent share
  // the catch-all "Outras ações" step.
  const broadcastRows = useMemo(() => rows.filter((r) => r.action_type === "broadcast"), [rows]);
  const flowRows = useMemo(() => rows.filter((r) => r.action_type === "flow"), [rows]);
  const otherRows = useMemo(
    () => rows.filter((r) => r.action_type === "automation" || r.action_type === "agent"),
    [rows],
  );

  // Broadcast rows are "configured" (template picked) rather than
  // "linked" until the campaign actually starts — sending is deferred
  // to handleSave, so a chosen template is enough to consider the row
  // complete here. Every other type still needs its entity picked.
  // A campaign is a valid shell on its own (base + team, no actions yet
  // — those can be added later by editing) — only *configured* rows
  // need to be individually valid, not "at least one must exist."
  const canSave =
    name.trim().length > 0 &&
    rows.every((r) => {
      if (r.title.trim().length === 0) return false;
      return r.action_type === "broadcast" ? Boolean(r.linkedId || r.pendingTemplateId) : r.linkedId.length > 0;
    }) &&
    leadBaseId !== NEW_LEAD_BASE;

  // Unsent broadcast rows about to fire when the campaign starts —
  // used both to gate the single combined confirm and to know which
  // rows handleSave still needs to actually send.
  const unsentBroadcastRows = useMemo(
    () => broadcastRows.filter((r) => !r.linkedId && r.pendingTemplateId),
    [broadcastRows],
  );

  async function handleSave() {
    if (!accountId || !canSave) return;
    if (
      unsentBroadcastRows.length > 0 &&
      !window.confirm(t("confirmSendBroadcast", { count: liveContactCount ?? 0 }))
    ) {
      return;
    }
    setSaving(true);
    try {
      const hasBase = leadBaseId && leadBaseId !== NEW_LEAD_BASE;

      if (hasBase) {
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
        audience_label: hasBase ? null : audienceLabel.trim() || null,
        audience_count: hasBase ? null : audienceCount ? Number(audienceCount) : null,
        lead_base_id: hasBase ? leadBaseId : null,
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

      // Everything is configured now — this is the moment the campaign
      // actually starts, so any broadcast row with a template picked
      // but not sent yet goes out here, not when the template was
      // originally selected on the Disparo step.
      const sentBroadcastIdByRow = new Map<string, string>();
      for (const row of unsentBroadcastRows) {
        const broadcastId = await sendPendingBroadcast(row);
        if (broadcastId) sentBroadcastIdByRow.set(row.localId, broadcastId);
      }
      if (sentBroadcastIdByRow.size < unsentBroadcastRows.length) {
        toast.error(t("toastBroadcastFailed"));
      } else if (unsentBroadcastRows.length > 0) {
        toast.success(t("toastBroadcastCreated"));
      }

      const actionRows = rows.map((r, i) => ({
        campaign_id: campaignId,
        action_type: r.action_type,
        title: r.title.trim(),
        position: i,
        broadcast_id: r.action_type === "broadcast" ? (r.linkedId || sentBroadcastIdByRow.get(r.localId) || null) : null,
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
    onOpenChange(false);
    onSaved();
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] w-full max-w-4xl overflow-y-auto bg-popover p-6 text-popover-foreground">
          <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {campaign ? t("editCampaign") : t("newCampaign")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("wizardSubtitle")}</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-between">
          {steps.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isDone = index < currentStepIndex;
            return (
              <div key={step.key} className="flex flex-1 items-center">
                <button
                  type="button"
                  onClick={() => index < currentStepIndex && setCurrentStepKey(step.key)}
                  disabled={index >= currentStepIndex}
                  className="flex items-center gap-2 disabled:cursor-default"
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-all ${
                      isDone
                        ? "bg-primary text-primary-foreground"
                        : isActive
                          ? "border-2 border-primary bg-primary/10 text-primary"
                          : "border border-border bg-muted text-muted-foreground"
                    }`}
                  >
                    {isDone ? <Check className="h-4 w-4" /> : index + 1}
                  </div>
                  <span
                    className={`hidden text-sm font-medium sm:block ${
                      isActive ? "text-foreground" : isDone ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {step.label}
                  </span>
                </button>
                {index < steps.length - 1 && (
                  <div className={`mx-3 h-px flex-1 ${index < currentStepIndex ? "bg-primary" : "bg-muted"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <div className="min-h-[420px] space-y-6 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow)]">
          {currentStepKey === "details" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t("stepDetails")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("stepDetailsHint")}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("name")}</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("namePlaceholder")}
                    className="border-border bg-muted text-foreground"
                    autoFocus
                  />
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
              </div>
            </div>
          )}

          {currentStepKey === "audience" && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t("stepAudience")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("stepAudienceHint")}</p>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("leadBase")}</Label>
                <select
                  value={leadBaseId}
                  onChange={(e) => setLeadBaseId(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary sm:max-w-sm"
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
                <div className="flex gap-2 sm:max-w-sm">
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
                <div className="grid gap-4 sm:grid-cols-2 sm:max-w-sm">
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

              {hasLeadBase && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-card-2 px-4 py-3">
                  <p className="text-sm text-muted-foreground">
                    {leadBaseDetailsLoading ? t("loadingBaseDetails") : t("leadBaseContactCount", { count: liveContactCount ?? 0 })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setImportOpen(true)}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {t("importLeads")}
                  </button>
                </div>
              )}
            </div>
          )}

          {currentStepKey === "team" && hasLeadBase && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t("stepTeam")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("stepTeamHint")}</p>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="text-muted-foreground">{t("team")}</Label>
                  <button
                    type="button"
                    onClick={() => setInviteOpen(true)}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    {t("inviteMember")}
                  </button>
                </div>
                {accountMembers.length === 0 ? (
                  <p className="rounded-xl bg-card-2 px-4 py-4 text-sm text-muted-foreground">{t("noMembers")}</p>
                ) : (
                  <div className="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto rounded-xl bg-card-2 p-2 sm:grid-cols-2">
                    {accountMembers.map((m) => {
                      const checked = selectedMemberIds.has(m.user_id);
                      return (
                        <div key={m.user_id} className="flex items-center gap-2 rounded-lg px-2 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMember(m.user_id)}
                            className="h-4 w-4 accent-primary"
                          />
                          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
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
                              className="h-7 w-16 shrink-0 rounded-md border border-border bg-muted px-1.5 text-xs text-foreground outline-none focus:border-primary"
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
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {STRATEGY_CHOICES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDistributionChoice(s)}
                      className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
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
            </div>
          )}

          {currentStepKey === "broadcast" && (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t("stepBroadcast")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("stepBroadcastHint")}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addRow("broadcast")}
                  className="shrink-0 border-border text-muted-foreground hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("addBroadcast")}
                </Button>
              </div>

              {broadcastRows.length === 0 ? (
                <p className="rounded-xl bg-card-2 px-4 py-4 text-sm text-muted-foreground">
                  {t("noBroadcastYet")}
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {broadcastRows.map((row) => {
                    const selectedTemplate = approvedTemplates.find((tpl) => tpl.id === row.pendingTemplateId);
                    return (
                      <Card key={row.localId} className="overflow-hidden">
                        <CardHeader className="flex-row items-start justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <Radio className="h-5 w-5" />
                            </div>
                            <Input
                              value={row.title}
                              onChange={(e) => updateRow(row.localId, { title: e.target.value })}
                              placeholder={t("actionTitlePlaceholder")}
                              className="h-auto border-none bg-transparent p-0 text-base font-semibold text-foreground shadow-none focus-visible:ring-0"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeRow(row.localId)}
                            className="shrink-0 text-muted-foreground hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {row.linkedId ? (
                            <>
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                                <Check className="h-3 w-3" />
                                {t("broadcastCreated")}
                              </span>
                              {selectedTemplate && (
                                <div className="rounded-lg bg-muted/60 p-3">
                                  <p className="text-xs font-semibold text-foreground">{selectedTemplate.name}</p>
                                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                    {selectedTemplate.body_text}
                                  </p>
                                </div>
                              )}
                              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Users className="h-3.5 w-3.5" />
                                {t("recipientsPreview", { count: liveContactCount ?? 0 })}
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => router.push(`/broadcasts/${row.linkedId}`)}
                                className="w-full border-border text-foreground hover:bg-muted"
                              >
                                {t("viewBroadcast")}
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          ) : !leadBaseId || leadBaseId === NEW_LEAD_BASE ? (
                            <p className="text-xs text-amber-500">{t("broadcastNeedsBase")}</p>
                          ) : (
                            <>
                              <select
                                value={row.pendingTemplateId ?? ""}
                                onChange={(e) => updateRow(row.localId, { pendingTemplateId: e.target.value })}
                                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                              >
                                <option value="">{t("selectTemplate")}</option>
                                {approvedTemplates.map((tpl) => (
                                  <option key={tpl.id} value={tpl.id}>
                                    {tpl.name}
                                  </option>
                                ))}
                              </select>
                              {selectedTemplate && (
                                <div className="rounded-lg bg-muted/60 p-3">
                                  <p className="line-clamp-3 text-xs text-muted-foreground">
                                    {selectedTemplate.body_text}
                                  </p>
                                </div>
                              )}
                              {approvedTemplates.length === 0 && (
                                <p className="text-xs text-amber-500">{t("noCompatibleTemplates")}</p>
                              )}
                              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <Users className="h-3.5 w-3.5" />
                                {t("recipientsPreview", { count: liveContactCount ?? 0 })}
                              </p>
                              {selectedTemplate && (
                                <p className="flex items-center gap-1.5 text-xs text-primary">
                                  <Send className="h-3.5 w-3.5" />
                                  {t("broadcastWillSendOnStart")}
                                </p>
                              )}
                            </>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {currentStepKey === "flow" && (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t("stepFlow")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("flowStepHint")}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addRow("flow")}
                  className="shrink-0 border-border text-muted-foreground hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("addFlow")}
                </Button>
              </div>

              {flowRows.length === 0 ? (
                <p className="rounded-xl bg-card-2 px-4 py-4 text-sm text-muted-foreground">{t("noFlowYet")}</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {flowRows.map((row) => (
                    <div key={row.localId} className="rounded-xl bg-card-2 p-4">
                      <div className="flex items-center gap-2">
                        <Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">{tType("flow")}</span>
                        <button
                          type="button"
                          onClick={() => removeRow(row.localId)}
                          className="ml-auto text-muted-foreground hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <Input
                        value={row.title}
                        onChange={(e) => updateRow(row.localId, { title: e.target.value })}
                        placeholder={t("actionTitlePlaceholder")}
                        className="mt-3 h-9 border-border bg-muted text-sm text-foreground"
                      />

                      <select
                        value={row.linkedId}
                        onChange={(e) => updateRow(row.localId, { linkedId: e.target.value })}
                        className="mt-3 h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                      >
                        <option value="">{t("selectEntity")}</option>
                        {flows.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                      {flows.length === 0 && (
                        <p className="mt-2 text-xs text-amber-500">
                          {t("noEntitiesOfType", { type: tType("flow") })}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {currentStepKey === "actions" && (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-foreground">{t("stepActions")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{t("stepActionsHint")}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addRow(availableTypes[0] ?? "automation")}
                  disabled={optionsLoading}
                  className="shrink-0 border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("addAction")}
                </Button>
              </div>

              {optionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : otherRows.length === 0 ? (
                <p className="rounded-xl bg-card-2 px-4 py-4 text-sm text-muted-foreground">
                  {t("noActionsYet")}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {otherRows.map((row) => {
                    const Icon = ACTION_TYPE_ICON[row.action_type];
                    const options = optionsForType(row.action_type);
                    return (
                      <div key={row.localId} className="rounded-xl bg-card-2 p-4">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <select
                            value={row.action_type}
                            onChange={(e) =>
                              updateRow(row.localId, {
                                action_type: e.target.value as CampaignActionType,
                                linkedId: "",
                              })
                            }
                            className="h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
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
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <Input
                          value={row.title}
                          onChange={(e) => updateRow(row.localId, { title: e.target.value })}
                          placeholder={t("actionTitlePlaceholder")}
                          className="mt-3 h-9 border-border bg-muted text-sm text-foreground"
                        />

                        {row.action_type === "agent" ? (
                          <p className="mt-3 text-xs text-muted-foreground">{t("agentLinkedNote")}</p>
                        ) : (
                          <select
                            value={row.linkedId}
                            onChange={(e) => updateRow(row.localId, { linkedId: e.target.value })}
                            className="mt-3 h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
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
                          <p className="mt-2 text-xs text-amber-500">
                            {t("noEntitiesOfType", { type: tType(row.action_type) })}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="outline"
            onClick={isFirstStep ? () => onOpenChange(false) : goBack}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {isFirstStep ? (
              t("cancel")
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" />
                {t("back")}
              </>
            )}
          </Button>

          <div className="flex items-center gap-3">
            {isLastStep && campaign && (
              confirmDelete ? (
                <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
                  <span className="text-red-300">{t("deletePrompt")}</span>
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
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("deleteCampaign")}
                </button>
              )
            )}

            {isLastStep ? (
              <Button
                onClick={handleSave}
                disabled={saving || !canSave}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving
                  ? campaign
                    ? t("saving")
                    : t("startingCampaign")
                  : campaign
                    ? t("saveChanges")
                    : t("createCampaign")}
              </Button>
            ) : (
              <Button
                onClick={goNext}
                disabled={!canAdvanceFromCurrentStep}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("next")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
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
