'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Globe2, QrCode } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { WhatsAppChannelForm } from './whatsapp-channel-form';
import { EvolutionConnectPanel } from './evolution-connect-panel';
import type { ChannelListItem } from './whatsapp-channels-types';

type ConnectMode = 'official' | 'evolution';

interface ConnectNumberModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing Meta channel. */
  metaChannel?: ChannelListItem | null;
  /** True when opened to manage the caller's own Evolution connection. */
  editEvolution?: boolean;
  onSaved: () => void;
}

/**
 * Single entry point for connecting a number, mirroring the design
 * reference: pick a connection type up front (official Meta API vs.
 * Evolution/personal), then the matching form takes over below. When
 * editing an existing channel the type is already decided, so the
 * picker is skipped entirely.
 */
export function ConnectNumberModal({
  open,
  onOpenChange,
  metaChannel,
  editEvolution,
  onSaved,
}: ConnectNumberModalProps) {
  const t = useTranslations('Settings.whatsapp');
  const isEditing = Boolean(metaChannel) || Boolean(editEvolution);
  const [mode, setMode] = useState<ConnectMode>(editEvolution ? 'evolution' : 'official');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,860px)] w-full flex-col gap-0 overflow-hidden bg-popover p-0 text-popover-foreground sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-1.5 border-b border-border/50 p-6">
          <DialogTitle className="text-popover-foreground">{t('connectNumberTitle')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('connectNumberDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {!isEditing && (
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode('official')}
                  className={`flex flex-col gap-2 rounded-2xl border p-4 text-left transition-colors ${
                    mode === 'official'
                      ? 'border-primary bg-primary-soft'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <span
                    className={`flex size-9 items-center justify-center rounded-xl ${
                      mode === 'official' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Globe2 className="size-4" />
                  </span>
                  <span className="font-medium text-foreground">{t('officialApi')}</span>
                  <span className="text-xs text-muted-foreground">{t('officialApiDesc')}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMode('evolution')}
                  className={`flex flex-col gap-2 rounded-2xl border p-4 text-left transition-colors ${
                    mode === 'evolution'
                      ? 'border-primary bg-primary-soft'
                      : 'border-border bg-card hover:border-primary/40'
                  }`}
                >
                  <span
                    className={`flex size-9 items-center justify-center rounded-xl ${
                      mode === 'evolution' ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <QrCode className="size-4" />
                  </span>
                  <span className="font-medium text-foreground">{t('evolutionApi')}</span>
                  <span className="text-xs text-muted-foreground">{t('evolutionApiDesc')}</span>
                </button>
              </div>
            )}

            {mode === 'official' ? (
              <WhatsAppChannelForm
                channel={metaChannel ?? null}
                onSaved={() => {
                  onSaved();
                  onOpenChange(false);
                }}
                onCancel={() => onOpenChange(false)}
                onDeleted={() => {
                  onSaved();
                  onOpenChange(false);
                }}
              />
            ) : (
              <EvolutionConnectPanel onChanged={onSaved} />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
