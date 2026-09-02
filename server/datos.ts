import { db, queryAll, queryOne, transaction } from './db.ts'
import {
  CardState,
  DEFAULT_DECK_CONFIG,
  MATURE_DAYS,
  checksumOf,
  localDay,
  normalizeConfig,
  type Card,
  type Deck,
  type DeckConfig,
  type DeckStats,
  type Note,
  type NoteWithCards,
  type QueueItem,
} from '../shared/tipos.ts'
import {
  applyFsrsCard,
  emptyCardFields,
  previewDue,
  schedulerFor,
  toFsrsCard,
  type Grade,
} from '../shared/fsrs.ts'

/*
 * Toda funcion recibe userId y lo incluye en el WHERE. Nunca se busca una fila
 * solo por su id: asi una cuenta no puede alcanzar datos de otra ni siquiera
 * si adivina un identificador.
 */

interface DeckRow {
  id: number
  name: string
  description: string
  config: string
  created_at: number
}

function toDeck(row: DeckRow): Deck {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: normalizeConfig(JSON.parse(row.config)),
    createdAt: row.created_at,
  }
}

interface CardRow {
  id: number
  note_id: number
  deck_id: number
  reverse: number
  due: number
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  learning_steps: number
  reps: number
  lapses: number
  state: number
  last_review: number | null
  suspended: number
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    noteId: row.note_id,
    deckId: row.deck_id,
    reverse: row.reverse === 1 ? 1 : 0,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    learningSteps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state as Card['state'],
    lastReview: row.last_review,
    suspended: row.suspended === 1 ? 1 : 0,
  }
}

interface NoteRow {
  id: number
  deck_id: number
  front: string
  back: string
  hint: string
  extra: string
  tags: string
  created_at: number
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    deckId: row.deck_id,
    front: row.front,
    back: row.back,
    hint: row.hint,
    extra: row.extra,
    tags: row.tags ? row.tags.split(' ').filter(Boolean) : [],
    createdAt: row.created_at,
  }
}

const DECK_COLUMNS = 'id, name, description, config, created_at'
const CARD_COLUMNS =
  'id, note_id, deck_id, reverse, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, suspended'
const NOTE_COLUMNS = 'id, deck_id, front, back, hint, extra, tags, created_at'

export function listDecks(userId: number): Deck[] {
  return queryAll<DeckRow>(
    `SELECT ${DECK_COLUMNS} FROM decks WHERE user_id = ? ORDER BY created_at DESC`,
    userId,
  ).map(toDeck)
}

export function getDeck(userId: number, deckId: number): Deck | null {
  const row = queryOne<DeckRow>(
    `SELECT ${DECK_COLUMNS} FROM decks WHERE id = ? AND user_id = ?`,
    deckId,
    userId,
  )
  return row ? toDeck(row) : null
}

export function createDeck(
  userId: number,
  name: string,
  description = '',
  config: Partial<DeckConfig> = {},
): Deck {
  const now = Date.now()
  const merged = normalizeConfig({ ...DEFAULT_DECK_CONFIG, ...config })
  const result = db
    .prepare(
      'INSERT INTO decks (user_id, name, description, config, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(userId, name.trim().slice(0, 120), description.trim().slice(0, 500), JSON.stringify(merged), now)
  return {
    id: Number(result.lastInsertRowid),
    name: name.trim().slice(0, 120),
    description: description.trim().slice(0, 500),
    config: merged,
    createdAt: now,
  }
}

export function updateDeck(
  userId: number,
  deckId: number,
  patch: { name?: string; description?: string; config?: unknown },
): Deck | null {
  const deck = getDeck(userId, deckId)
  if (!deck) return null
  const name = patch.name !== undefined ? patch.name.trim().slice(0, 120) || deck.name : deck.name
  const description =
    patch.description !== undefined ? patch.description.trim().slice(0, 500) : deck.description
  const config = patch.config !== undefined ? normalizeConfig(patch.config) : deck.config
  db.prepare('UPDATE decks SET name = ?, description = ?, config = ? WHERE id = ? AND user_id = ?').run(
    name,
    description,
    JSON.stringify(config),
    deckId,
    userId,
  )
  return { ...deck, name, description, config }
}

export function deleteDeck(userId: number, deckId: number): boolean {
  const result = db.prepare('DELETE FROM decks WHERE id = ? AND user_id = ?').run(deckId, userId)
  return Number(result.changes) > 0
}

export function todayCounts(userId: number, deckId: number, tzOffset: number) {
  const day = localDay(new Date(), tzOffset)
  const row = queryOne<{ new_count: number; review_count: number }>(
    'SELECT new_count, review_count FROM day_counts WHERE deck_id = ? AND user_id = ? AND day = ?',
    deckId,
    userId,
    day,
  )
  return { day, newCount: row?.new_count ?? 0, reviewCount: row?.review_count ?? 0 }
}

function bumpTodayCount(
  userId: number,
  deckId: number,
  day: string,
  field: 'new_count' | 'review_count',
) {
  db.prepare(
    `INSERT INTO day_counts (deck_id, user_id, day, new_count, review_count)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(deck_id, day) DO UPDATE SET ${field} = ${field} + 1`,
  ).run(deckId, userId, day, field === 'new_count' ? 1 : 0, field === 'review_count' ? 1 : 0)
}

export function deckStats(
  userId: number,
  deck: Deck,
  tzOffset: number,
  now = Date.now(),
): DeckStats {
  const row = queryOne<Record<string, number | null>>(
    `SELECT
         COUNT(*)                                                              AS total,
         SUM(CASE WHEN suspended = 1 THEN 1 ELSE 0 END)                        AS suspended,
         SUM(CASE WHEN suspended = 0 AND state = 0 THEN 1 ELSE 0 END)          AS new_count,
         SUM(CASE WHEN suspended = 0 AND state IN (1, 3) THEN 1 ELSE 0 END)    AS learning,
         SUM(CASE WHEN suspended = 0 AND state = 2 AND scheduled_days <  ? THEN 1 ELSE 0 END) AS young,
         SUM(CASE WHEN suspended = 0 AND state = 2 AND scheduled_days >= ? THEN 1 ELSE 0 END) AS mature,
         SUM(CASE WHEN suspended = 0 AND state IN (1, 3) AND due <= ? THEN 1 ELSE 0 END)      AS due_learning,
         SUM(CASE WHEN suspended = 0 AND state = 2      AND due <= ? THEN 1 ELSE 0 END)      AS due_review
       FROM cards WHERE deck_id = ? AND user_id = ?`,
    MATURE_DAYS,
    MATURE_DAYS,
    now,
    now,
    deck.id,
    userId,
  )!

  const counts = todayCounts(userId, deck.id, tzOffset)
  const newCount = row.new_count ?? 0
  const dueNew = Math.min(newCount, Math.max(0, deck.config.newPerDay - counts.newCount))
  const dueReview = Math.min(
    row.due_review ?? 0,
    Math.max(0, deck.config.reviewsPerDay - counts.reviewCount),
  )

  return {
    deckId: deck.id,
    total: row.total ?? 0,
    newCount,
    learningCount: row.learning ?? 0,
    youngCount: row.young ?? 0,
    matureCount: row.mature ?? 0,
    suspended: row.suspended ?? 0,
    dueNow: dueNew + (row.due_learning ?? 0) + dueReview,
  }
}

/**
 * Cola de estudio: primero lo que vence en aprendizaje (para no perder los
 * pasos cortos), luego los repasos por antiguedad y al final las nuevas.
 * Los limites diarios se aplican por separado a nuevas y a repasos.
 */
export function buildQueue(
  userId: number,
  deck: Deck,
  tzOffset: number,
  now = Date.now(),
): QueueItem[] {
  const counts = todayCounts(userId, deck.id, tzOffset)
  const newBudget = Math.max(0, deck.config.newPerDay - counts.newCount)
  const reviewBudget = Math.max(0, deck.config.reviewsPerDay - counts.reviewCount)

  const learning = queryAll<CardRow>(
    `SELECT ${CARD_COLUMNS} FROM cards
     WHERE deck_id = ? AND user_id = ? AND suspended = 0 AND state IN (1, 3) AND due <= ?
     ORDER BY due ASC`,
    deck.id,
    userId,
    now,
  )

  const reviews =
    reviewBudget > 0
      ? queryAll<CardRow>(
          `SELECT ${CARD_COLUMNS} FROM cards
           WHERE deck_id = ? AND user_id = ? AND suspended = 0 AND state = 2 AND due <= ?
           ORDER BY due ASC LIMIT ?`,
          deck.id,
          userId,
          now,
          reviewBudget,
        )
      : []

  const fresh =
    newBudget > 0
      ? queryAll<CardRow>(
          `SELECT ${CARD_COLUMNS} FROM cards
           WHERE deck_id = ? AND user_id = ? AND suspended = 0 AND state = 0
           ORDER BY id ASC LIMIT ?`,
          deck.id,
          userId,
          newBudget,
        )
      : []

  const cards = [...learning, ...reviews, ...fresh].map(toCard)
  return attachNotes(userId, cards, deck.config)
}

/** Completa cada tarjeta con su nota y con los intervalos previstos. */
function attachNotes(userId: number, cards: Card[], config: DeckConfig): QueueItem[] {
  if (cards.length === 0) return []
  const ids = [...new Set(cards.map((c) => c.noteId))]
  const rows = queryAll<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM notes
     WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
    userId,
    ...ids,
  )
  const byId = new Map(rows.map((r) => [r.id, toNote(r)]))
  const now = new Date()

  const out: QueueItem[] = []
  for (const card of cards) {
    const note = byId.get(card.noteId)
    if (!note) continue
    out.push({ card, note, preview: previewDue(card, config, now) })
  }
  return out
}

export function getCard(userId: number, cardId: number): Card | null {
  const row = queryOne<CardRow>(
    `SELECT ${CARD_COLUMNS} FROM cards WHERE id = ? AND user_id = ?`,
    cardId,
    userId,
  )
  return row ? toCard(row) : null
}

/** Registra una respuesta: reprograma con FSRS, guarda el repaso y el conteo. */
export function answerCard(
  userId: number,
  card: Card,
  config: DeckConfig,
  grade: Grade,
  durationMs: number,
  tzOffset: number,
  now = new Date(),
): Card {
  const wasNew = card.state === CardState.New
  const wasReview = card.state === CardState.Review
  const result = schedulerFor(config).next(toFsrsCard(card), now, grade)
  const updated = applyFsrsCard(card, result.card)
  const day = localDay(now, tzOffset)

  return transaction(() => {
    db.prepare(
      `UPDATE cards SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
         scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?, state = ?, last_review = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      updated.due,
      updated.stability,
      updated.difficulty,
      updated.elapsedDays,
      updated.scheduledDays,
      updated.learningSteps,
      updated.reps,
      updated.lapses,
      updated.state,
      updated.lastReview,
      card.id,
      userId,
    )

    db.prepare(
      `INSERT INTO reviews (card_id, deck_id, user_id, rating, state, due, stability, difficulty,
         elapsed_days, last_elapsed_days, scheduled_days, learning_steps, reviewed_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      card.id,
      card.deckId,
      userId,
      result.log.rating,
      result.log.state,
      result.log.due.getTime(),
      result.log.stability,
      result.log.difficulty,
      result.log.elapsed_days,
      result.log.last_elapsed_days,
      result.log.scheduled_days,
      result.log.learning_steps,
      result.log.review.getTime(),
      Math.max(0, Math.min(600000, Math.round(durationMs))),
    )

    if (wasNew) bumpTodayCount(userId, card.deckId, day, 'new_count')
    else if (wasReview) bumpTodayCount(userId, card.deckId, day, 'review_count')

    return updated
  })
}

export function notesOfDeck(userId: number, deckId: number): NoteWithCards[] {
  const notes = queryAll<NoteRow>(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE deck_id = ? AND user_id = ? ORDER BY id ASC`,
    deckId,
    userId,
  )
  const cards = queryAll<CardRow>(
    `SELECT ${CARD_COLUMNS} FROM cards WHERE deck_id = ? AND user_id = ? ORDER BY id ASC`,
    deckId,
    userId,
  )

  const byNote = new Map<number, Card[]>()
  for (const row of cards) {
    const card = toCard(row)
    const list = byNote.get(card.noteId)
    if (list) list.push(card)
    else byNote.set(card.noteId, [card])
  }
  return notes.map((row) => ({ note: toNote(row), cards: byNote.get(row.id) ?? [] }))
}

export function deleteNote(userId: number, noteId: number): boolean {
  const result = db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(noteId, userId)
  return Number(result.changes) > 0
}

export function resetCards(userId: number, cardIds: number[]): number {
  if (cardIds.length === 0) return 0
  const empty = emptyCardFields()
  const placeholders = cardIds.map(() => '?').join(',')
  const result = db
    .prepare(
      `UPDATE cards SET due = ?, stability = 0, difficulty = 0, elapsed_days = 0,
         scheduled_days = 0, learning_steps = 0, reps = 0, lapses = 0, state = 0, last_review = NULL
       WHERE user_id = ? AND id IN (${placeholders})`,
    )
    .run(empty.due, userId, ...cardIds)
  return Number(result.changes)
}

export function setSuspended(userId: number, cardIds: number[], suspended: boolean): number {
  if (cardIds.length === 0) return 0
  const placeholders = cardIds.map(() => '?').join(',')
  const result = db
    .prepare(`UPDATE cards SET suspended = ? WHERE user_id = ? AND id IN (${placeholders})`)
    .run(suspended ? 1 : 0, userId, ...cardIds)
  return Number(result.changes)
}

export interface DraftNote {
  front: string
  back: string
  hint: string
  extra: string
  tags: string[]
}

export interface InsertResult {
  added: number
  updated: number
  skipped: number
  invalid: number
  cardsCreated: number
}

/** Alta de notas con deduplicacion. Es el nucleo de la importacion. */
export function insertNotes(
  userId: number,
  deck: Deck,
  drafts: DraftNote[],
  onDuplicate: 'skip' | 'update' | 'add',
): InsertResult {
  const result: InsertResult = { added: 0, updated: 0, skipped: 0, invalid: 0, cardsCreated: 0 }
  const now = Date.now()

  const existing = queryAll<{ id: number; checksum: string }>(
    'SELECT id, checksum FROM notes WHERE deck_id = ? AND user_id = ?',
    deck.id,
    userId,
  )
  const byChecksum = new Map(existing.map((n) => [n.checksum, n.id]))
  const seenInBatch = new Set<string>()

  return transaction(() => {
    const insertNote = db.prepare(
      `INSERT INTO notes (deck_id, user_id, front, back, hint, extra, tags, checksum, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const updateNote = db.prepare(
      'UPDATE notes SET hint = ?, extra = ?, tags = ? WHERE id = ? AND user_id = ?',
    )
    const insertCard = db.prepare(
      `INSERT INTO cards (note_id, deck_id, user_id, reverse, due, stability, difficulty,
         elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, suspended)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )

    for (const draft of drafts) {
      if (!draft.front || !draft.back) {
        result.invalid++
        continue
      }
      const checksum = checksumOf(draft.front, draft.back)
      const duplicateId = byChecksum.get(checksum)
      const isDuplicate = duplicateId !== undefined || seenInBatch.has(checksum)

      if (isDuplicate && onDuplicate === 'skip') {
        result.skipped++
        continue
      }
      if (isDuplicate && onDuplicate === 'update' && duplicateId !== undefined) {
        updateNote.run(draft.hint, draft.extra, draft.tags.join(' '), duplicateId, userId)
        result.updated++
        continue
      }

      seenInBatch.add(checksum)
      const noteResult = insertNote.run(
        deck.id,
        userId,
        draft.front,
        draft.back,
        draft.hint,
        draft.extra,
        draft.tags.join(' '),
        checksum,
        now,
      )
      const noteId = Number(noteResult.lastInsertRowid)
      result.added++

      const faces: (0 | 1)[] = deck.config.generateReverse ? [0, 1] : [0]
      for (const reverse of faces) {
        const empty = emptyCardFields()
        insertCard.run(
          noteId,
          deck.id,
          userId,
          reverse,
          empty.due,
          empty.stability,
          empty.difficulty,
          empty.elapsedDays,
          empty.scheduledDays,
          empty.learningSteps,
          empty.reps,
          empty.lapses,
          empty.state,
          empty.lastReview,
          empty.suspended,
        )
        result.cardsCreated++
      }
    }
    return result
  })
}
