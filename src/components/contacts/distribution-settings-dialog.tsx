'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AccountMember } from '@/types';

interface DistributionSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 'manual' isn't a stored strategy value — it maps to
// lead_distribution_enabled=false. The other three map to
// enabled=true + accounts.lead_distribution_strategy.
type StrategyChoice = 'manual' | 'least_loaded' | 'round_robin' | 'equal';

const STRATEGY_CHOICES: StrategyChoice[] = ['manual', 'least_loaded', 'round_robin', 'equal'];

/**
 * Lead distribution settings — moved here from Team/Members (distribution
 * is about leads, not people). Two pieces:
 *   1. Strategy selector, backed by accounts.lead_distribution_enabled +
 *      .lead_distribution_strategy (src/lib/contacts/assign-lead.ts owns
 *      what each strategy actually does).
 *   2. Per-seller daily quota, via the same PATCH /api/account/members/[userId]
 *      endpoint the old Team-tab quota field used.
 */
export function DistributionSettingsDialog({ open, onOpenChange }: DistributionSettingsDialogProps) {
  const t = useTranslations('Contacts.distribution');
  const { accountId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [choice, setChoice] = useState<StrategyChoice>('manual');
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<AccountMember[]>([]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: account }, membersRes] = await Promise.all([
        supabase
          .from('accounts')
          .select('lead_distribution_enabled, lead_distribution_strategy')
          .eq('id', accountId)
          .single(),
        fetch('/api/account/members', { cache: 'no-store' }),
      ]);
      if (account) {
        setChoice(
          account.lead_distribution_enabled
            ? ((account.lead_distribution_strategy as StrategyChoice) || 'least_loaded')
            : 'manual',
        );
      }
      if (membersRes.ok) {
        const data = (await membersRes.json()) as { members: AccountMember[] };
        setAgents(data.members.filter((m) => m.role === 'agent'));
      }
    } catch (err) {
      console.error('[DistributionSettingsDialog] load error:', err);
      toast.error(t('toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function handleChoiceChange(next: StrategyChoice) {
    if (!accountId || next === choice) return;
    const previous = choice;
    setChoice(next);
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('accounts')
        .update(
          next === 'manual'
            ? { lead_distribution_enabled: false }
            : { lead_distribution_enabled: true, lead_distribution_strategy: next },
        )
        .eq('id', accountId);
      if (error) throw error;
      toast.success(t('toastSaved'));
    } catch (err) {
      console.error('[DistributionSettingsDialog] save error:', err);
      setChoice(previous);
      toast.error(t('toastSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleQuotaChange(agent: AccountMember, nextQuota: number | null) {
    if (agent.daily_lead_quota === nextQuota) return;
    const previous = agent.daily_lead_quota;
    setAgents((prev) =>
      prev.map((a) => (a.user_id === agent.user_id ? { ...a, daily_lead_quota: nextQuota } : a)),
    );
    try {
      const res = await fetch(`/api/account/members/${agent.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daily_lead_quota: nextQuota }),
      });
      if (!res.ok) {
        setAgents((prev) =>
          prev.map((a) => (a.user_id === agent.user_id ? { ...a, daily_lead_quota: previous } : a)),
        );
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || t('toastQuotaFailed'));
      }
    } catch (err) {
      setAgents((prev) =>
        prev.map((a) => (a.user_id === agent.user_id ? { ...a, daily_lead_quota: previous } : a)),
      );
      console.error('[DistributionSettingsDialog] quota error:', err);
      toast.error(t('toastQuotaFailed'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('title')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">{t('desc')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              {STRATEGY_CHOICES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleChoiceChange(s)}
                  disabled={saving}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors ${
                    choice === s
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <span className="text-sm font-medium text-foreground">{t(`strategy.${s}.label`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`strategy.${s}.desc`)}</span>
                </button>
              ))}
            </div>

            {choice !== 'manual' && (
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-sm font-medium text-foreground">{t('quotaTitle')}</p>
                <p className="text-xs text-muted-foreground">{t('quotaDesc')}</p>
                {agents.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">{t('noAgents')}</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {agents.map((agent) => (
                      <li key={agent.user_id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <span className="truncate text-sm text-foreground">
                          {agent.full_name || agent.email || agent.user_id}
                        </span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          placeholder={t('noLimit')}
                          defaultValue={agent.daily_lead_quota ?? ''}
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            handleQuotaChange(agent, raw === '' ? null : Math.max(0, Number(raw)));
                          }}
                          className="h-8 w-16 shrink-0 rounded-md border border-border bg-muted px-2 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
