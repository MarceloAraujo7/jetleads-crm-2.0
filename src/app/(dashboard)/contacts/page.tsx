'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Search,
  Plus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  SlidersHorizontal,
  Filter,
  X,
  Send,
  Shuffle,
  Layers,
  FolderInput,
  ListChecks,
  ArrowLeft,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';
import { LeadBaseGallery } from '@/components/contacts/lead-base-gallery';
import { DistributionSettingsDialog } from '@/components/contacts/distribution-settings-dialog';
import { CustomFieldsManager } from '@/components/contacts/custom-fields-manager';
import { useCan } from '@/hooks/use-can';
import { useAuth } from '@/hooks/use-auth';
import { GatedButton } from '@/components/ui/gated-button';
import { useTranslations } from 'next-intl';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

// `useSearchParams` opts this page out of static prerendering unless it
// sits under a Suspense boundary — required for the "Ver lead" deep
// link from the Inbox contact sidebar (?contact=<id>).
export default function ContactsPage() {
  return (
    <Suspense fallback={null}>
      <ContactsPageInner />
    </Suspense>
  );
}

function ContactsPageInner() {
  const t = useTranslations('Contacts.page');
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('send-messages');
  const canEditSettings = useCan('edit-settings');

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  // Tag filter — contacts shown must have ANY of these tags (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  // Lead base filter — '' = every base (default, still shown grouped
  // via the table's own "Base" column), '__none__' = only contacts
  // with no base assigned, otherwise a real lead_bases.id.
  const [leadBases, setLeadBases] = useState<{ id: string; name: string }[]>([]);
  const [selectedBaseId, setSelectedBaseId] = useState<string>('');

  // Landing view: a card gallery of lead bases (default) vs. the flat
  // contacts table for a chosen base/"__none__"/all. `galleryRefreshKey`
  // is bumped after actions taken while inside a base (import, bulk
  // delete/move) so the gallery's counts are fresh when the user goes
  // back, without keeping a live subscription open.
  const [galleryView, setGalleryView] = useState(true);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [customFieldsOpen, setCustomFieldsOpen] = useState(false);
  const [distributionOpen, setDistributionOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection (page-scoped — only the loaded rows are selectable —
  // unless the user expands to every row matching the current filters
  // via `selectAllMatching`, e.g. "select this whole lead base").
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [selectingAllMatching, setSelectingAllMatching] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [moveBaseOpen, setMoveBaseOpen] = useState(false);
  const [moveTargetBaseId, setMoveTargetBaseId] = useState<string>('');
  const [newBaseNameForMove, setNewBaseNameForMove] = useState('');
  const [creatingBaseForMove, setCreatingBaseForMove] = useState(false);
  const [moving, setMoving] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  // Guards against out-of-order fetch responses: each fetchContacts run
  // claims a sequence number and only the latest is allowed to commit its
  // results. Without this, rapidly toggling tag filters could let a slower
  // earlier request resolve last and render stale rows.
  const fetchSeq = useRef(0);

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
      // Drop any filter selections whose tag no longer exists (e.g. a tag
      // deleted elsewhere) so it can't linger invisibly in the query.
      setSelectedTagIds((prev) => {
        const pruned = prev.filter((id) => map[id]);
        return pruned.length === prev.length ? prev : pruned;
      });
    }
  }, [supabase]);

  const fetchLeadBases = useCallback(async () => {
    const { data } = await supabase.from('lead_bases').select('id, name').order('name');
    setLeadBases(data ?? []);
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    const seq = ++fetchSeq.current;
    setLoading(true);
    // The visible rows are about to change — drop any selection that
    // referred to the old page/search results so the bulk bar can't
    // act on rows the user can no longer see.
    setSelected(new Set());
    setSelectAllMatching(false);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const term = search.trim();

    let contactRows: Contact[];
    let count: number;

    if (selectedTagIds.length > 0) {
      // Tag filter active — resolve it server-side (join + distinct +
      // windowed total count + pagination) so a tag covering many
      // contacts can't silently truncate the result or overflow an IN
      // clause. See migration 025_filter_contacts_by_tags.
      const { data, error } = await supabase.rpc('filter_contacts_by_tags', {
        p_tag_ids: selectedTagIds,
        p_search: term || null,
        p_limit: PAGE_SIZE,
        p_offset: from,
      });
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as { contact: Contact; total_count: number }[];
      contactRows = rows.map((r) => r.contact);
      count = rows.length > 0 ? Number(rows[0].total_count) : 0;
    } else {
      let query = supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (term) {
        const like = `%${term}%`;
        query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
      }
      if (selectedBaseId === '__none__') {
        query = query.is('lead_base_id', null);
      } else if (selectedBaseId) {
        query = query.eq('lead_base_id', selectedBaseId);
      }

      const { data, count: exactCount, error } = await query;
      if (seq !== fetchSeq.current) return; // superseded by a newer fetch
      if (error) {
        toast.error(t('toastFailedLoad'));
        setLoading(false);
        return;
      }
      contactRows = data ?? [];
      count = exactCount ?? 0;
    }

    setTotalCount(count);

    if (contactRows.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = contactRows.map((c) => c.id);
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);
    if (seq !== fetchSeq.current) return; // superseded by a newer fetch

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = contactRows.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [supabase, page, search, selectedTagIds, selectedBaseId, tagsMap, t]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    fetchLeadBases();
  }, [fetchLeadBases]);

  useEffect(() => {
    // Skip the (paginated) contacts fetch while the gallery is showing —
    // nothing on screen needs it, and it'd just be wasted requests every
    // time a filter/page state changes in the background.
    if (galleryView) return;
    fetchContacts();
  }, [galleryView, fetchContacts]);

  function openBase(id: string) {
    setSelectedBaseId(id === '__none__' ? '__none__' : id);
    setPage(0);
    setGalleryView(false);
  }

  function openBaseAndImport(id: string) {
    openBase(id);
    setImportOpen(true);
  }

  function backToGallery() {
    setGalleryView(true);
    setGalleryRefreshKey((k) => k + 1);
  }

  function viewAllContacts() {
    setSelectedBaseId('');
    setPage(0);
    setGalleryView(false);
  }

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  // Deep link from the Inbox contact sidebar's "Ver lead" button
  // (?contact=<id>) — ContactDetailView fetches by id on its own, so
  // this doesn't need the contact to already be in the loaded/paged
  // list. Strips the param after opening so a refresh doesn't reopen it.
  useEffect(() => {
    const contactId = searchParams.get('contact');
    if (!contactId) return;
    openDetail(contactId);
    const params = new URLSearchParams(searchParams.toString());
    params.delete('contact');
    const query = params.toString();
    router.replace(query ? `/contacts?${query}` : '/contacts');
  }, [searchParams, router]);

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error(t('toastFailedDelete'));
    } else {
      toast.success(t('toastDeleted'));
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  const allOnPageSelected =
    contacts.length > 0 && contacts.every((c) => selected.has(c.id));
  const someOnPageSelected = contacts.some((c) => selected.has(c.id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        contacts.forEach((c) => next.delete(c.id));
      } else {
        contacts.forEach((c) => next.add(c.id));
      }
      return next;
    });
    setSelectAllMatching(false);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectAllMatching(false);
  }

  // "Select all N leads matching the current filters" — not just the
  // loaded page. Fetches every matching id (paginated internally so a
  // huge base doesn't blow a single request) rather than relying on
  // whatever happens to be loaded, so bulk delete/move can act on an
  // entire lead base regardless of how many pages it spans.
  async function selectAllMatchingFilters() {
    setSelectingAllMatching(true);
    try {
      const term = search.trim();
      let ids: string[] = [];

      if (selectedTagIds.length > 0) {
        // Tag filter is resolved via the RPC (see fetchContacts) — ask
        // for every row in one shot now that we know the true count.
        const { data, error } = await supabase.rpc('filter_contacts_by_tags', {
          p_tag_ids: selectedTagIds,
          p_search: term || null,
          p_limit: totalCount,
          p_offset: 0,
        });
        if (error) throw error;
        ids = ((data ?? []) as { contact: Contact }[]).map((r) => r.contact.id);
      } else {
        const PAGE = 1000;
        for (let from = 0; from < totalCount; from += PAGE) {
          let query = supabase
            .from('contacts')
            .select('id')
            .range(from, from + PAGE - 1);
          if (term) {
            const like = `%${term}%`;
            query = query.or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`);
          }
          if (selectedBaseId === '__none__') {
            query = query.is('lead_base_id', null);
          } else if (selectedBaseId) {
            query = query.eq('lead_base_id', selectedBaseId);
          }
          const { data, error } = await query;
          if (error) throw error;
          ids.push(...(data ?? []).map((r) => r.id as string));
        }
      }

      setSelected(new Set(ids));
      setSelectAllMatching(true);
    } catch {
      toast.error(t('toastFailedLoad'));
    } finally {
      setSelectingAllMatching(false);
    }
  }

  async function handleBulkDelete() {
    const ids = [...selected];
    if (ids.length === 0) return;
    setDeleting(true);

    // Chunked — a "select all matching" delete on a large base could
    // otherwise push .in(...) past practical request-size limits.
    const CHUNK = 200;
    let failed = false;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .in('id', ids.slice(i, i + CHUNK));
      if (error) {
        failed = true;
        break;
      }
    }

    if (failed) {
      toast.error(t('toastBulkFailedDelete'));
    } else {
      toast.success(t('toastBulkDeleted', { count: ids.length }));
      setSelected(new Set());
      fetchContacts();
      setGalleryRefreshKey((k) => k + 1);
    }

    setDeleting(false);
    setBulkDeleteOpen(false);
  }

  // "Enviar convite" — hands the current selection to the broadcast
  // wizard pre-loaded as a CSV-shaped audience (the wizard already
  // supports `audience.type === 'csv'` end-to-end; we're just another
  // producer of that shape). sessionStorage survives the navigation to
  // /broadcasts/new without the size limits a query string would hit
  // for a large selection. Selection is page-scoped (see the comment
  // above `selected`), so every selected id is guaranteed to already
  // be in the loaded `contacts` array — no extra fetch needed.
  function handleSendInvite() {
    const chosen = contacts.filter((c) => selected.has(c.id));
    const csvContacts = chosen
      .filter((c): c is ContactWithTags & { phone: string } => Boolean(c.phone))
      .map((c) => ({ phone: c.phone, name: c.name || undefined }));
    if (csvContacts.length === 0) {
      toast.error(t('toastNoPhoneForInvite'));
      return;
    }
    sessionStorage.setItem(
      'broadcast-invite-prefill',
      JSON.stringify({ campaignKind: 'event_invite', csvContacts }),
    );
    router.push('/broadcasts/new');
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  // Tag filter helpers. Every change resets to page 0 — the result set
  // shrinks/grows so page N may no longer be valid (mirrors the search box).
  const allTags = Object.values(tagsMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const hasActiveFilters = search.trim().length > 0 || selectedTagIds.length > 0;

  function toggleTagFilter(tagId: string) {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
    setPage(0);
  }

  function clearTagFilters() {
    setSelectedTagIds([]);
    setPage(0);
  }

  const leadBaseNameById: Record<string, string> = {};
  leadBases.forEach((b) => (leadBaseNameById[b.id] = b.name));

  function selectBaseFilter(id: string) {
    setSelectedBaseId((prev) => (prev === id ? '' : id));
    setPage(0);
  }

  async function handleCreateBaseForMove() {
    if (!accountId || !newBaseNameForMove.trim() || creatingBaseForMove) return;
    setCreatingBaseForMove(true);
    try {
      const { data, error } = await supabase
        .from('lead_bases')
        .insert({ account_id: accountId, name: newBaseNameForMove.trim() })
        .select('id, name')
        .single();
      if (error) throw error;
      setLeadBases((prev) => [...prev, { id: data.id, name: data.name }].sort((a, b) => a.name.localeCompare(b.name)));
      setMoveTargetBaseId(data.id);
      setNewBaseNameForMove('');
    } catch {
      toast.error(t('toastFailedCreateBase'));
    } finally {
      setCreatingBaseForMove(false);
    }
  }

  async function handleBulkMoveBase() {
    const ids = [...selected];
    if (ids.length === 0 || !moveTargetBaseId) return;
    setMoving(true);

    const CHUNK = 200;
    const targetId = moveTargetBaseId === '__none__' ? null : moveTargetBaseId;
    let failed = false;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { error } = await supabase
        .from('contacts')
        .update({ lead_base_id: targetId })
        .in('id', ids.slice(i, i + CHUNK));
      if (error) {
        failed = true;
        break;
      }
    }

    setMoving(false);
    if (failed) {
      toast.error(t('toastBulkFailedMove'));
      return;
    }
    toast.success(t('toastBulkMoved', { count: ids.length }));
    setSelected(new Set());
    setMoveBaseOpen(false);
    setMoveTargetBaseId('');
    fetchContacts();
    setGalleryRefreshKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          {!galleryView && (
            <button
              type="button"
              onClick={backToGallery}
              className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              {t('backToBases')}
            </button>
          )}
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          {!galleryView && (
            <p className="text-sm text-muted-foreground mt-1">
              {totalCount > 0 ? t('subtitle', { count: totalCount }) : t('subtitleZero')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canEditSettings && (
            <Button
              variant="outline"
              onClick={() => setDistributionOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <Shuffle className="size-4" />
              {t('distributionBtn')}
            </Button>
          )}
          {canEditSettings && (
            <Button
              variant="outline"
              onClick={() => setCustomFieldsOpen(true)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal className="size-4" />
              {t('customFieldsBtn')}
            </Button>
          )}
          <GatedButton
            variant="outline"
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={() => setImportOpen(true)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            <Upload className="size-4" />
            {t('importBtn')}
          </GatedButton>
          <GatedButton
            canAct={canEdit}
            gateReason="add or import contacts"
            onClick={openAddForm}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="size-4" />
            {t('addContactBtn')}
          </GatedButton>
        </div>
      </div>

      {galleryView ? (
        <LeadBaseGallery
          accountId={accountId}
          onOpenBase={openBase}
          onImportToBase={openBaseAndImport}
          refreshKey={galleryRefreshKey}
          onViewAll={viewAllContacts}
        />
      ) : (
      <>
      {/* Search + tag filter */}
      <div className="space-y-2">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                // Reset pagination when the query changes — the result
                // set shrinks/grows, page N may no longer be valid.
                setPage(0);
              }}
              placeholder={t('searchPlaceholder')}
              className="pl-8 bg-card border-border text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted shrink-0"
                />
              }
            >
              <Filter className="size-4" />
              {t('filterByTags')}
              {selectedTagIds.length > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {selectedTagIds.length}
                </span>
              )}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <span className="text-sm font-medium text-popover-foreground">
                  {t('filterByTags')}
                </span>
                {selectedTagIds.length > 0 && (
                  <button
                    onClick={clearTagFilters}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('clearAll')}
                  </button>
                )}
              </div>
              {allTags.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground text-center">
                  {t('noTagsYet')}
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto py-1">
                  {allTags.map((tag) => (
                    <label
                      key={tag.id}
                      className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedTagIds.includes(tag.id)}
                        onCheckedChange={() => toggleTagFilter(tag.id)}
                        aria-label={`Filter by ${tag.name}`}
                      />
                      <span
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="text-sm text-popover-foreground truncate">
                        {tag.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="outline"
                  className="border-border text-muted-foreground hover:bg-muted shrink-0"
                />
              }
            >
              <Layers className="size-4" />
              {selectedBaseId
                ? selectedBaseId === '__none__'
                  ? t('filterByBaseNone')
                  : (leadBaseNameById[selectedBaseId] ?? t('filterByBase'))
                : t('filterByBase')}
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-0">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-medium text-popover-foreground">{t('filterByBase')}</span>
                {selectedBaseId && (
                  <button
                    onClick={() => selectBaseFilter('')}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    {t('clearAll')}
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-muted/50">
                  <Checkbox
                    checked={selectedBaseId === '__none__'}
                    onCheckedChange={() => selectBaseFilter('__none__')}
                  />
                  <span className="truncate text-sm text-popover-foreground">{t('filterByBaseNone')}</span>
                </label>
                {leadBases.map((base) => (
                  <label
                    key={base.id}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selectedBaseId === base.id}
                      onCheckedChange={() => selectBaseFilter(base.id)}
                    />
                    <span className="truncate text-sm text-popover-foreground">{base.name}</span>
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          {totalCount > 0 && !selectAllMatching && (
            <Button
              variant="outline"
              onClick={selectAllMatchingFilters}
              disabled={selectingAllMatching}
              className="border-border text-muted-foreground hover:bg-muted shrink-0"
            >
              {selectingAllMatching ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ListChecks className="size-4" />
              )}
              {t('selectAllMatching', { count: totalCount })}
            </Button>
          )}
        </div>

        {/* Active tag-filter chips */}
        {selectedTagIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {selectedTagIds.map((id) => {
              const tag = tagsMap[id];
              if (!tag) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    backgroundColor: tag.color + '20',
                    color: tag.color,
                  }}
                >
                  {tag.name}
                  <button
                    onClick={() => toggleTagFilter(id)}
                    aria-label={`Remove ${tag.name} filter`}
                    className="hover:opacity-70"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
            <button
              onClick={clearTagFilters}
              className="text-xs text-muted-foreground hover:text-foreground px-1"
            >
              {t('clearAll')}
            </button>
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="space-y-2">
          {allOnPageSelected && !selectAllMatching && totalCount > contacts.length && (
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-primary-soft px-4 py-2 text-xs text-primary">
              <span>{t('allOnPageSelected', { count: contacts.length })}</span>
              <button
                type="button"
                onClick={selectAllMatchingFilters}
                disabled={selectingAllMatching}
                className="font-semibold underline hover:no-underline disabled:opacity-50"
              >
                {selectingAllMatching
                  ? t('selectingAll')
                  : t('selectAllMatching', { count: totalCount })}
              </button>
            </div>
          )}
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-4 py-2">
          <p className="text-sm text-foreground">
            {selectAllMatching
              ? t('allMatchingSelected', { count: selected.size })
              : t('selectedCount', { count: selected.size })}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelected(new Set());
                setSelectAllMatching(false);
              }}
              className="text-muted-foreground hover:text-foreground"
            >
              {t('clearSelection')}
            </Button>
            {!selectAllMatching && (
              <GatedButton
                variant="outline"
                size="sm"
                canAct={canEdit}
                gateReason="send broadcasts"
                onClick={handleSendInvite}
                className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                <Send className="size-4" />
                {t('sendInvite')}
              </GatedButton>
            )}
            <GatedButton
              variant="outline"
              size="sm"
              canAct={canEdit}
              gateReason="move contacts"
              onClick={() => setMoveBaseOpen(true)}
              className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <FolderInput className="size-4" />
              {t('moveToBase')}
            </GatedButton>
            <GatedButton
              variant="destructive"
              size="sm"
              canAct={canEdit}
              gateReason="delete contacts"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="size-4" />
              {t('deleteSelected')}
            </GatedButton>
          </div>
        </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl border border-border shadow-[var(--shadow)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allOnPageSelected}
                  indeterminate={!allOnPageSelected && someOnPageSelected}
                  onCheckedChange={toggleSelectAll}
                  disabled={contacts.length === 0}
                  aria-label="Select all contacts on this page"
                />
              </TableHead>
              <TableHead className="text-muted-foreground">{t('tableColumns.name')}</TableHead>
              <TableHead className="text-muted-foreground">{t('tableColumns.phone')}</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">{t('tableColumns.tags')}</TableHead>
              <TableHead className="text-muted-foreground hidden md:table-cell">{t('tableColumns.base')}</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">{t('tableColumns.company')}</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">{t('tableColumns.source')}</TableHead>
              <TableHead className="text-muted-foreground hidden lg:table-cell">{t('tableColumns.createdAt')}</TableHead>
              <TableHead className="text-muted-foreground w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">{t('loading')}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {hasActiveFilters
                        ? t('noContactsMatch')
                        : t('noContactsYet')}
                    </p>
                    {!hasActiveFilters && (
                      <GatedButton
                        canAct={canEdit}
                        gateReason="add or import contacts"
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-border text-muted-foreground hover:bg-muted"
                      >
                        <Plus className="size-3.5" />
                        {t('addFirstContact')}
                      </GatedButton>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="cursor-pointer"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(contact.id)}
                      onCheckedChange={() => toggleSelect(contact.id)}
                      aria-label={`Select ${contact.name || contact.phone}`}
                    />
                  </TableCell>
                  <TableCell className="text-foreground font-medium">
                    <div className="flex items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                        {(contact.name || contact.phone).charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate">
                          {contact.name || <span className="text-muted-foreground italic">{t('unnamed')}</span>}
                        </div>
                        {contact.email && (
                          <div className="truncate text-xs font-normal text-muted-foreground">
                            {contact.email}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground text-xs">-</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {contact.lead_base_id && leadBaseNameById[contact.lead_base_id] ? (
                      <span className="inline-flex items-center rounded-full bg-card-2 px-2 py-0.5 text-[11px] font-medium text-foreground">
                        {leadBaseNameById[contact.lead_base_id]}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell text-sm">
                    {contact.company || <span className="text-muted-foreground">-</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell text-xs">
                    {contact.source ? t(`source.${contact.source}`) : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs hidden lg:table-cell">
                    {new Date(contact.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-popover border-border"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(contact);
                          }}
                          className="text-popover-foreground focus:bg-muted focus:text-foreground"
                        >
                          <Pencil className="size-4" />
                          {t('editAction')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(contact);
                          }}
                        >
                          <Trash2 className="size-4" />
                          {t('deleteAction')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {t('showingPagination', {
              start: page * PAGE_SIZE + 1,
              end: Math.min((page + 1) * PAGE_SIZE, totalCount),
              total: totalCount
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => setPage((p) => p - 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              {t('pageCount', { page: page + 1, total: totalPages })}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => setPage((p) => p + 1)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
      </>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
        }}
        onViewExisting={(id) => {
          setFormOpen(false);
          openDetail(id);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={fetchContacts}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          fetchContacts();
          setGalleryRefreshKey((k) => k + 1);
        }}
        defaultLeadBaseId={selectedBaseId && selectedBaseId !== '__none__' ? selectedBaseId : null}
      />

      {/* Custom Fields Manager (admin+) */}
      {canEditSettings && (
        <CustomFieldsManager
          open={customFieldsOpen}
          onOpenChange={setCustomFieldsOpen}
        />
      )}

      {/* Lead Distribution Settings (admin+) */}
      {canEditSettings && (
        <DistributionSettingsDialog
          open={distributionOpen}
          onOpenChange={setDistributionOpen}
        />
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('deleteContactTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteContactDesc', { name: deleteTarget?.name || deleteTarget?.phone || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {t('deleteBulkTitle')}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('deleteBulkDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {t('deleteBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Move to Base */}
      <Dialog
        open={moveBaseOpen}
        onOpenChange={(o) => {
          setMoveBaseOpen(o);
          if (!o) {
            setMoveTargetBaseId('');
            setNewBaseNameForMove('');
          }
        }}
      >
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">{t('moveToBaseTitle')}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {t('moveToBaseDesc', { count: selected.size })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <select
              value={moveTargetBaseId}
              onChange={(e) => setMoveTargetBaseId(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
            >
              <option value="">{t('selectBase')}</option>
              <option value="__none__">{t('filterByBaseNone')}</option>
              {leadBases.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Input
                value={newBaseNameForMove}
                onChange={(e) => setNewBaseNameForMove(e.target.value)}
                placeholder={t('newBaseNamePlaceholder')}
                className="border-border bg-muted text-foreground"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleCreateBaseForMove}
                disabled={creatingBaseForMove || !newBaseNameForMove.trim()}
                className="shrink-0 border-border text-muted-foreground hover:bg-muted"
              >
                {creatingBaseForMove ? <Loader2 className="size-4 animate-spin" /> : t('createBase')}
              </Button>
            </div>
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setMoveBaseOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
            <Button onClick={handleBulkMoveBase} disabled={moving || !moveTargetBaseId}>
              {moving && <Loader2 className="size-4 animate-spin" />}
              {t('moveBtn')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
