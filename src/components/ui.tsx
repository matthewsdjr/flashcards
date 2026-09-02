import type { ReactNode } from 'react'
import { cx } from '../lib/classnames'

const BUTTON_VARIANTS = {
  primary: 'bg-claret text-on-claret hover:bg-claret-hi shadow-raised',
  secondary: 'bg-paper text-ink border border-rule hover:border-ink-3 shadow-raised',
  ghost: 'text-ink-2 hover:bg-panel hover:text-ink',
  danger: 'bg-danger text-on-claret hover:opacity-90 shadow-raised',
} as const

export type ButtonVariant = keyof typeof BUTTON_VARIANTS

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
        'transition duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        BUTTON_VARIANTS[variant],
        className,
      )}
    />
  )
}

/**
 * Superficie elevada. El radio codifica jerarquia: `soft` para bloques de
 * apoyo, `hero` solo para la ficha en estudio.
 */
export function Panel({
  className,
  children,
  radius = 'soft',
}: {
  className?: string
  children: ReactNode
  radius?: 'soft' | 'hero'
}) {
  return (
    <div
      className={cx(
        'bg-paper',
        radius === 'hero' ? 'rounded-2xl shadow-card' : 'rounded-lg border border-rule',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Encabezado de seccion: el titulo va en la serif, la ayuda debajo. */
export function SectionHeading({
  title,
  description,
  actions,
  as: Tag = 'h2',
}: {
  title: string
  description?: string
  actions?: ReactNode
  as?: 'h1' | 'h2'
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <Tag
          className={cx(
            'display font-medium text-ink',
            Tag === 'h1' ? 'text-3xl sm:text-4xl' : 'text-xl',
          )}
        >
          {title}
        </Tag>
        {description && <p className="mt-1.5 max-w-prose text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-2">{hint}</span>}
    </label>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 cursor-pointer rounded border-rule text-claret accent-claret"
      />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-2">{hint}</span>}
      </span>
    </label>
  )
}

/** Dato numerico destacado: el numero manda, la etiqueta acompaña. */
export function Stat({
  value,
  label,
  tone = 'ink',
}: {
  value: string | number
  label: string
  tone?: 'ink' | 'claret'
}) {
  return (
    <div>
      <p
        className={cx(
          'display tnum text-2xl font-medium',
          tone === 'claret' ? 'text-claret' : 'text-ink',
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-ink-2">{label}</p>
    </div>
  )
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded border border-rule px-1.5 py-0.5 text-xs text-ink-2">
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed border-rule px-6 py-16 text-center">
      <h3 className="display text-xl font-medium text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-2">{description}</p>
      {action && <div className="mt-6 flex justify-center gap-2">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Cargando' }: { label?: string }) {
  return (
    <p className="py-12 text-center text-sm text-ink-2" role="status">
      {label}
    </p>
  )
}
