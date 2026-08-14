import type { CampaignActionStatusKey, CampaignStatus } from "@/types";

export interface StatusDisplay {
  classes: string;
  pulse?: boolean;
}

export const actionStatusConfig: Record<CampaignActionStatusKey, StatusDisplay> = {
  broadcastDraft: { classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20" },
  broadcastScheduled: { classes: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  broadcastSending: { classes: "bg-blue-500/10 text-blue-400 border-blue-500/20", pulse: true },
  broadcastSent: { classes: "bg-primary/10 text-primary border-primary/20" },
  broadcastFailed: { classes: "bg-red-500/10 text-red-400 border-red-500/20" },
  automationActive: { classes: "bg-primary/10 text-primary border-primary/20" },
  automationPaused: { classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20" },
  flowPublished: { classes: "bg-primary/10 text-primary border-primary/20" },
  flowDraft: { classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20" },
  flowArchived: { classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20" },
  agentActive: { classes: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  agentInactive: { classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20" },
  linkRemoved: { classes: "bg-red-500/10 text-red-400 border-red-500/20" },
};

export const campaignStatusConfig: Record<CampaignStatus, StatusDisplay> = {
  running: { classes: "bg-primary/10 text-primary border-primary/20", pulse: true },
  scheduled: { classes: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  completed: { classes: "bg-slate-500/10 text-muted-foreground border-slate-500/20" },
};
