'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Loader2, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Status = 'loading' | 'disconnected' | 'connecting' | 'connected';

interface EvolutionConnectPanelProps {
  /** Called whenever connect/disconnect changes the underlying state,
   *  so the parent (numbers panel) can refresh its own list. */
  onChanged?: () => void;
}

/**
 * QR-first Evolution connect flow — the reference design leads with a
 * large, prominent QR panel rather than a plain "Connect" button, so
 * pairing reads as the primary action, not a hidden step behind a click.
 */
export function EvolutionConnectPanel({ onChanged }: EvolutionConnectPanelProps) {
  const t = useTranslations('Settings.whatsapp');
  const [status, setStatus] = useState<Status>('loading');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { cache: 'no-store' });
      const data = await res.json();
      setStatus(data.connected ? 'connected' : 'disconnected');
      if (data.connected) {
        setQrCode(null);
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        onChanged?.();
      }
    } catch {
      setStatus('disconnected');
    }
  }, [onChanged]);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('connectFailed'));
        return;
      }
      setQrCode(data.qrCode ?? null);
      setStatus('connecting');
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchStatus, 3000);
    } catch {
      toast.error(t('serverUnreachable'));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { method: 'DELETE' });
      if (!res.ok) {
        toast.error(t('disconnectFailed'));
        return;
      }
      setStatus('disconnected');
      setQrCode(null);
      toast.success(t('disconnectSuccess'));
      onChanged?.();
    } catch {
      toast.error(t('serverUnreachable'));
    } finally {
      setDisconnecting(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === 'connected') {
    return (
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-emerald-600/30 bg-emerald-500/5 px-6 py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
          <CheckCircle2 className="size-6" />
        </span>
        <div>
          <p className="font-medium text-foreground">{t('connectedBadge')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('personalNumberDesc')}</p>
        </div>
        <Button
          variant="outline"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="border-border text-muted-foreground hover:bg-muted"
        >
          {disconnecting && <Loader2 className="size-4 animate-spin" />}
          {disconnecting ? t('disconnecting') : t('disconnect')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('personalNumberDesc')}</p>

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-muted/30 px-6 py-8">
        {qrCode ? (
          <>
            <p className="text-sm font-medium text-foreground">{t('scanQrTitle')}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrCode}
              alt={t('scanQrTitle')}
              className="size-[220px] rounded-lg bg-white p-2 shadow-[var(--shadow)]"
            />
            <p className="max-w-xs text-center text-xs text-muted-foreground">{t('scanQrDesc')}</p>
            <Button variant="ghost" size="sm" onClick={handleConnect} disabled={connecting}>
              {connecting && <Loader2 className="size-3.5 animate-spin" />}
              {t('generateNewQr')}
            </Button>
          </>
        ) : (
          <>
            <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <QrCode className="size-7" />
            </span>
            <Button onClick={handleConnect} disabled={connecting} className="min-w-[220px]">
              {connecting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('generatingQr')}
                </>
              ) : (
                <>
                  <QrCode className="size-4" />
                  {t('connectWhatsapp')}
                </>
              )}
            </Button>
          </>
        )}
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-600/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-500">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>{t('unofficialWarning')}</span>
      </div>
    </div>
  );
}
