'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PlugZap, MessageSquareText, Zap } from 'lucide-react';
import { NumbersPanel } from './numbers-panel';
import { TemplateListPanel } from '@/components/whatsapp/template-list-panel';
import { QuickRepliesManager } from './quick-replies-manager';

type SectionKey = 'numbers' | 'templates' | 'quickReplies';

/**
 * WhatsApp module — number connections, message templates, and quick
 * replies, navigated from a left rail (icon + name + description per
 * item) instead of top tabs, so each destination reads as its own
 * page rather than a segment of one screen.
 */
export function WhatsAppModule() {
  const t = useTranslations('Settings.whatsappModule');
  const [section, setSection] = useState<SectionKey>('numbers');

  const items: { key: SectionKey; icon: typeof PlugZap; label: string; desc: string }[] = [
    { key: 'numbers', icon: PlugZap, label: t('numbersNav'), desc: t('numbersNavDesc') },
    { key: 'templates', icon: MessageSquareText, label: t('templates'), desc: t('templatesNavDesc') },
    { key: 'quickReplies', icon: Zap, label: t('quickReplies'), desc: t('quickRepliesNavDesc') },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
      <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {items.map(({ key, icon: Icon, label, desc }) => {
          const active = section === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              className={`flex shrink-0 items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors lg:shrink ${
                active
                  ? 'border-primary bg-primary-soft'
                  : 'border-border bg-card hover:border-primary/40'
              }`}
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                  active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                }`}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm font-medium ${
                    active ? 'text-primary' : 'text-foreground'
                  }`}
                >
                  {label}
                </span>
                <span className="hidden text-xs text-muted-foreground lg:line-clamp-2">{desc}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="min-w-0">
        {section === 'numbers' && <NumbersPanel />}
        {section === 'templates' && <TemplateListPanel />}
        {section === 'quickReplies' && <QuickRepliesManager />}
      </div>
    </div>
  );
}
