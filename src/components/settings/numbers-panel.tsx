'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/hooks/use-auth';
import { hasMinRole } from '@/lib/auth/roles';
import {
  CheckCircle2,
  Globe2,
  Loader2,
  Plus,
  QrCode,
  Settings2,
  Star,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';
import { ConnectNumberModal } from './connect-number-modal';
import type { ChannelListItem } from './whatsapp-channels-types';

type EvolutionStatus = 'loading' | 'connected' | 'disconnected';

export function NumbersPanel() {
  const t = useTranslations('Settings.whatsapp');
  const { user, accountId, accountRole, loading: authLoading, profileLoading } = useAuth();
  const isAdmin = hasMinRole(accountRole ?? 'viewer', 'admin');

  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [evolutionStatus, setEvolutionStatus] = useState<EvolutionStatus>('loading');
  const loadedAccountIdRef = useRef<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ChannelListItem | null>(null);
  const [editingEvolution, setEditingEvolution] = useState(false);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/channels', { method: 'GET' });
      const data = await res.json();
      setChannels(Array.isArray(data.channels) ? data.channels : []);
    } catch (err) {
      console.error('fetchChannels error:', err);
      toast.error('Failed to load WhatsApp channels');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchEvolutionStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { cache: 'no-store' });
      const data = await res.json();
      setEvolutionStatus(data.connected ? 'connected' : 'disconnected');
    } catch {
      setEvolutionStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchChannels();
    fetchEvolutionStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profileLoading, user?.id, accountId, fetchChannels, fetchEvolutionStatus]);

  async function handleSetDefault(channelId: string) {
    try {
      setSettingDefaultId(channelId);
      const res = await fetch(`/api/whatsapp/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ set_default: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to set default number');
        return;
      }
      toast.success(t('setAsDefaultSuccess'));
      await fetchChannels();
    } catch (err) {
      console.error('set default error:', err);
      toast.error('Failed to set default number');
    } finally {
      setSettingDefaultId(null);
    }
  }

  function openNewMeta() {
    setEditingChannel(null);
    setEditingEvolution(false);
    setModalOpen(true);
  }

  function openEditMeta(channel: ChannelListItem) {
    setEditingChannel(channel);
    setEditingEvolution(false);
    setModalOpen(true);
  }

  function openEvolution() {
    setEditingChannel(null);
    setEditingEvolution(true);
    setModalOpen(true);
  }

  function handleModalSaved() {
    fetchChannels();
    fetchEvolutionStatus();
  }

  if (loading || evolutionStatus === 'loading') {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('numbersPanelTitle')} description={t('numbersPanelDesc')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('numbersPanelTitle')} description={t('numbersPanelDesc')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {channels.map((c) => {
          const isRegistered = Boolean(c.registered_at);
          return (
            <Card key={c.id}>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Globe2 className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-heading text-base font-medium text-foreground">
                      {c.label || c.phone_number_id || t('unnamedChannel')}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{t('officialApi')}</p>
                  </div>
                </div>
                {isAdmin && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('configureNumber')}
                    onClick={() => openEditMeta(c)}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <Settings2 className="size-4" />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {c.is_default && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                      <Star className="size-3" />
                      {t('defaultBadge')}
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className={
                      isRegistered
                        ? 'gap-1 border-emerald-600/30 bg-emerald-500/10 text-emerald-400'
                        : 'gap-1 border-amber-600/30 bg-amber-500/10 text-amber-400'
                    }
                  >
                    {isRegistered ? (
                      <CheckCircle2 className="size-3" />
                    ) : (
                      <XCircle className="size-3" />
                    )}
                    {isRegistered ? t('registeredShort') : t('notRegisteredShort')}
                  </Badge>
                  {c.ddd && (
                    <Badge variant="outline" className="border-border text-muted-foreground">
                      DDD {c.ddd}
                    </Badge>
                  )}
                </div>
                {!c.is_default && isAdmin && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetDefault(c.id)}
                    disabled={settingDefaultId === c.id}
                    className="w-full border-border text-muted-foreground hover:bg-muted"
                  >
                    {settingDefaultId === c.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Star className="size-3.5" />
                    )}
                    {t('setAsDefault')}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Caller's own Evolution (personal) connection */}
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <QrCode className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-heading text-base font-medium text-foreground">
                  {t('personalNumberTitle')}
                </p>
                <p className="truncate text-xs text-muted-foreground">{t('evolutionApi')}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              title={evolutionStatus === 'connected' ? t('configureNumber') : t('viewQrCode')}
              onClick={openEvolution}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Settings2 className="size-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge
              variant="outline"
              className={
                evolutionStatus === 'connected'
                  ? 'gap-1 border-emerald-600/30 bg-emerald-500/10 text-emerald-400'
                  : 'gap-1 border-border bg-muted text-muted-foreground'
              }
            >
              {evolutionStatus === 'connected' ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <XCircle className="size-3" />
              )}
              {evolutionStatus === 'connected' ? t('connectedBadge') : t('notConnectedBadge')}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={openEvolution}
              className="w-full border-border text-muted-foreground hover:bg-muted"
            >
              {evolutionStatus === 'connected' ? (
                <Settings2 className="size-3.5" />
              ) : (
                <QrCode className="size-3.5" />
              )}
              {evolutionStatus === 'connected' ? t('configureNumber') : t('viewQrCode')}
            </Button>
          </CardContent>
        </Card>

        {isAdmin && (
          <Card
            className="flex cursor-pointer items-center justify-center border-dashed py-8 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            onClick={openNewMeta}
          >
            <div className="flex flex-col items-center gap-2">
              <Plus className="size-6" />
              <span className="text-sm font-medium">{t('connectNumber')}</span>
            </div>
          </Card>
        )}
      </div>

      <ConnectNumberModal
        key={`${editingChannel?.id ?? 'new'}-${editingEvolution}`}
        open={modalOpen}
        onOpenChange={setModalOpen}
        metaChannel={editingChannel}
        editEvolution={editingEvolution}
        onSaved={handleModalSaved}
      />
    </section>
  );
}
