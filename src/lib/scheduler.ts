import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type Card as FsrsCard,
  type Grade,
  type RecordLog,
  type StepUnit,
} from 'ts-fsrs'
import type { Card, DeckConfig } from '../db/schema'

export { Rating }
export type { Grade }

/** Las cuatro respuestas posibles, en el orden en que se muestran los botones. */
export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]

export const GRADE_LABELS: Record<Grade, string> = {
  [Rating.Again]: 'Otra vez',
  [Rating.Hard]: 'Dificil',
  [Rating.Good]: 'Bien',
  [Rating.Easy]: 'Facil',
}

export const GRADE_KEYS: Record<Grade, string> = {
  [Rating.Again]: '1',
  [Rating.Hard]: '2',
  [Rating.Good]: '3',
  [Rating.Easy]: '4',
}

export const GRADE_CLASSES: Record<Grade, string> = {
  [Rating.Again]: 'bg-rose-600 hover:bg-rose-500 focus-visible:outline-rose-400',
  [Rating.Hard]: 'bg-amber-600 hover:bg-amber-500 focus-visible:outline-amber-400',
  [Rating.Good]: 'bg-emerald-600 hover:bg-emerald-500 focus-visible:outline-emerald-400',
  [Rating.Easy]: 'bg-sky-600 hover:bg-sky-500 focus-visible:outline-sky-400',
}

function toSteps(steps: string[]): StepUnit[] {
  return steps.filter((s) => /^\d+(\.\d+)?[mhd]$/.test(s)) as StepUnit[]
}

/** Instancia de FSRS configurada con los parametros del mazo. */
export function schedulerFor(config: DeckConfig) {
  return fsrs(
    generatorParameters({
      request_retention: config.requestRetention,
      enable_fuzz: true,
      enable_short_term: true,
      learning_steps: toSteps(config.learningSteps),
      relearning_steps: toSteps(config.relearningSteps),
    }),
  )
}

/** Convierte una tarjeta almacenada al formato que espera ts-fsrs. */
export function toFsrsCard(card: Card): FsrsCard {
  return {
    due: new Date(card.due),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state as State,
    last_review: card.lastReview ? new Date(card.lastReview) : undefined,
  }
}

/** Vuelca el resultado de ts-fsrs sobre el registro persistido. */
export function applyFsrsCard(card: Card, next: FsrsCard): Card {
  return {
    ...card,
    due: next.due.getTime(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: next.elapsed_days,
    scheduledDays: next.scheduled_days,
    learningSteps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state as Card['state'],
    lastReview: next.last_review ? next.last_review.getTime() : null,
  }
}

/** Tarjeta nueva lista para persistir. */
export function newCard(noteId: number, deckId: number, reverse: 0 | 1, now = new Date()): Card {
  const empty = createEmptyCard(now)
  return {
    noteId,
    deckId,
    reverse,
    due: empty.due.getTime(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsedDays: empty.elapsed_days,
    scheduledDays: empty.scheduled_days,
    learningSteps: empty.learning_steps,
    reps: empty.reps,
    lapses: empty.lapses,
    state: empty.state as Card['state'],
    lastReview: null,
    suspended: 0,
  }
}

/** Previsualiza las cuatro opciones para mostrar el intervalo en cada boton. */
export function preview(card: Card, config: DeckConfig, now = new Date()): RecordLog {
  return schedulerFor(config).repeat(toFsrsCard(card), now)
}
