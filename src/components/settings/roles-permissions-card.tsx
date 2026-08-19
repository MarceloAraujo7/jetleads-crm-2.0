'use client';

import { useTranslations } from 'next-intl';
import { Check, X } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  canManageMembers,
  canEditSettings,
  canSendMessages,
  canRunUnscopedBroadcast,
  canDeleteAccount,
  canTransferOwnership,
  ACCOUNT_ROLES,
  type AccountRole,
} from '@/lib/auth/roles';
import { ROLE_META } from './role-meta';

const PERMISSION_CHECKS: {
  labelKey: string;
  check: (role: AccountRole) => boolean;
}[] = [
  { labelKey: 'permManageMembers', check: canManageMembers },
  { labelKey: 'permEditSettings', check: canEditSettings },
  { labelKey: 'permSendMessages', check: canSendMessages },
  { labelKey: 'permUnscopedBroadcast', check: canRunUnscopedBroadcast },
  { labelKey: 'permTransferOwnership', check: canTransferOwnership },
  { labelKey: 'permDeleteAccount', check: canDeleteAccount },
];

// Highest privilege first, mirroring how the roster's role picker is read.
const DISPLAY_ORDER: readonly AccountRole[] = [...ACCOUNT_ROLES].reverse();

/**
 * Read-only breakdown of what each role can do — derived directly
 * from the real predicates in `lib/auth/roles.ts` so this can never
 * drift from what the role guards actually enforce.
 */
export function RolesPermissionsCard() {
  const t = useTranslations('Settings.members');
  const tRoles = useTranslations('Settings.roles');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground text-base">
          {t('rolesPermissionsTitle')}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t('rolesPermissionsDesc')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DISPLAY_ORDER.map((role) => {
            const meta = ROLE_META[role];
            const RoleIcon = meta.icon;
            return (
              <div
                key={role}
                className="border-border bg-card rounded-2xl border p-4"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-lg border ${meta.className}`}
                  >
                    <RoleIcon className="size-3.5" />
                  </span>
                  <span className="text-foreground text-sm font-medium">
                    {tRoles(role)}
                  </span>
                </div>
                <ul className="space-y-1.5">
                  {PERMISSION_CHECKS.map(({ labelKey, check }) => {
                    const allowed = check(role);
                    return (
                      <li
                        key={labelKey}
                        className={`flex items-center gap-2 text-xs ${
                          allowed
                            ? 'text-foreground'
                            : 'text-muted-foreground/60'
                        }`}
                      >
                        {allowed ? (
                          <Check className="text-primary size-3.5 shrink-0" />
                        ) : (
                          <X className="size-3.5 shrink-0" />
                        )}
                        {t(labelKey)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
