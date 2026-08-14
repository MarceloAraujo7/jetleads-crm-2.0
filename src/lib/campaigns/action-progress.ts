import { createClient } from "@/lib/supabase/client";
import { triggerMeta } from "@/lib/automations/trigger-meta";
import type {
  CampaignAction,
  CampaignActionStatusKey,
  CampaignActionWithProgress,
} from "@/types";

const WINDOW_DAYS = 30;

function windowCutoffIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - WINDOW_DAYS);
  return d.toISOString();
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((numerator / denominator) * 100)));
}

/** Formats a subtitle from a translation function passed in by the
 *  caller — this module has no React context of its own, so it can't
 *  call `useTranslations` directly. */
type Translate = (key: string, values?: Record<string, string | number>) => string;

type SupabaseClient = ReturnType<typeof createClient>;

type ProgressResult = Pick<
  CampaignActionWithProgress,
  "statusKey" | "progressPercent" | "subtitle"
>;

async function progressForBroadcast(
  supabase: SupabaseClient,
  broadcastId: string,
  t: Translate,
): Promise<ProgressResult> {
  const { data } = await supabase
    .from("broadcasts")
    .select("status, sent_count, total_recipients")
    .eq("id", broadcastId)
    .maybeSingle();

  if (!data) return { statusKey: "linkRemoved", progressPercent: null };

  const statusKey = (
    { draft: "broadcastDraft", scheduled: "broadcastScheduled", sending: "broadcastSending", sent: "broadcastSent", failed: "broadcastFailed" } as const
  )[data.status as string] ?? "broadcastDraft";

  return {
    statusKey,
    progressPercent: percent(data.sent_count ?? 0, data.total_recipients ?? 0),
    subtitle: t("actionSubtitle.broadcast", {
      sent: data.sent_count ?? 0,
      total: data.total_recipients ?? 0,
    }),
  };
}

async function progressForAutomation(
  supabase: SupabaseClient,
  automationId: string,
): Promise<ProgressResult> {
  const { data: automation } = await supabase
    .from("automations")
    .select("is_active, trigger_type")
    .eq("id", automationId)
    .maybeSingle();

  if (!automation) return { statusKey: "linkRemoved", progressPercent: null };

  const { data: logs } = await supabase
    .from("automation_logs")
    .select("status")
    .eq("automation_id", automationId)
    .gte("created_at", windowCutoffIso());

  const total = logs?.length ?? 0;
  const successful = logs?.filter((l) => l.status === "success").length ?? 0;

  return {
    statusKey: automation.is_active ? "automationActive" : "automationPaused",
    progressPercent: total > 0 ? percent(successful, total) : null,
    subtitle: triggerMeta(automation.trigger_type).label,
  };
}

async function progressForFlow(
  supabase: SupabaseClient,
  flowId: string,
  t: Translate,
): Promise<ProgressResult> {
  const { data: flow } = await supabase
    .from("flows")
    .select("status, execution_count")
    .eq("id", flowId)
    .maybeSingle();

  if (!flow) return { statusKey: "linkRemoved", progressPercent: null };

  const { data: runs } = await supabase
    .from("flow_runs")
    .select("status")
    .eq("flow_id", flowId)
    .gte("started_at", windowCutoffIso());

  const total = runs?.length ?? 0;
  const successful =
    runs?.filter((r) => r.status === "completed" || r.status === "handed_off").length ?? 0;

  const statusKey = (
    { draft: "flowDraft", active: "flowPublished", archived: "flowArchived" } as const
  )[flow.status as string] ?? "flowDraft";

  return {
    statusKey,
    progressPercent: total > 0 ? percent(successful, total) : null,
    subtitle: t("actionSubtitle.flow", { count: flow.execution_count ?? 0 }),
  };
}

async function progressForAgent(
  supabase: SupabaseClient,
  aiConfigId: string,
  t: Translate,
): Promise<ProgressResult> {
  const { data: config } = await supabase
    .from("ai_configs")
    .select("is_active, account_id")
    .eq("id", aiConfigId)
    .maybeSingle();

  if (!config) return { statusKey: "linkRemoved", progressPercent: null };

  const { data: rows } = await supabase
    .from("messages")
    .select("conversation_id, conversations!inner(ai_handoff_summary, account_id)")
    .eq("ai_generated", true)
    .eq("conversations.account_id", config.account_id)
    .gte("created_at", windowCutoffIso());

  const byConversation = new Map<string, boolean>();
  for (const row of rows ?? []) {
    const conv = row.conversations as unknown as { ai_handoff_summary: string | null } | null;
    byConversation.set(row.conversation_id, conv?.ai_handoff_summary == null);
  }
  const total = byConversation.size;
  const resolved = Array.from(byConversation.values()).filter(Boolean).length;

  return {
    statusKey: config.is_active ? "agentActive" : "agentInactive",
    progressPercent: total > 0 ? percent(resolved, total) : null,
    subtitle: t("actionSubtitle.agent"),
  };
}

export async function loadCampaignActionsWithProgress(
  actions: CampaignAction[],
  t: Translate,
): Promise<CampaignActionWithProgress[]> {
  const supabase = createClient();

  return Promise.all(
    actions.map(async (action) => {
      let result: ProgressResult;
      switch (action.action_type) {
        case "broadcast":
          result = action.broadcast_id
            ? await progressForBroadcast(supabase, action.broadcast_id, t)
            : { statusKey: "linkRemoved", progressPercent: null };
          break;
        case "automation":
          result = action.automation_id
            ? await progressForAutomation(supabase, action.automation_id)
            : { statusKey: "linkRemoved", progressPercent: null };
          break;
        case "flow":
          result = action.flow_id
            ? await progressForFlow(supabase, action.flow_id, t)
            : { statusKey: "linkRemoved", progressPercent: null };
          break;
        case "agent":
          result = action.ai_config_id
            ? await progressForAgent(supabase, action.ai_config_id, t)
            : { statusKey: "linkRemoved", progressPercent: null };
          break;
      }
      return { ...action, ...result };
    }),
  );
}

export type { CampaignActionStatusKey };
