'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Plus,
  Star,
  Settings2,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { WhatsAppChannelForm } from './whatsapp-channel-form';
import type { ChannelListItem } from './whatsapp-channels-types';

export function WhatsAppConfig() {
  const t = useTranslations('Settings.whatsapp');
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<ChannelListItem[]>([]);
  // null = list view. 'new' = add-number form. A channel id = edit that row.
  const [selected, setSelected] = useState<string | 'new' | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const loadedAccountIdRef = useRef<string | null>(null);

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
  }, [authLoading, profileLoading, user?.id, accountId, fetchChannels]);

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

  const selectedChannel =
    selected && selected !== 'new' ? channels.find((c) => c.id === selected) ?? null : null;

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title={t('title')} description={t('description')} />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {selected !== null ? (
            <>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="size-3.5" />
                {t('backToList')}
              </button>
              <h3 className="text-base font-medium text-foreground">
                {selected === 'new' ? t('newChannelTitle') : t('editChannelTitle')}
              </h3>
              <WhatsAppChannelForm
                key={selected}
                channel={selectedChannel}
                onSaved={() => {
                  fetchChannels();
                  setSelected(null);
                }}
                onCancel={() => setSelected(null)}
                onDeleted={() => {
                  fetchChannels();
                  setSelected(null);
                }}
              />
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-medium text-foreground">{t('channelsListTitle')}</h3>
                <Button
                  onClick={() => setSelected('new')}
                  size="sm"
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Plus className="size-4" />
                  {t('addNumber')}
                </Button>
              </div>

              {channels.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center space-y-3">
                    <p className="text-muted-foreground text-sm">{t('noChannelsYet')}</p>
                    <Button
                      onClick={() => setSelected('new')}
                      size="sm"
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    >
                      <Plus className="size-4" />
                      {t('addNumber')}
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {channels.map((c) => {
                    const isRegistered = Boolean(c.registered_at);
                    return (
                      <Card key={c.id}>
                        <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-foreground truncate">
                                {c.label || c.phone_number_id || t('unnamedChannel')}
                              </span>
                              {c.is_default && (
                                <Badge className="bg-primary/15 text-primary border-primary/30 gap-1">
                                  <Star className="size-3" />
                                  {t('defaultBadge')}
                                </Badge>
                              )}
                              {c.ddd && (
                                <Badge variant="outline" className="border-border text-muted-foreground">
                                  DDD {c.ddd}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              {isRegistered ? (
                                <CheckCircle2 className="size-3.5 text-emerald-400" />
                              ) : (
                                <XCircle className="size-3.5 text-amber-400" />
                              )}
                              {isRegistered ? t('registeredShort') : t('notRegisteredShort')}
                              {c.phone_number_id && (
                                <span className="font-mono truncate">— {c.phone_number_id}</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {!c.is_default && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleSetDefault(c.id)}
                                disabled={settingDefaultId === c.id}
                                className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                              >
                                {settingDefaultId === c.id ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Star className="size-3.5" />
                                )}
                                {t('setAsDefault')}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setSelected(c.id)}
                              className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                            >
                              <Settings2 className="size-3.5" />
                              {t('manage')}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Setup Instructions Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">{t('setupInstructions')}</CardTitle>
              <CardDescription className="text-muted-foreground">{t('setupInstructionsDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                      {t('step1')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li dangerouslySetInnerHTML={{ __html: t('step1_1') }} />
                      <li>{t('step1_2')}</li>
                      <li>{t('step1_3')}</li>
                      <li>{t('step1_4')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      {t('step2')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step2_1')}</li>
                      <li>{t('step2_2')}</li>
                      <li>{t('step2_3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      {t('step3')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step3_1')}</li>
                      <li dangerouslySetInnerHTML={{ __html: t('step3_2') }} />
                      <li dangerouslySetInnerHTML={{ __html: t('step3_3') }} />
                      <li dangerouslySetInnerHTML={{ __html: t('step3_4') }} />
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                      {t('step4')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('step4_1')}</li>
                      <li>{t('step4_2')}</li>
                      <li dangerouslySetInnerHTML={{ __html: t('step4_3') }} />
                      <li dangerouslySetInnerHTML={{ __html: t('step4_4') }} />
                      <li>{t('step4_5')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 pt-4 border-t border-border">
                <a
                  href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  {t('metaDocs')}
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
