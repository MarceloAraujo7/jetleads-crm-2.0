'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  AlertTriangle,
  RotateCcw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ChannelListItem } from './whatsapp-channels-types';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

interface RegistrationProbe {
  live: boolean;
  checks: Record<string, boolean | null>;
  errors?: string[];
}

interface WhatsAppChannelFormProps {
  /** null = creating a new channel. Otherwise the row being edited. */
  channel: ChannelListItem | null;
  onSaved: () => void;
  onCancel: () => void;
  onDeleted?: () => void;
}

export function WhatsAppChannelForm({ channel, onSaved, onCancel, onDeleted }: WhatsAppChannelFormProps) {
  const t = useTranslations('Settings.whatsapp');
  const isNew = !channel;

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [statusMessage, setStatusMessage] = useState('');

  const [label, setLabel] = useState(channel?.label ?? '');
  const [ddd, setDdd] = useState(channel?.ddd ?? '');
  const [phoneNumberId, setPhoneNumberId] = useState(channel?.phone_number_id ?? '');
  const [wabaId, setWabaId] = useState(channel?.waba_id ?? '');
  const [accessToken, setAccessToken] = useState(channel ? MASKED_TOKEN : '');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  const isRegistered = Boolean(channel?.registered_at);
  const lastRegistrationError = channel?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  const [registrationProbe, setRegistrationProbe] = useState<RegistrationProbe | null>(null);

  const webhookUrl =
    typeof window !== 'undefined' ? `${window.location.origin}/api/whatsapp/webhook` : '';

  // Auto health-check existing channels on open, mirroring the old
  // single-form behaviour so the status banner isn't stuck on
  // "unknown" until the user clicks a button.
  useEffect(() => {
    if (!channel) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/whatsapp/channels/${channel.id}/test`, { method: 'GET' });
        const payload = await res.json();
        if (cancelled) return;
        if (payload.connected) {
          setConnectionStatus('connected');
          setStatusMessage('');
        } else {
          setConnectionStatus('disconnected');
          setStatusMessage(payload.message || '');
        }
      } catch {
        if (!cancelled) setConnectionStatus('disconnected');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id]);

  async function handleTestConnection() {
    if (!channel) return;
    try {
      setTesting(true);
      const res = await fetch(`/api/whatsapp/channels/${channel.id}/test`, { method: 'GET' });
      const payload = await res.json();
      if (payload.connected) {
        setConnectionStatus('connected');
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Connected to ${payload.phone_info.verified_name}`
            : 'API connection successful',
        );
      } else {
        setConnectionStatus('disconnected');
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'API connection failed');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('Connection test failed. Check network and try again.');
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    if (!channel) return;
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch(`/api/whatsapp/channels/${channel.id}/verify-registration`, {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success('Number is fully wired — Meta is delivering events.');
      } else {
        toast.error('Number is not fully registered. See the checks below for which step failed.', {
          duration: 8000,
        });
      }
      onSaved();
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error('Could not reach the verification endpoint.');
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast.error('Phone Number ID is required');
      return;
    }
    if (isNew && (!accessToken.trim() || !tokenEdited)) {
      toast.error('Access Token is required for initial setup');
      return;
    }
    if (!isNew && !tokenEdited) {
      toast.error('Please re-enter the Access Token to save changes');
      return;
    }

    try {
      setSaving(true);
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        pin: pin.trim() || null,
        label: label.trim() || null,
        ddd: ddd.trim() || null,
        access_token: accessToken.trim(),
      };

      const res = await fetch(isNew ? '/api/whatsapp/channels' : `/api/whatsapp/channels/${channel!.id}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to save configuration');
        setSaving(false);
        return;
      }

      if (data.registered === false && data.registration_error) {
        toast.error(`Saved, but Meta couldn't register the number: ${data.registration_error}`, {
          duration: 12000,
        });
      } else if (data.registration_skipped) {
        toast.success(
          'Credentials saved and verified. Inbound registration was skipped (no PIN) — see Registration status below.',
          { duration: 10000 },
        );
        setPin('');
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `Live — ${data.phone_info.verified_name} can now receive events.`
            : 'WhatsApp connected. Events will start flowing within a minute.',
        );
        setPin('');
      }

      onSaved();
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!channel) return;
    if (!confirm(t('deleteChannelConfirm'))) return;
    try {
      setDeleting(true);
      const res = await fetch(`/api/whatsapp/channels/${channel.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to delete channel');
        return;
      }
      toast.success(t('deleteChannelSuccess'));
      onDeleted?.();
    } catch (err) {
      console.error('Delete channel error:', err);
      toast.error('Failed to delete channel');
    } finally {
      setDeleting(false);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied to clipboard');
  }

  return (
    <div className="space-y-6">
      {/* Label / DDD */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground text-base">{t('channelDetailsTitle')}</CardTitle>
          <CardDescription className="text-muted-foreground">{t('channelDetailsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('channelLabel')}</Label>
              <Input
                placeholder={t('channelLabelPlaceholder')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t('channelDdd')}</Label>
              <Input
                placeholder={t('channelDddPlaceholder')}
                value={ddd}
                maxLength={2}
                onChange={(e) => setDdd(e.target.value.replace(/\D/g, '').slice(0, 2))}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">{t('channelDddHint')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Connection Status */}
      {channel && (
        <Alert className="bg-card border-border">
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-foreground mb-0">
              {connectionStatus === 'connected' ? t('credentialsValid') : t('notConnected')}
            </AlertTitle>
          </div>
          <AlertDescription className="text-muted-foreground">
            {connectionStatus === 'connected' ? t('connectedDesc') : statusMessage || t('notConnectedDesc')}
          </AlertDescription>
        </Alert>
      )}

      {/* Registration Status */}
      {channel && (
        <Alert
          className={
            isRegistered ? 'bg-emerald-950/30 border-emerald-700/50' : 'bg-amber-950/30 border-amber-700/50'
          }
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              {isRegistered ? (
                <CheckCircle2 className="size-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="size-4 text-amber-400" />
              )}
              <AlertTitle className={'mb-0 ' + (isRegistered ? 'text-emerald-200' : 'text-amber-200')}>
                {isRegistered ? t('registered') : t('notRegistered')}
              </AlertTitle>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleVerifyRegistration}
              disabled={verifyingRegistration}
              className="border-border bg-transparent text-foreground hover:bg-muted h-7"
            >
              {verifyingRegistration ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Zap className="size-3.5" />
              )}
              {t('verifyWithMeta')}
            </Button>
          </div>
          <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed">
            {isRegistered ? (
              <span
                dangerouslySetInnerHTML={{
                  __html: t('subscribedSince', {
                    date: channel.registered_at ? new Date(channel.registered_at).toLocaleString() : t('unknownDate'),
                  }),
                }}
              />
            ) : lastRegistrationError ? (
              <>
                {t('lastAttemptFailed')}
                <span className="text-red-300">&quot;{lastRegistrationError}&quot;</span>. {t('retryHint')}
              </>
            ) : (
              <>{t('noRegistrationHint')}</>
            )}
          </AlertDescription>

          {registrationProbe && (
            <div className="mt-3 rounded border border-border bg-card/60 px-3 py-2 space-y-1.5 text-[11px]">
              <p className="font-medium text-foreground">
                {t('diagnosticLastRun')}
                <span className={registrationProbe.live ? 'text-emerald-400' : 'text-amber-400'}>
                  {registrationProbe.live ? t('live') : t('notLive')}
                </span>
              </p>
              <ul className="space-y-0.5 text-muted-foreground">
                {Object.entries(registrationProbe.checks).map(([k, v]) => (
                  <li key={k} className="flex items-center gap-1.5">
                    {v === true ? (
                      <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                    ) : v === false ? (
                      <XCircle className="size-3 text-red-400 shrink-0" />
                    ) : (
                      <span className="size-3 rounded-full border border-border shrink-0" />
                    )}
                    <code className="text-muted-foreground">{k}</code>
                  </li>
                ))}
              </ul>
              {(registrationProbe.errors ?? []).length > 0 && (
                <ul className="pt-1 space-y-0.5 text-red-300">
                  {registrationProbe.errors?.map((e, i) => (
                    <li key={i}>• {e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Alert>
      )}

      {/* API Credentials */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('apiCredentialsTitle')}</CardTitle>
          <CardDescription className="text-muted-foreground">{t('apiCredentialsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('phoneNumberId')}</Label>
            <Input
              placeholder="e.g. 100234567890123"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('wabaId')}</Label>
            <Input
              placeholder="e.g. 100234567890456"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('accessToken')}</Label>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                placeholder={t('accessTokenPlaceholder')}
                value={accessToken}
                onChange={(e) => {
                  setAccessToken(e.target.value);
                  setTokenEdited(true);
                }}
                onFocus={() => {
                  if (accessToken === MASKED_TOKEN) {
                    setAccessToken('');
                    setTokenEdited(true);
                  }
                }}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
              />
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            {channel && !tokenEdited && <p className="text-xs text-muted-foreground">{t('tokenHidden')}</p>}
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('webhookVerifyToken')}</Label>
            <Input
              placeholder={t('webhookVerifyTokenPlaceholder')}
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">{t('webhookVerifyTokenHint')}</p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              {t('twoStepPin')}
              <span className="ml-1 text-muted-foreground">{t('optional')}</span>
            </Label>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder={t('pinPlaceholder')}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground tracking-widest"
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              <span dangerouslySetInnerHTML={{ __html: t('pinHint') }} />
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Webhook URL */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('webhookTitle')}</CardTitle>
          <CardDescription className="text-muted-foreground">{t('webhookDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label className="text-muted-foreground">{t('webhookUrl')}</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                className="bg-muted border-border text-muted-foreground font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopyWebhookUrl}
                className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSave} disabled={saving} className="bg-primary hover:bg-primary/90 text-primary-foreground">
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {t('saving')}
            </>
          ) : (
            t('saveConfig')
          )}
        </Button>
        {channel && (
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing}
            className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {testing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('testing')}
              </>
            ) : (
              <>
                <Zap className="size-4" />
                {t('testConnection')}
              </>
            )}
          </Button>
        )}
        <Button
          variant="outline"
          onClick={onCancel}
          className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        >
          {t('cancel')}
        </Button>
        {channel && (
          <Button
            variant="outline"
            onClick={handleDelete}
            disabled={deleting}
            className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40 ml-auto"
          >
            {deleting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('resetting')}
              </>
            ) : (
              <>
                <RotateCcw className="size-4" />
                {t('deleteChannel')}
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
