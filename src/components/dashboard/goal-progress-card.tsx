interface GoalProgressCardProps {
  label: string
  current: number
  goal: number
  /** Footer line, e.g. "12 of 20 deals". Already formatted by the caller. */
  subtitle: string
}

// SVG ring geometry — r=18 on a 44x44 viewBox, matching the card's own
// visual scale (a 64px rendered circle). Circumference = 2 * PI * 18.
const RING_RADIUS = 18
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export function GoalProgressCard({ label, current, goal, subtitle }: GoalProgressCardProps) {
  const pct = goal > 0 ? Math.min(100, Math.round((current / goal) * 100)) : 0
  const dashOffset = RING_CIRCUMFERENCE * (1 - pct / 100)

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-[18px] shadow-[var(--shadow)]"
      style={{
        // Both stops stay on the light/bright end of the accent's own
        // scale (never the accent's darkest tone) — a dark corner
        // paired with --primary-foreground text reads as low-contrast
        // on some accents, so the gradient only spans two close, both-
        // light stops instead of mimicking a literal dark-to-bright mock.
        background: 'linear-gradient(135deg, var(--primary-hover), var(--primary))',
      }}
    >
      <div
        aria-hidden
        className="absolute -right-10 -bottom-15 h-50 w-50 rounded-full bg-white/12"
      />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-sm leading-snug font-bold text-primary-foreground">
          {label}
        </div>
        <svg viewBox="0 0 44 44" className="h-16 w-16 shrink-0 -rotate-90">
          <circle
            cx="22"
            cy="22"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--primary-foreground)"
            strokeOpacity="0.25"
            strokeWidth="6"
          />
          <circle
            cx="22"
            cy="22"
            r={RING_RADIUS}
            fill="none"
            stroke="var(--primary-foreground)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </svg>
      </div>
      <div className="relative mt-3.5 text-[26px] font-bold tracking-tight text-primary-foreground">
        {pct}%
      </div>
      <div className="relative mt-1 text-xs font-semibold text-primary-foreground/75">
        {subtitle}
      </div>
    </div>
  )
}
