'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { WhatsAppChannelForm } from './whatsapp-channel-form';
import type { ChannelListItem } from './whatsapp-channels-types';

/**
 * "Vendedor conecta o próprio WhatsApp" — moved here from the shared
 * WhatsApp module (that module is admin-only now; a seller manages
 * just their own number, from their own Profile). Reuses
 * WhatsAppChannelForm as-is (same register/verify-with-Meta flow the
 * admin module uses) — only new code here is finding "my channel" in
 * the list GET /api/whatsapp/channels already returns.
 *
 * Only rendered for `agent` role — admins manage numbers via the
 * WhatsApp module, and the channel-creation route forces
 * assigned_agent_id=undefined for admin callers anyway (see
 * /api/whatsapp/channels POST), so showing this to an admin would be
 * misleading (their save wouldn't create a personal number).
 */
export function ProfileWhatsAppSection() {
  const t = useTranslations('Settings.profile');
  const { user, accountRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<ChannelListItem | null>(null);

  const loadMyChannel = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/channels', { method: 'GET' });
      const data = await res.json();
      const channels: ChannelListItem[] = Array.isArray(data.channels) ? data.channels : [];
      setChannel(channels.find((c) => c.assigned_agent_id === user.id) ?? null);
    } catch (err) {
      console.error('[ProfileWhatsAppSection] load error:', err);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (accountRole !== 'agent') {
      setLoading(false);
      return;
    }
    void loadMyChannel();
  }, [accountRole, loadMyChannel]);

  if (accountRole !== 'agent') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground">{t('whatsappTitle')}</CardTitle>
        <CardDescription className="text-muted-foreground">{t('whatsappDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <WhatsAppChannelForm
            key={channel?.id ?? 'new'}
            channel={channel}
            onSaved={loadMyChannel}
            onCancel={() => {}}
            onDeleted={loadMyChannel}
          />
        )}
      </CardContent>
    </Card>
  );
}
