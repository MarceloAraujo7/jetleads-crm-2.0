'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Layers,
  Users,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Inbox,
} from 'lucide-react';

interface LeadBaseRow {
  id: string;
  name: string;
  client_name: string | null;
}

interface LeadBaseGalleryProps {
  accountId: string | null;
  /** id is a real lead_bases.id, or '__none__' for the unassigned pool. */
  onOpenBase: (id: string) => void;
  /** Same id shape as onOpenBase — jumps straight into the base with the
   *  import dialog already open. */
  onImportToBase: (id: string) => void;
  /** Bumped by the parent (e.g. after an import) to force a refresh. */
  refreshKey: number;
  /** Bypass the gallery and go straight to the flat, unfiltered table. */
  onViewAll: () => void;
}

export function LeadBaseGallery({
  accountId,
  onOpenBase,
  onImportToBase,
  refreshKey,
  onViewAll,
}: LeadBaseGalleryProps) {
  const t = useTranslations('Contacts.gallery');
  const supabase = createClient();

  const [bases, setBases] = useState<LeadBaseRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [noBaseCount, setNoBaseCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [dialogId, setDialogId] = useState<string | null>(null);
  const [dialogName, setDialogName] = useState('');
  const [dialogClient, setDialogClient] = useState('');
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<LeadBaseRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('lead_bases')
      .select('id, name, client_name')
      .order('name');
    const rows = (data ?? []) as LeadBaseRow[];
    setBases(rows);

    const [countResults, noneResult] = await Promise.all([
      Promise.all(
        rows.map((b) =>
          supabase
            .from('contacts')
            .select('id', { count: 'exact', head: true })
            .eq('lead_base_id', b.id),
        ),
      ),
      supabase.from('contacts').select('id', { count: 'exact', head: true }).is('lead_base_id', null),
    ]);
    const nextCounts: Record<string, number> = {};
    rows.forEach((b, i) => {
      nextCounts[b.id] = countResults[i].count ?? 0;
    });
    setCounts(nextCounts);
    setNoBaseCount(noneResult.count ?? 0);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  function openCreateDialog() {
    setDialogMode('create');
    setDialogId(null);
    setDialogName('');
    setDialogClient('');
    setDialogOpen(true);
  }

  function openEditDialog(base: LeadBaseRow) {
    setDialogMode('edit');
    setDialogId(base.id);
    setDialogName(base.name);
    setDialogClient(base.client_name ?? '');
    setDialogOpen(true);
  }

  async function handleSaveDialog() {
    if (!dialogName.trim() || saving) return;
    setSaving(true);
    try {
      if (dialogMode === 'create') {
        if (!accountId) return;
        const { error } = await supabase.from('lead_bases').insert({
          account_id: accountId,
          name: dialogName.trim(),
          client_name: dialogClient.trim() || null,
        });
        if (error) throw error;
        toast.success(t('toastCreated'));
      } else if (dialogId) {
        const { error } = await supabase
          .from('lead_bases')
          .update({ name: dialogName.trim(), client_name: dialogClient.trim() || null })
          .eq('id', dialogId);
        if (error) throw error;
        toast.success(t('toastUpdated'));
      }
      setDialogOpen(false);
      load();
    } catch {
      toast.error(t('toastFailedSave'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from('lead_bases').delete().eq('id', deleteTarget.id);
    if (error) {
      toast.error(t('toastFailedDelete'));
    } else {
      toast.success(t('toastDeleted'));
      load();
    }
    setDeleting(false);
    setDeleteTarget(null);
  }

  const totalLeads = Object.values(counts).reduce((a, b) => a + b, 0) + noBaseCount;

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-16">
        <Loader2 className="size-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">
            {bases.length > 0
              ? t('subtitle', { count: bases.length, total: totalLeads })
              : t('subtitleZero')}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onViewAll}
          className="text-muted-foreground hover:text-foreground"
        >
          {t('viewAllContacts')}
        </Button>
      </div>

      {bases.length === 0 && noBaseCount === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border py-16">
          <Layers className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t('emptyTitle')}</p>
          <p className="max-w-sm text-center text-xs text-muted-foreground">{t('emptyDesc')}</p>
          <Button size="sm" onClick={openCreateDialog} className="mt-1">
            <Plus className="size-3.5" />
            {t('createFirstBase')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bases.map((base) => (
            <Card
              key={base.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => onOpenBase(base.id)}
            >
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div className="min-w-0">
                  <CardTitle className="truncate">{base.name}</CardTitle>
                  <p className="truncate text-xs text-muted-foreground">
                    {base.client_name || t('noClient')}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-popover border-border">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditDialog(base);
                      }}
                      className="text-popover-foreground focus:bg-muted focus:text-foreground"
                    >
                      <Pencil className="size-4" />
                      {t('editAction')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget(base);
                      }}
                    >
                      <Trash2 className="size-4" />
                      {t('deleteAction')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                  <Users className="size-3.5 text-muted-foreground" />
                  {t('leadCount', { count: counts[base.id] ?? 0 })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onImportToBase(base.id);
                  }}
                  className="border-border text-muted-foreground hover:bg-muted"
                >
                  <Plus className="size-3.5" />
                  {t('addLeads')}
                </Button>
              </CardContent>
            </Card>
          ))}

          <Card
            className="cursor-pointer border-dashed transition-shadow hover:shadow-md"
            onClick={() => onOpenBase('__none__')}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Inbox className="size-4 text-muted-foreground" />
                {t('unassignedTitle')}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{t('unassignedDesc')}</p>
            </CardHeader>
            <CardContent>
              <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                <Users className="size-3.5 text-muted-foreground" />
                {t('leadCount', { count: noBaseCount })}
              </span>
            </CardContent>
          </Card>

          <Card
            className="flex cursor-pointer items-center justify-center border-dashed py-8 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            onClick={openCreateDialog}
          >
            <div className="flex flex-col items-center gap-2">
              <Plus className="size-6" />
              <span className="text-sm font-medium">{t('newBase')}</span>
            </div>
          </Card>
        </div>
      )}

      {/* Create/Edit base dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {dialogMode === 'create' ? t('dialogCreateTitle') : t('dialogEditTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('nameLabel')}</label>
              <Input
                value={dialogName}
                onChange={(e) => setDialogName(e.target.value)}
                placeholder={t('namePlaceholder')}
                className="border-border bg-muted text-foreground"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{t('clientLabel')}</label>
              <Input
                value={dialogClient}
                onChange={(e) => setDialogClient(e.target.value)}
                placeholder={t('clientPlaceholder')}
                className="border-border bg-muted text-foreground"
              />
            </div>
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button onClick={handleSaveDialog} disabled={saving || !dialogName.trim()}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete base confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteConfirmTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteConfirmDesc', { name: deleteTarget?.name ?? '' })}
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
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
