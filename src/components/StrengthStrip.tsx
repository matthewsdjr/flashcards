import { cx } from '../lib/classnames'

/**
 * Reparto de tarjetas por consolidacion en memoria. Es el unico grafico de la
 * app y significa siempre lo mismo, aparezca donde aparezca.
 */
export interface Strength {
  /** Todavia no vistas. */
  new: number
  /** En pasos de aprendizaje o reaprendizaje. */
  learning: number
  /** En repaso con intervalo menor a 21 dias: sabida pero fragil. */
  young: number
  /** En repaso con intervalo de 21 dias o mas: consolidada. */
  mature: number
}

const SEGMENTS = [
  { key: 'mature', label: 'consolidadas', color: 'bg-m-mature', dot: 'text-m-mature' },
  { key: 'young', label: 'sabidas', color: 'bg-m-young', dot: 'text-m-young' },
  { key: 'learning', label: 'aprendiendo', color: 'bg-m-learning', dot: 'text-m-learning' },
  { key: 'new', label: 'sin ver', color: 'bg-m-new', dot: 'text-m-new' },
] as const

export function strengthTotal(s: Strength): number {
  return s.new + s.learning + s.young + s.mature
}

export function StrengthStrip({
  strength,
  className,
  height = 'h-1.5',
}: {
  strength: Strength
  className?: string
  height?: string
}) {
  const total = strengthTotal(strength)
  const parts = SEGMENTS.map((s) => ({ ...s, value: strength[s.key] })).filter((s) => s.value > 0)

  const description = parts.map((p) => `${p.value} ${p.label}`).join(', ')

  if (total === 0) {
    return (
      <div
        className={cx('w-full rounded-full bg-rule-soft', height, className)}
        role="img"
        aria-label="Mazo vacio"
      />
    )
  }

  return (
    <div
      className={cx('flex w-full gap-px overflow-hidden rounded-full', height, className)}
      role="img"
      aria-label={`Reparto de tarjetas: ${description}`}
    >
      {parts.map((part) => (
        <div
          key={part.key}
          className={part.color}
          style={{ width: `${(part.value / total) * 100}%` }}
        />
      ))}
    </div>
  )
}

/** Leyenda compacta con los conteos, para acompañar a la franja. */
export function StrengthLegend({ strength }: { strength: Strength }) {
  const parts = SEGMENTS.filter((s) => strength[s.key] > 0)
  if (parts.length === 0) return null

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {parts.map((part) => (
        <li key={part.key} className="flex items-center gap-1.5">
          <span aria-hidden className={cx('size-2 rounded-full', part.color)} />
          <span className="tnum font-medium text-ink">{strength[part.key]}</span>
          <span>{part.label}</span>
        </li>
      ))}
    </ul>
  )
}
