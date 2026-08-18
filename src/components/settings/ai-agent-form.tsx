'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';
import type { AccountMember } from '@/types';
import { memberLabel } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

const MASKED_KEY = '••••••••••••••••';
const HANDOFF_QUEUE = '__queue__';
const NO_CLONE = '__none__';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
};
const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
};

type Purpose = 'qualifier' | 'scheduler' | 'support' | 'custom';
const PURPOSE_PRESET_PROMPT: Record<Exclude<Purpose, 'custom'>, string> = {
  qualifier:
    'Você é um assistente de qualificação de leads. Faça perguntas objetivas para entender o interesse do cliente (orçamento, prazo, necessidade) e identifique se ele é uma oportunidade real. Quando o lead demonstrar interesse genuíno ou pedir para falar com alguém, transfira a conversa para um atendente humano.',
  scheduler:
    'Você é um assistente de agendamento. Confirme o interesse do cliente e agende uma visita, ligação ou reunião, oferecendo horários disponíveis. Ao confirmar um agendamento, transfira a conversa para um atendente humano dar continuidade.',
  support:
    'Você é um assistente de atendimento ao cliente. Responda dúvidas comuns sobre produtos, prazos e políticas com um tom cordial e direto. Quando não souber responder ou o cliente insistir em falar com uma pessoa, transfira a conversa para um atendente humano.',
};

export interface AiAgentSummary {
  id: string;
  name: string;
}

interface AiAgentFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Absent/null = creating a new agent. */
  agentId?: string | null;
  /** Other agents on the account, for the "reuse an existing setup" picker (create mode only). */
  cloneCandidates: AiAgentSummary[];
  members: AccountMember[];
  onSaved: () => void;
}

interface AgentDetail {
  name: string;
  purpose: string | null;
  provider: AiProvider;
  model: string;
  system_prompt: string | null;
  is_active: boolean;
  auto_reply_enabled: boolean;
  auto_reply_max_per_conversation: number;
  handoff_agent_id: string | null;
  has_key: boolean;
}

export function AiAgentForm({
  open,
  onOpenChange,
  agentId,
  cloneCandidates,
  members,
  onSaved,
}: AiAgentFormProps) {
  const t = useTranslations('Settings.aiConfig');
  const isNew = !agentId;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('custom');
  const [cloneFromId, setCloneFromId] = useState('');
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [showKeyFields, setShowKeyFields] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  const [handoffAgentId, setHandoffAgentId] = useState('');

  useEffect(() => {
    if (!open) return;
    if (isNew) {
      setName('');
      setPurpose('custom');
      setCloneFromId('');
      setProvider('openai');
      setModel(AI_PROVIDER_DEFAULT_MODEL.openai);
      setApiKey('');
      setKeyEdited(false);
      setHasStoredKey(false);
      setShowKeyFields(true);
      setSystemPrompt('');
      setIsActive(false);
      setAutoReplyEnabled(false);
      setMaxPerConversation(3);
      setHandoffAgentId('');
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/ai/configs/${agentId}`);
        const data = (await res.json()) as AgentDetail & { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? t('loadFailed'));
          return;
        }
        setName(data.name);
        setPurpose((data.purpose as Purpose) || 'custom');
        setProvider(data.provider);
        setModel(data.model);
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHandoffAgentId(data.handoff_agent_id ?? '');
        setHasStoredKey(data.has_key);
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
        setShowKeyFields(false);
      } catch {
        toast.error(t('loadFailed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [open, isNew, agentId, t]);

  function applyPurposePreset(next: Purpose) {
    setPurpose(next);
    // Only pre-fill when the prompt is still empty — never clobber
    // something the user already wrote.
    if (next !== 'custom' && !systemPrompt.trim()) {
      setSystemPrompt(PURPOSE_PRESET_PROMPT[next]);
    }
  }

  function handleProviderChange(next: AiProvider) {
    setProvider(next);
    const isDefaultModel =
      model === AI_PROVIDER_DEFAULT_MODEL.openai ||
      model === AI_PROVIDER_DEFAULT_MODEL.anthropic ||
      model.trim() === '';
    if (isDefaultModel) setModel(AI_PROVIDER_DEFAULT_MODEL[next]);
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyEdited ? apiKey.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success(t('testSuccess'));
      else toast.error(data.error ?? t('testRejected'));
    } catch {
      toast.error(t('testNetworkError'));
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error(t('missingName'));
      return;
    }
    if (showKeyFields && !model.trim() && !cloneFromId) {
      toast.error(t('missingModel'));
      return;
    }
    if (isNew && !cloneFromId && !keyEdited) {
      toast.error(t('missingApiKey'));
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        purpose: purpose === 'custom' ? null : purpose,
        system_prompt: systemPrompt.trim() || null,
        is_active: isActive,
        auto_reply_enabled: autoReplyEnabled,
        auto_reply_max_per_conversation: maxPerConversation,
        handoff_agent_id: handoffAgentId || null,
      };
      if (isNew && cloneFromId) {
        body.clone_from_id = cloneFromId;
      } else {
        body.provider = provider;
        body.model = model.trim();
        if (keyEdited) body.api_key = apiKey.trim();
      }

      const res = await fetch(isNew ? '/api/ai/configs' : `/api/ai/configs/${agentId}`, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('saveFailed'));
        return;
      }
      toast.success(isNew ? t('agentCreated') : t('agentUpdated'));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-full max-w-lg overflow-y-auto bg-popover text-popover-foreground">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isNew ? t('newAgentTitle') : t('editAgentTitle')}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5 py-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="agent-name">{t('agentName')}</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('agentNamePlaceholder')}
                  className="border-border bg-muted text-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('purpose')}</Label>
                <Select value={purpose} onValueChange={(v) => applyPurposePreset(v as Purpose)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="qualifier">{t('purposeQualifier')}</SelectItem>
                    <SelectItem value="scheduler">{t('purposeScheduler')}</SelectItem>
                    <SelectItem value="support">{t('purposeSupport')}</SelectItem>
                    <SelectItem value="custom">{t('purposeCustom')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isNew && cloneCandidates.length > 0 && (
              <div className="space-y-2">
                <Label>{t('cloneFrom')}</Label>
                <Select
                  value={cloneFromId || NO_CLONE}
                  onValueChange={(v) => {
                    const next = v && v !== NO_CLONE ? v : '';
                    setCloneFromId(next);
                    setShowKeyFields(!next);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CLONE}>{t('cloneFromNone')}</SelectItem>
                    {cloneCandidates.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('cloneFromHint')}</p>
              </div>
            )}

            {showKeyFields && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t('provider')}</Label>
                    <Select value={provider} onValueChange={(v) => handleProviderChange(v as AiProvider)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                        <SelectItem value="anthropic">{PROVIDER_LABEL.anthropic}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="agent-model">{t('model')}</Label>
                    <Input
                      id="agent-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="agent-key">{t('apiKey')}</Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        id="agent-key"
                        type={showKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setKeyEdited(true);
                        }}
                        onFocus={() => {
                          if (!keyEdited && hasStoredKey) {
                            setApiKey('');
                            setKeyEdited(true);
                          }
                        }}
                        placeholder={KEY_PLACEHOLDER[provider]}
                        autoComplete="off"
                        className="border-border bg-muted pr-10 text-foreground"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((s) => !s)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        tabIndex={-1}
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
                      {testing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      {t('testKey')}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('encryptionNotice')}</p>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="agent-prompt">{t('businessContext')}</Label>
              <Textarea
                id="agent-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t('promptPlaceholder')}
                rows={5}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('enableAssistant')}</p>
                <p className="text-xs text-muted-foreground">{t('enableAssistantDesc')}</p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">{t('autoReply')}</p>
                <p className="text-xs text-muted-foreground">{t('autoReplyDesc')}</p>
              </div>
              <Switch checked={autoReplyEnabled} onCheckedChange={setAutoReplyEnabled} disabled={!isActive} />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="agent-max">{t('maxAutoReplies')}</Label>
                <p className="text-xs text-muted-foreground">{t('maxAutoRepliesDesc')}</p>
              </div>
              <Input
                id="agent-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(Math.min(20, Math.max(1, Number(e.target.value) || 1)))
                }
                disabled={!autoReplyEnabled}
                className="w-20 border-border bg-muted text-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="agent-handoff">{t('handoffTo')}</Label>
              <p className="text-xs text-muted-foreground">{t('handoffToDesc')}</p>
              <Select
                value={handoffAgentId || HANDOFF_QUEUE}
                onValueChange={(v) => setHandoffAgentId(!v || v === HANDOFF_QUEUE ? '' : v)}
                disabled={!autoReplyEnabled}
              >
                <SelectTrigger id="agent-handoff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_QUEUE}>{t('handoffQueue')}</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="bg-popover border-border">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
