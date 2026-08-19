'use client';

import { useTranslations } from 'next-intl';
import { KeyRound, ShieldCheck, TimerReset, CalendarClock } from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

const ROWS = [
  { icon: ShieldCheck, labelKey: 'securityTwoFactor' },
  { icon: TimerReset, labelKey: 'securitySessionTimeout' },
  { icon: CalendarClock, labelKey: 'securityOffHours' },
] as const;

/**
 * Preview-only — team-wide 2FA enforcement, session timeout, and
 * off-hours access blocking need real auth infrastructure we don't
 * have yet, so every control here is disabled rather than pretending
 * to work. Ship the shape now, wire it up when that infra lands.
 */
export function AccountSecurityCard() {
  const t = useTranslations('Settings.members');

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-foreground text-base">
            {t('securityTitle')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('securityDesc')}
          </CardDescription>
        </div>
        <Badge
          variant="outline"
          className="border-border text-muted-foreground shrink-0"
        >
          {t('securityComingSoon')}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-1 opacity-60">
        {ROWS.map(({ icon: Icon, labelKey }) => (
          <div
            key={labelKey}
            className="flex items-center justify-between gap-3 rounded-lg px-1 py-2"
          >
            <span className="text-foreground flex items-center gap-2 text-sm">
              <Icon className="text-muted-foreground size-4" />
              {t(labelKey)}
            </span>
            <Switch checked={false} disabled />
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled
          className="border-border mt-2 w-full"
        >
          <KeyRound className="size-3.5" />
          {t('securityForcePasswordReset')}
        </Button>
      </CardContent>
    </Card>
  );
}
