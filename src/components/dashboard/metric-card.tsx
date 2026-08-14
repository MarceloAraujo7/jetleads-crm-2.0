import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  icon: ComponentType<{ className?: string }>
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
}

export function MetricCard({ title, value, icon: Icon, delta, subtitle }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-[18px] shadow-[var(--shadow)]">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {delta ? <DeltaPill sign={delta.sign} label={delta.label} /> : null}
      </div>
      <p className="mt-4 text-[12.5px] font-semibold text-muted-foreground">{title}</p>
      <p className="mt-1.5 text-[28px] leading-none font-bold tabular-nums text-foreground">
        {value}
      </p>
      {!delta && subtitle ? (
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  )
}

function DeltaPill({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'bg-primary-soft text-primary'
      : sign < 0
      ? 'bg-destructive/10 text-destructive'
      : 'bg-muted text-muted-foreground'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div
      className={cn(
        'ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-bold tabular-nums',
        tone,
      )}
    >
      <Arrow className="h-3 w-3" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
