'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, Star, Pencil, Trash2, Plus, Bot } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { SettingsPanelHead } from './settings-panel-head';
import { AiKnowledgeCard } from './ai-knowledge';
import { AiAgentForm, type AiAgentSummary } from './ai-agent-form';
import type { AccountMember } from '@/types';
import { fetchAccountMembers } from '@/lib/account/members';
import { useTranslations } from 'next-intl';

interface AgentListItem {
  id: string;
  name: string;
  purpose: string | null;
  provider: string;
  model: string;
  is_active: boolean;
  is_default: boolean;
  auto_reply_enabled: boolean;
  has_embeddings_key: boolean;
}

const PURPOSE_LABEL_KEY: Record<string, string> = {
  qualifier: 'purposeQualifier',
  scheduler: 'purposeScheduler',
  support: 'purposeSupport',
};

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.aiConfig');

  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AgentListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/configs');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('loadFailedAgents'));
        return;
      }
      setAgents(data.configs ?? []);
    } catch {
      toast.error(t('loadFailedAgents'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchAgents();
    void fetchAccountMembers().then(setMembers);
  }, [accountId, fetchAgents]);

  function openCreate() {
    setEditingId(null);
    setFormOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setFormOpen(true);
  }

  async function handleSetDefault(id: string) {
    setSettingDefaultId(id);
    try {
      const res = await fetch(`/api/ai/configs/${id}/set-default`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('setDefaultFailed'));
        return;
      }
      toast.success(t('setDefaultSuccess'));
      await fetchAgents();
    } catch {
      toast.error(t('setDefaultFailed'));
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai/configs/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t('deleteAgentFailed'));
        return;
      }
      toast.success(t('deleteAgentSuccess'));
      setDeleteTarget(null);
      await fetchAgents();
    } catch {
      toast.error(t('deleteAgentFailed'));
    } finally {
      setDeleting(false);
    }
  }

  const cloneCandidates: AiAgentSummary[] = agents.map((a) => ({ id: a.id, name: a.name }));
  const defaultAgent = agents.find((a) => a.is_default);

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('loadFailedAgents')}
      </div>
    );
  }

  return (
    <div>
      <SettingsPanelHead title={t('title')} description={t('description')} />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t('adminOnlyConfig')}
        </p>
      )}

      <div className="space-y-6">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16">
            <Sparkles className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('noAgentsYet')}</p>
            {canEdit && (
              <Button size="sm" onClick={openCreate} className="mt-1">
                <Plus className="size-3.5" />
                {t('createFirstAgent')}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <Card key={agent.id}>
                <CardHeader className="flex-row items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Bot className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-heading text-base font-medium text-foreground">
                        {agent.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {agent.purpose && PURPOSE_LABEL_KEY[agent.purpose]
                          ? t(PURPOSE_LABEL_KEY[agent.purpose])
                          : t('purposeCustom')}
                      </p>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('editAgentTitle')}
                        onClick={() => openEdit(agent.id)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('deleteAgent')}
                        onClick={() => setDeleteTarget(agent)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {agent.is_default && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                        <Star className="size-3" />
                        {t('defaultBadge')}
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        agent.is_active
                          ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-400'
                          : 'border-border bg-muted text-muted-foreground'
                      }`}
                    >
                      {agent.is_active ? t('activeBadge') : t('inactiveBadge')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {agent.provider === 'openai' ? 'OpenAI' : 'Anthropic'} · {agent.model}
                  </p>
                  {canEdit && !agent.is_default && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSetDefault(agent.id)}
                      disabled={settingDefaultId === agent.id}
                      className="w-full border-border text-muted-foreground hover:bg-muted"
                    >
                      {settingDefaultId === agent.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Star className="size-3.5" />
                      )}
                      {t('setAsDefault')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}

            {canEdit && (
              <Card
                className="flex cursor-pointer items-center justify-center border-dashed py-8 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                onClick={openCreate}
              >
                <div className="flex flex-col items-center gap-2">
                  <Plus className="size-6" />
                  <span className="text-sm font-medium">{t('newAgent')}</span>
                </div>
              </Card>
            )}
          </div>
        )}

        <AiKnowledgeCard
          accountId={accountId}
          canEdit={canEdit}
          hasEmbeddingsKey={defaultAgent?.has_embeddings_key ?? false}
        />
      </div>

      {canEdit && (
        <AiAgentForm
          open={formOpen}
          onOpenChange={setFormOpen}
          agentId={editingId}
          cloneCandidates={cloneCandidates}
          members={members}
          onSaved={fetchAgents}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteAgent')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteAgentConfirm', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('deleteAgent')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
