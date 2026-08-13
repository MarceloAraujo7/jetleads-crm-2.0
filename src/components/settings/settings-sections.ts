import {
  KeyRound,
  LayoutGrid,
  Palette,
  Shield,
  Tags,
  User,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture.
 *
 * Settings holds only account-level concerns now — WhatsApp (+
 * templates + quick replies) and Team live at their own top-level
 * routes (`/whatsapp`, `/team`) with their own page chrome, not as
 * tabs nested inside this rail. The URL query param stays `?tab=`
 * for what remains (deep-linkable, and it keeps existing links
 * working) — `resolveSection` maps old values onto the new sections,
 * and `src/app/(dashboard)/settings/page.tsx` separately redirects
 * the moved-out tabs to their new routes.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'fields',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account' },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'workspace' },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'workspace' },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Tabs that used to live in Settings and now have their own
 * top-level route. `settings/page.tsx` checks this first and
 * redirects — kept separate from `resolveSection` since a route
 * isn't a `SettingsSection`.
 */
export const MOVED_SECTION_ROUTES: Record<string, string> = {
  whatsapp: '/whatsapp',
  templates: '/whatsapp',
  'quick-replies': '/whatsapp',
  members: '/team',
};

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields →
 * the merged "Fields & tags" section). Unknown values (including the
 * moved-out WhatsApp/Team tabs — see `MOVED_SECTION_ROUTES`, and
 * "Deals & currency", which has no replacement) fall to Overview.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
