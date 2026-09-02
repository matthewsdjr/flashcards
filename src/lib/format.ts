/** Formatea una distancia temporal en la forma compacta que usa Anki: 10m, 2d, 1.5mo. */
export function formatInterval(fromMs: number, toMs: number): string {
  const diff = Math.max(0, toMs - fromMs)
  const minutes = diff / 60000
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = minutes / 60
  if (hours < 24) return `${Math.round(hours)}h`
  const days = hours / 24
  if (days < 30) return `${Math.round(days)}d`
  const months = days / 30.4375
  if (months < 12) return `${months < 10 ? months.toFixed(1) : Math.round(months)}mo`
  const years = days / 365.25
  return `${years < 10 ? years.toFixed(1) : Math.round(years)}a`
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`
}

/** Distancia hasta ahora en lenguaje natural: "hace 3 dias", "hoy". */
export function formatRelative(ms: number, now = Date.now()): string {
  const diff = now - ms
  if (diff < 0) return 'en el futuro'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 2) return 'ahora mismo'
  if (minutes < 60) return `hace ${minutes} minutos`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? 'hace una hora' : `hace ${hours} horas`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'ayer'
  if (days < 30) return `hace ${days} dias`
  const months = Math.floor(days / 30.4375)
  if (months < 12) return months === 1 ? 'hace un mes' : `hace ${months} meses`
  const years = Math.floor(days / 365.25)
  return years === 1 ? 'hace un anio' : `hace ${years} anios`
}
