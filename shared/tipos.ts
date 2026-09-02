/** Tipos que cruzan la frontera cliente-servidor. Son el contrato de la API. */

export const CardState = {
  New: 0,
  Learning: 1,
  Review: 2,
  Relearning: 3,
} as const
export type CardStateValue = (typeof CardState)[keyof typeof CardState]

/** Umbral de Anki para considerar una tarjeta consolidada. */
export const MATURE_DAYS = 21

export interface DeckConfig {
  newPerDay: number
  reviewsPerDay: number
  /** Retencion objetivo de FSRS, entre 0.7 y 0.98. */
  requestRetention: number
  learningSteps: string[]
  relearningSteps: string[]
  generateReverse: boolean
}

export const DEFAULT_DECK_CONFIG: DeckConfig = {
  newPerDay: 20,
  reviewsPerDay: 200,
  requestRetention: 0.9,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  generateReverse: false,
}

/** Normaliza una config que llega del cliente o de un respaldo viejo. */
export function normalizeConfig(raw: unknown): DeckConfig {
  const input = (raw ?? {}) as Partial<DeckConfig>
  const steps = (value: unknown, fallback: string[]) => {
    if (!Array.isArray(value)) return fallback
    const clean = value.filter(
      (s): s is string => typeof s === 'string' && /^\d+(\.\d+)?[mhd]$/.test(s.trim()),
    )
    return clean.length > 0 ? clean.map((s) => s.trim()) : fallback
  }
  const int = (value: unknown, fallback: number, min: number, max: number) => {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
  }
  return {
    newPerDay: int(input.newPerDay, DEFAULT_DECK_CONFIG.newPerDay, 0, 9999),
    reviewsPerDay: int(input.reviewsPerDay, DEFAULT_DECK_CONFIG.reviewsPerDay, 0, 9999),
    requestRetention: Number.isFinite(Number(input.requestRetention))
      ? Math.min(0.98, Math.max(0.7, Number(input.requestRetention)))
      : DEFAULT_DECK_CONFIG.requestRetention,
    learningSteps: steps(input.learningSteps, DEFAULT_DECK_CONFIG.learningSteps),
    relearningSteps: steps(input.relearningSteps, DEFAULT_DECK_CONFIG.relearningSteps),
    generateReverse: Boolean(input.generateReverse),
  }
}

export interface User {
  id: number
  email: string
  name: string
  isAdmin: boolean
  createdAt: number
}

export interface Deck {
  id: number
  name: string
  description: string
  config: DeckConfig
  createdAt: number
}

export interface DeckStats {
  deckId: number
  total: number
  newCount: number
  learningCount: number
  youngCount: number
  matureCount: number
  suspended: number
  /** Cuantas se pueden estudiar ahora respetando los limites diarios. */
  dueNow: number
}

export interface DeckWithStats extends Deck {
  stats: DeckStats
}

export interface Note {
  id: number
  deckId: number
  front: string
  back: string
  hint: string
  extra: string
  tags: string[]
  createdAt: number
}

export interface Card {
  id: number
  noteId: number
  deckId: number
  reverse: 0 | 1
  due: number
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
  reps: number
  lapses: number
  state: CardStateValue
  lastReview: number | null
  suspended: 0 | 1
}

/** Una tarjeta de la cola, con el contenido que necesita mostrar el cliente. */
export interface QueueItem {
  card: Card
  note: Note
  /** Intervalo previsto por cada calificacion, ya formateado por el servidor. */
  preview: Record<number, number>
}

export interface NoteWithCards {
  note: Note
  cards: Card[]
}

export interface AnswerResult {
  card: Card
  /** Cola actualizada tras responder, para no pedirla de nuevo. */
  queueLength: number
}

export interface ImportRecord {
  id: number
  deckId: number | null
  deckName: string | null
  filename: string
  bytes: number
  delimiter: string
  rows: number
  added: number
  updated: number
  skipped: number
  invalid: number
  createdAt: number
}

export interface Invite {
  code: string
  createdAt: number
  expiresAt: number
  usedBy: string | null
  usedAt: number | null
  note: string
}

export interface StatsResponse {
  history: { day: string; count: number }[]
  forecast: { day: string; count: number }[]
  strength: { new: number; learning: number; young: number; mature: number }
  totalCards: number
  reviews: number
  accuracy: number | null
  totalTime: number
  streak: number
  deckCount: number
}

/** Dia local en YYYY-MM-DD. El servidor lo calcula en la zona del usuario. */
export function localDay(date: Date = new Date(), offsetMinutes = 0): string {
  const shifted = new Date(date.getTime() - offsetMinutes * 60000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Hash estable y barato (FNV-1a) para deduplicar notas al reimportar. */
export function checksumOf(front: string, back: string): string {
  const input = `${front} ${back}`
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16)
}
