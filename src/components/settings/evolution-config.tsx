'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, MessageCircle, QrCode, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type Status = 'loading' | 'disconnected' | 'connecting' | 'connected';

/**
 * Settings card for the Evolution API channel (unofficial WhatsApp,
 * used for free-form inbox conversation alongside the official Meta
 * Cloud API channel above). Deliberately has no fields to fill in —
 * this is our own centrally-managed Evolution server, so "connect" is
 * just: create an instance, show a QR code, poll until paired.
 */
export function EvolutionConfig() {
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
      }
    } catch {
      setStatus('disconnected');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to connect');
        return;
      }
      setQrCode(data.qrCode ?? null);
      setStatus('connecting');
      // Poll every 3s until the phone finishes pairing.
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(fetchStatus, 3000);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/whatsapp/evolution/config', { method: 'DELETE' });
      if (!res.ok) {
        toast.error('Failed to disconnect');
        return;
      }
      setStatus('disconnected');
      setQrCode(null);
      toast.success('Evolution disconnected');
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="size-4 text-primary" />
            WhatsApp — Conversa (Evolution)
          </CardTitle>
          <CardDescription>
            Canal complementar para conversa livre no Inbox, sem limite de janela de 24h.
            Campanhas continuam sempre pela API Oficial acima.
          </CardDescription>
        </div>
        {status === 'connected' && (
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-600/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
            <CheckCircle2 className="size-3.5" />
            Conectado
          </span>
        )}
        {status === 'disconnected' && (
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
            <XCircle className="size-3.5" />
            Não conectado
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'loading' && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {status === 'connected' && (
          <Button variant="outline" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Desconectando…
              </>
            ) : (
              'Desconectar'
            )}
          </Button>
        )}

        {(status === 'disconnected' || status === 'connecting') && !qrCode && (
          <Button onClick={handleConnect} disabled={connecting}>
            {connecting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Gerando QR code…
              </>
            ) : (
              <>
                <QrCode className="mr-2 size-4" />
                Conectar WhatsApp
              </>
            )}
          </Button>
        )}

        {qrCode && status !== 'connected' && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-muted/30 p-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrCode}
              alt="QR code para conectar o WhatsApp"
              className="size-56 rounded-md bg-white p-2"
            />
            <p className="text-center text-sm text-muted-foreground">
              Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho, e
              escaneie o código.
            </p>
            <Button variant="ghost" size="sm" onClick={handleConnect} disabled={connecting}>
              Gerar novo QR code
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
