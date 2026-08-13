'use client';

import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from './whatsapp-config';
import { EvolutionConfig } from './evolution-config';
import { TemplateManager } from './template-manager';
import { QuickRepliesManager } from './quick-replies-manager';

/**
 * WhatsApp module — everything about talking to Meta lives here now:
 * number connection, message templates, and quick replies. Used to be
 * three separate settings sections (whatsapp / templates /
 * quick-replies) that looked like near-identical "list with an inner
 * sidebar" screens; this just adds a tab strip above the three
 * existing components, unmodified — each still owns its own header,
 * data-fetching, and dialogs.
 */
export function WhatsAppModule() {
  const t = useTranslations('Settings.whatsappModule');

  return (
    <Tabs defaultValue="connection">
      <TabsList className="mb-5">
        <TabsTrigger value="connection">{t('connection')}</TabsTrigger>
        <TabsTrigger value="templates">{t('templates')}</TabsTrigger>
        <TabsTrigger value="quickReplies">{t('quickReplies')}</TabsTrigger>
      </TabsList>

      <TabsContent value="connection">
        <div className="space-y-6">
          <WhatsAppConfig />
          <EvolutionConfig />
        </div>
      </TabsContent>

      <TabsContent value="templates">
        <TemplateManager />
      </TabsContent>

      <TabsContent value="quickReplies">
        <QuickRepliesManager />
      </TabsContent>
    </Tabs>
  );
}
