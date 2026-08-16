'use client';

import { useTranslations } from 'next-intl';
import { PlugZap, MessageSquareText, Zap } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { WhatsAppConfig } from './whatsapp-config';
import { EvolutionConfig } from './evolution-config';
import { TemplateListPanel } from '@/components/whatsapp/template-list-panel';
import { QuickRepliesManager } from './quick-replies-manager';

/**
 * WhatsApp module — everything about talking to Meta lives here now:
 * number connection, message templates, and quick replies. Underline
 * ("line") tabs instead of the segmented-pill default — this is a
 * page-level section switch, not a toggle, so the lighter style reads
 * more like page navigation and less like a settings control.
 */
export function WhatsAppModule() {
  const t = useTranslations('Settings.whatsappModule');

  return (
    <Tabs defaultValue="connection">
      <TabsList variant="line" className="mb-6 w-full justify-start gap-1 border-b border-border/60 pb-0">
        <TabsTrigger value="connection" className="gap-1.5">
          <PlugZap className="size-4" />
          {t('connection')}
        </TabsTrigger>
        <TabsTrigger value="templates" className="gap-1.5">
          <MessageSquareText className="size-4" />
          {t('templates')}
        </TabsTrigger>
        <TabsTrigger value="quickReplies" className="gap-1.5">
          <Zap className="size-4" />
          {t('quickReplies')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="connection">
        <div className="space-y-6">
          <WhatsAppConfig />
          <EvolutionConfig />
        </div>
      </TabsContent>

      <TabsContent value="templates">
        <TemplateListPanel />
      </TabsContent>

      <TabsContent value="quickReplies">
        <QuickRepliesManager />
      </TabsContent>
    </Tabs>
  );
}
