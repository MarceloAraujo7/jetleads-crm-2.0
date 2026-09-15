'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, Send, Loader2, Users, Save, DollarSign, CheckCircle2, AlertTriangle, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import { estimateBroadcastCost } from '@/lib/whatsapp/meta-pricing';

interface AudienceConfig {
  type: string;
  tagIds?: string[];
  csvContacts?: { phone: string; name?: string }[];
  leadBaseId?: string;
}

interface ChannelOption {
  id: string;
  label: string | null;
  phone_number_id: string | null;
  is_default: boolean;
}

interface Step4Props {
  name: string;
  onNameChange: (name: string) => void;
  template: MessageTemplate;
  audience: AudienceConfig;
  channelId: string | null;
  onChannelIdChange: (channelId: string | null) => void;
  onSend: () => void;
  onSaveDraft?: () => void;
  onBack: () => void;
  isProcessing: boolean;
  progress: number;
}

export function Step4ScheduleSend({
  name,
  onNameChange,
  template,
  audience,
  channelId,
  onChannelIdChange,
  onSend,
  onSaveDraft,
  onBack,
  isProcessing,
  progress,
}: Step4Props) {
  const t = useTranslations('Broadcasts.wizard');
  const { account, accountRole, refreshProfile } = useAuth();
  const canEditRate = hasMinRole(accountRole ?? 'viewer', 'admin');
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number>(0);
  const [loadingReach, setLoadingReach] = useState(true);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [savingRate, setSavingRate] = useState(false);

  const usdToBrlRate = account?.whatsapp_usd_brl_rate ?? 5.3;
  const costEstimate = estimateBroadcastCost(estimatedReach, template.category, usdToBrlRate);

  async function handleSaveRate() {
    const parsed = Number(rateInput.replace(',', '.'));
    if (!account || !Number.isFinite(parsed) || parsed <= 0) return;
    setSavingRate(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('accounts')
        .update({ whatsapp_usd_brl_rate: parsed })
        .eq('id', account.id);
      if (error) {
        toast.error(t('scheduleSend.costExchangeSaveFailed'));
        return;
      }
      toast.success(t('scheduleSend.costExchangeSaved'));
      await refreshProfile();
      setEditingRate(false);
    } catch {
      toast.error(t('scheduleSend.costExchangeSaveFailed'));
    } finally {
      setSavingRate(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/channels', { method: 'GET' });
        const data = await res.json();
        if (!cancelled && Array.isArray(data.channels)) {
          setChannels(data.channels);
        }
      } catch {
        // Silently keep the default-only send path — the channel
        // picker just won't render if this fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    async function calculateReach() {
      setLoadingReach(true);
      try {
        const supabase = createClient();

        if (audience.type === 'all') {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true });
          setEstimatedReach(count ?? 0);
        } else if (audience.type === 'tags' && audience.tagIds && audience.tagIds.length > 0) {
          const { data: contactTags } = await supabase
            .from('contact_tags')
            .select('contact_id')
            .in('tag_id', audience.tagIds);

          const uniqueIds = new Set((contactTags ?? []).map((ct) => ct.contact_id));
          setEstimatedReach(uniqueIds.size);
        } else if (audience.type === 'csv' && audience.csvContacts) {
          setEstimatedReach(audience.csvContacts.length);
        } else if (audience.type === 'lead_base' && audience.leadBaseId) {
          const { count } = await supabase
            .from('contacts')
            .select('*', { count: 'exact', head: true })
            .eq('lead_base_id', audience.leadBaseId);
          setEstimatedReach(count ?? 0);
        } else {
          setEstimatedReach(0);
        }
      } finally {
        setLoadingReach(false);
      }
    }

    calculateReach();
  }, [audience]);

  const audienceLabel =
    audience.type === 'all'
      ? t('scheduleSend.audienceAll')
      : audience.type === 'tags'
        ? t('scheduleSend.audienceTags')
        : audience.type === 'csv'
          ? t('scheduleSend.audienceCsv')
          : audience.type === 'lead_base'
            ? t('scheduleSend.audienceLeadBase')
            : t('scheduleSend.audienceField');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('scheduleSend.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('scheduleSend.subtitle')}
        </p>
      </div>

      {/* Broadcast Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">{t('scheduleSend.broadcastName')}</label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('scheduleSend.broadcastNamePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      {/* Number picker — only worth showing once there's more than one
          connected number; a single-channel account always just uses
          the account default. */}
      {channels.length > 1 && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            {t('scheduleSend.sendFromNumber')}
          </label>
          <Select
            value={channelId ?? '__default__'}
            onValueChange={(v) => onChannelIdChange(v === '__default__' ? null : v)}
          >
            <SelectTrigger className="w-full bg-muted border-border text-foreground">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">{t('scheduleSend.sendFromDefault')}</SelectItem>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.label || c.phone_number_id || c.id}
                  {c.is_default ? ` (${t('scheduleSend.sendFromDefaultTag')})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Summary Card */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <p className="text-sm font-medium text-foreground">{t('scheduleSend.summary')}</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.template')}</p>
            <p className="text-foreground">{template.name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.audience')}</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.estimatedReach')}</p>
            <div className="flex items-center gap-1.5">
              {loadingReach ? (
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
              ) : (
                <>
                  <Users className="h-3.5 w-3.5 text-primary" />
                  <p className="font-medium text-foreground">{estimatedReach.toLocaleString()}</p>
                </>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('scheduleSend.language')}</p>
            <p className="text-foreground">{template.language ?? 'en_US'}</p>
          </div>
        </div>
      </div>

      {/* Cost estimate — Meta's official per-message pricing by
          template category, ceiling estimate (see meta-pricing.ts). */}
      <div className="rounded-2xl border-2 border-primary/40 bg-primary-soft p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="inline-flex items-center rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
              {t('scheduleSend.costCardBadge')}
            </span>
            <h3 className="mt-2 text-lg font-bold text-foreground">{t('scheduleSend.costCardTitle')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('scheduleSend.costCardSubtitle', { count: estimatedReach.toLocaleString() })}
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-extrabold text-primary">US$ {costEstimate.costUsd.toFixed(2)}</div>
            <div className="text-base font-semibold text-emerald-500">≈ R$ {costEstimate.costBrl.toFixed(2)}</div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 border-t border-primary/20 pt-4 text-sm sm:grid-cols-3">
          <div>
            <span className="text-xs text-muted-foreground">{t('scheduleSend.template')}</span>
            <p className="font-medium text-foreground">{template.name}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">{t('scheduleSend.costRateLabel')}</span>
            <p className="font-medium text-foreground">US$ {costEstimate.ratePerMessageUsd.toFixed(4)}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">{t('scheduleSend.costExchangeLabel')}</span>
            {editingRate ? (
              <div className="mt-1 flex items-center gap-1.5">
                <Input
                  value={rateInput}
                  onChange={(e) => setRateInput(e.target.value)}
                  className="h-7 w-20 border-border bg-muted px-2 text-xs text-foreground"
                  autoFocus
                />
                <Button size="sm" className="h-7 px-2 text-xs" disabled={savingRate} onClick={handleSaveRate}>
                  {savingRate ? <Loader2 className="h-3 w-3 animate-spin" /> : t('scheduleSend.costExchangeSave')}
                </Button>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 font-medium text-foreground">
                US$ 1,00 = R$ {usdToBrlRate.toFixed(2)}
                {canEditRate && (
                  <button
                    type="button"
                    onClick={() => {
                      setRateInput(String(usdToBrlRate));
                      setEditingRate(true);
                    }}
                    title={t('scheduleSend.costExchangeEdit')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Meta billing rules */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <h4 className="mb-3 text-sm font-semibold text-foreground">{t('scheduleSend.costRulesTitle')}</h4>
        <div className="space-y-2.5">
          <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>{t('scheduleSend.costRuleDedup')}</span>
          </div>
          <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <DollarSign className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{t('scheduleSend.costRuleBilling')}</span>
          </div>
          <div className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>{t('scheduleSend.costRuleCeiling')}</span>
          </div>
        </div>
      </div>

      {/* Mandatory cost-consent checkbox — gates the send action below. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-dashed border-border p-4 select-none">
        <input
          type="checkbox"
          checked={consentAccepted}
          onChange={(e) => setConsentAccepted(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primary"
        />
        <span className="text-sm font-medium text-foreground">
          {t('scheduleSend.consentLabel', {
            usd: costEstimate.costUsd.toFixed(2),
            brl: costEstimate.costBrl.toFixed(2),
          })}
        </span>
      </label>

      {/* Processing overlay */}
      {isProcessing && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium text-foreground">{t('scheduleSend.sending')}</p>
            </div>
            <span className="text-xs font-medium text-primary">{progress}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={isProcessing}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          {onSaveDraft && (
            <Button
              variant="outline"
              onClick={onSaveDraft}
              disabled={!name.trim() || isProcessing}
              className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {t('scheduleSend.saveDraft')}
            </Button>
          )}

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogTrigger
            render={
              <Button
                disabled={!name.trim() || !consentAccepted || isProcessing}
                title={!consentAccepted ? t('scheduleSend.consentRequiredHint') : undefined}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              />
            }
          >
            <Send className="h-4 w-4" />
            {t('scheduleSend.sendNow')}
          </DialogTrigger>
          <DialogContent className="border-border bg-popover sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">{t('scheduleSend.confirmTitle')}</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {t('scheduleSend.confirmDescBefore')}{' '}
                <span className="font-medium text-popover-foreground">{estimatedReach.toLocaleString()}</span>{' '}
                {t('scheduleSend.confirmDescContacts')} {t('scheduleSend.confirmDescUsing')}{' '}
                <span className="font-medium text-popover-foreground">{template.name}</span>. {t('scheduleSend.confirmDescAfter')}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConfirm(false)}
                className="border-border text-muted-foreground"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={() => {
                  setShowConfirm(false);
                  onSend();
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
                {t('scheduleSend.sendNow')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>
    </div>
  );
}
