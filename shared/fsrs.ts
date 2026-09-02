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
import type { Card, CardStateValue, DeckConfig } from './tipos.ts'

export { Rating }
export type { Grade }

/** Las cuatro respuestas posibles, en el orden en que se muestran. */
export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]

export function isGrade(value: unknown): value is Grade {
  return GRADES.includes(value as Grade)
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
    state: next.state as CardStateValue,
    lastReview: next.last_review ? next.last_review.getTime() : null,
  }
}

/** Valores de una tarjeta nueva, sin identidad todavia. */
export function emptyCardFields(now = new Date()) {
  const empty = createEmptyCard(now)
  return {
    due: empty.due.getTime(),
    stability: empty.stability,
    difficulty: empty.difficulty,
    elapsedDays: empty.elapsed_days,
    scheduledDays: empty.scheduled_days,
    learningSteps: empty.learning_steps,
    reps: empty.reps,
    lapses: empty.lapses,
    state: empty.state as CardStateValue,
    lastReview: null as number | null,
    suspended: 0 as 0 | 1,
  }
}

/** Las cuatro opciones con su fecha de vencimiento, para pintar los botones. */
export function previewDue(
  card: Card,
  config: DeckConfig,
  now = new Date(),
): Record<number, number> {
  const log: RecordLog = schedulerFor(config).repeat(toFsrsCard(card), now)
  const out: Record<number, number> = {}
  for (const grade of GRADES) out[grade] = log[grade].card.due.getTime()
  return out
}
