'use client';

import { PlugZap } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { RequireRole } from '@/components/auth/require-role';
import { WhatsAppModule } from '@/components/settings/whatsapp-module';

export default function WhatsAppPage() {
  const t = useTranslations('Settings.whatsappModule');

  return (
    <RequireRole
      min="admin"
      fallback={
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card py-16 text-center">
          <PlugZap className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('adminOnly')}</p>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('pageTitle')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('pageDesc')}</p>
        </div>
        <WhatsAppModule />
      </div>
    </RequireRole>
  );
}
