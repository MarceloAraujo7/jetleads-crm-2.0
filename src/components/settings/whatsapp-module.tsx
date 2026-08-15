'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MessageSquareText } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { WhatsAppConfig } from './whatsapp-config';
import { EvolutionConfig } from './evolution-config';
import { TemplateListDialog } from '@/components/whatsapp/template-list-dialog';
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
  const tTemplates = useTranslations('Settings.templates');
  const [templatesOpen, setTemplatesOpen] = useState(false);

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
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-card p-10 text-center shadow-[var(--shadow)]">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <MessageSquareText className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{tTemplates('title')}</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">{tTemplates('description')}</p>
          </div>
          <Button onClick={() => setTemplatesOpen(true)} className="mt-1">
            {tTemplates('list.open')}
          </Button>
        </div>
        <TemplateListDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
      </TabsContent>

      <TabsContent value="quickReplies">
        <QuickRepliesManager />
      </TabsContent>
    </Tabs>
  );
}
