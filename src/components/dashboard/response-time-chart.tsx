"use client"

import { Clock } from 'lucide-react'
import { DOW_SHORT_MON_FIRST } from '@/lib/dashboard/date-utils'
import type { ResponseTimeSummary } from '@/lib/dashboard/types'
import { BarChart } from '@/components/tremor/bar-chart'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ResponseTimeChartProps {
  data: ResponseTimeSummary | null
  loading: boolean
  /** Minutes. Surfaced as a "target" pill in the header. The
   *  hand-rolled SVG version drew this as a horizontal dashed
   *  line on the chart; Tremor BarChart doesn't expose Recharts
   *  primitives, so we promote it to the header for now. A
   *  follow-up can introduce an overlay or extend the vendored
   *  BarChart with a `referenceLines` prop. */
  thresholdMinutes?: number
}

import { useTranslations } from 'next-intl'

// Single category, single colour — the data is "average minutes
// per weekday". Tremor expects categories as the second tuple in
// the row object, so we shape the buckets into
// `{ day: 'Mon', 'Avg minutes': 4.2 }` rows below.
const CATEGORY = 'Avg minutes'

export function ResponseTimeChart({
  data,
  loading,
  thresholdMinutes = 5,
}: ResponseTimeChartProps) {
  const t = useTranslations('Dashboard.responseTimeChart')
  const hasData = data?.buckets.some((b) => b.avgMinutes != null) ?? false

  // Map buckets → Tremor rows. Null `avgMinutes` (no samples)
  // collapses to 0; the chart will render an empty slot for it.
  // We attach `samples` on the row so a future customTooltip can
  // surface "no samples" copy without losing the data shape.
  const chartData =
    data?.buckets.map((b, i) => ({
      day: DOW_SHORT_MON_FIRST[i],
      [CATEGORY]: b.avgMinutes ?? 0,
      samples: b.samples,
    })) ?? []

  return (
    <section className="flex flex-1 flex-col rounded-2xl bg-card shadow-[var(--shadow)]">
      <header className="px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">
          {t('title')}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('description')}
        </p>
      </header>

      <div className="flex-1 px-5">
        {loading || !data ? (
          <Skeleton className="h-[180px] w-full" />
        ) : !hasData ? (
          <EmptyState
            icon={Clock}
            title={t('noReplies')}
            hint={t('noRepliesHint')}
          />
        ) : (
          <BarChart
            data={chartData}
            index="day"
            categories={[CATEGORY]}
            colors={['emerald']}
            valueFormatter={(value) => `${value.toFixed(1)}m`}
            showLegend={false}
            showYAxis={false}
            showGridLines={false}
            className="h-[180px]"
          />
        )}
      </div>

      <footer className="flex items-center justify-between rounded-b-2xl bg-card-2 px-5 py-3 text-xs">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{t('overallMedian')}</span>
          {thresholdMinutes > 0 && (
            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-medium text-rose-400 tabular-nums">
              {t('target', { minutes: thresholdMinutes })}
            </span>
          )}
        </div>
        <span className="font-semibold text-foreground tabular-nums">
          {fmt(data?.thisWeekAvg ?? null)}
        </span>
      </footer>
    </section>
  )
}

function fmt(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${mins.toFixed(1)}m`
  return `${(mins / 60).toFixed(1)}h`
}
