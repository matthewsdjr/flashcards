import {
  CardState,
  DEFAULT_DECK_CONFIG,
  db,
  localDay,
  type Card,
  type Deck,
  type DeckConfig,
  type Note,
} from './schema'
import { applyFsrsCard, schedulerFor, toFsrsCard, type Grade } from '../lib/scheduler'

/** Umbral de Anki para considerar una tarjeta consolidada. */
export const MATURE_DAYS = 21

export interface DeckStats {
  deckId: number
  total: number
  newCount: number
  learningCount: number
  reviewCount: number
  /** En repaso con intervalo menor a MATURE_DAYS. */
  youngCount: number
  /** En repaso con intervalo de MATURE_DAYS o mas. */
  matureCount: number
  suspended: number
  /** Cuantas tarjetas se pueden estudiar ahora respetando los limites diarios. */
  dueNow: number
}

/** Cuenta pendientes de un mazo aplicando los topes diarios configurados. */
export async function deckStats(deck: Deck, now = Date.now()): Promise<DeckStats> {
  const deckId = deck.id!
  const cards = await db.cards.where('deckId').equals(deckId).toArray()
  const active = cards.filter((c) => c.suspended === 0)

  const newCards = active.filter((c) => c.state === CardState.New)
  const learning = active.filter(
    (c) => c.state === CardState.Learning || c.state === CardState.Relearning,
  )
  const review = active.filter((c) => c.state === CardState.Review)

  const counts = await todayCounts(deckId)
  const newBudget = Math.max(0, deck.config.newPerDay - counts.newCount)
  const reviewBudget = Math.max(0, deck.config.reviewsPerDay - counts.reviewCount)

  const dueNew = Math.min(newCards.length, newBudget)
  const dueLearning = learning.filter((c) => c.due <= now).length
  const dueReview = Math.min(review.filter((c) => c.due <= now).length, reviewBudget)

  return {
    deckId,
    total: cards.length,
    newCount: newCards.length,
    learningCount: learning.length,
    reviewCount: review.length,
    youngCount: review.filter((c) => c.scheduledDays < MATURE_DAYS).length,
    matureCount: review.filter((c) => c.scheduledDays >= MATURE_DAYS).length,
    suspended: cards.length - active.length,
    dueNow: dueNew + dueLearning + dueReview,
  }
}

/** Adapta los conteos del mazo al formato que consume la franja de memoria. */
export function toStrength(stats: DeckStats) {
  return {
    new: stats.newCount,
    learning: stats.learningCount,
    young: stats.youngCount,
    mature: stats.matureCount,
  }
}

export async function todayCounts(deckId: number) {
  const day = localDay()
  const row = await db.dayCounts.where('[deckId+day]').equals([deckId, day]).first()
  return row ?? { deckId, day, newCount: 0, reviewCount: 0 }
}

async function bumpTodayCount(deckId: number, field: 'newCount' | 'reviewCount') {
  const day = localDay()
  const existing = await db.dayCounts.where('[deckId+day]').equals([deckId, day]).first()
  if (existing) {
    await db.dayCounts.update(existing.id!, { [field]: existing[field] + 1 })
  } else {
    await db.dayCounts.add({ deckId, day, newCount: 0, reviewCount: 0, [field]: 1 })
  }
}

/**
 * Arma la cola de estudio de un mazo.
 *
 * Orden: primero lo que vence en aprendizaje (para no perder los pasos cortos),
 * luego los repasos por antiguedad, y al final las tarjetas nuevas. Los limites
 * diarios se aplican por separado a nuevas y a repasos, igual que en Anki.
 */
export async function buildQueue(deck: Deck, now = Date.now()): Promise<Card[]> {
  const deckId = deck.id!
  const cards = await db.cards.where('deckId').equals(deckId).toArray()
  const active = cards.filter((c) => c.suspended === 0)
  const counts = await todayCounts(deckId)

  const learning = active
    .filter(
      (c) =>
        (c.state === CardState.Learning || c.state === CardState.Relearning) && c.due <= now,
    )
    .sort((a, b) => a.due - b.due)

  const reviews = active
    .filter((c) => c.state === CardState.Review && c.due <= now)
    .sort((a, b) => a.due - b.due)
    .slice(0, Math.max(0, deck.config.reviewsPerDay - counts.reviewCount))

  const fresh = active
    .filter((c) => c.state === CardState.New)
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    .slice(0, Math.max(0, deck.config.newPerDay - counts.newCount))

  return [...learning, ...reviews, ...fresh]
}

/**
 * Registra una respuesta: reprograma la tarjeta con FSRS, guarda el revlog
 * y actualiza el contador del dia. Todo en una transaccion.
 */
export async function answerCard(
  card: Card,
  config: DeckConfig,
  grade: Grade,
  durationMs: number,
  now = new Date(),
): Promise<Card> {
  const wasNew = card.state === CardState.New
  const wasReview = card.state === CardState.Review

  const result = schedulerFor(config).next(toFsrsCard(card), now, grade)
  const updated = applyFsrsCard(card, result.card)

  await db.transaction('rw', db.cards, db.revlog, db.dayCounts, async () => {
    await db.cards.update(card.id!, updated)
    await db.revlog.add({
      cardId: card.id!,
      deckId: card.deckId,
      rating: result.log.rating,
      state: result.log.state as Card['state'],
      due: result.log.due.getTime(),
      stability: result.log.stability,
      difficulty: result.log.difficulty,
      elapsedDays: result.log.elapsed_days,
      lastElapsedDays: result.log.last_elapsed_days,
      scheduledDays: result.log.scheduled_days,
      learningSteps: result.log.learning_steps,
      review: result.log.review.getTime(),
      durationMs,
    })
    if (wasNew) await bumpTodayCount(card.deckId, 'newCount')
    else if (wasReview) await bumpTodayCount(card.deckId, 'reviewCount')
  })

  return updated
}

export async function createDeck(
  name: string,
  description = '',
  config: Partial<DeckConfig> = {},
): Promise<number> {
  return db.decks.add({
    name: name.trim(),
    description: description.trim(),
    createdAt: Date.now(),
    config: { ...DEFAULT_DECK_CONFIG, ...config },
  })
}

/** Borra el mazo con todas sus notas, tarjetas, historial y contadores. */
export async function deleteDeck(deckId: number): Promise<void> {
  await db.transaction('rw', db.decks, db.notes, db.cards, db.revlog, db.dayCounts, async () => {
    await db.cards.where('deckId').equals(deckId).delete()
    await db.notes.where('deckId').equals(deckId).delete()
    await db.revlog.where('deckId').equals(deckId).delete()
    await db.dayCounts.where('deckId').equals(deckId).delete()
    await db.decks.delete(deckId)
  })
}

/** Borra una nota y todas las tarjetas que genero. */
export async function deleteNote(noteId: number): Promise<void> {
  await db.transaction('rw', db.notes, db.cards, db.revlog, async () => {
    const cards = await db.cards.where('noteId').equals(noteId).toArray()
    for (const card of cards) {
      await db.revlog.where('cardId').equals(card.id!).delete()
    }
    await db.cards.where('noteId').equals(noteId).delete()
    await db.notes.delete(noteId)
  })
}

/** Devuelve la tarjeta al estado nuevo, descartando su programacion. */
export async function resetCards(cardIds: number[]): Promise<void> {
  await db.transaction('rw', db.cards, async () => {
    for (const id of cardIds) {
      await db.cards.update(id, {
        due: Date.now(),
        stability: 0,
        difficulty: 0,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        state: CardState.New,
        lastReview: null,
      })
    }
  })
}

export async function setSuspended(cardIds: number[], suspended: boolean): Promise<void> {
  await db.cards.where('id').anyOf(cardIds).modify({ suspended: suspended ? 1 : 0 })
}

export interface NoteWithCards {
  note: Note
  cards: Card[]
}

/** Notas de un mazo junto a sus tarjetas, para la vista de exploracion. */
export async function notesOfDeck(deckId: number): Promise<NoteWithCards[]> {
  const [notes, cards] = await Promise.all([
    db.notes.where('deckId').equals(deckId).toArray(),
    db.cards.where('deckId').equals(deckId).toArray(),
  ])
  const byNote = new Map<number, Card[]>()
  for (const card of cards) {
    const list = byNote.get(card.noteId)
    if (list) list.push(card)
    else byNote.set(card.noteId, [card])
  }
  return notes.map((note) => ({ note, cards: byNote.get(note.id!) ?? [] }))
}
