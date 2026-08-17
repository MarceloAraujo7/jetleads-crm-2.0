"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CampaignWizard } from "@/components/campaigns/campaign-wizard";
import type { Campaign, CampaignAction } from "@/types";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

export default function EditCampaignPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations("Campaigns.form");
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [actions, setActions] = useState<CampaignAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const [{ data: campaignRow, error: campaignError }, { data: actionRows, error: actionsError }] =
          await Promise.all([
            supabase.from("campaigns").select("*").eq("id", campaignId).single(),
            supabase
              .from("campaign_actions")
              .select("*")
              .eq("campaign_id", campaignId)
              .order("position", { ascending: true }),
          ]);
        if (campaignError) throw campaignError;
        if (actionsError) throw actionsError;
        setCampaign(campaignRow);
        setActions(actionRows ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("toastFailed"));
      } finally {
        setLoading(false);
      }
    })();
  }, [campaignId, t]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? t("toastFailed")}</p>
        <Button variant="outline" onClick={() => router.push("/campaigns")}>
          {t("cancel")}
        </Button>
      </div>
    );
  }

  return <CampaignWizard campaign={campaign} initialActions={actions} />;
}
