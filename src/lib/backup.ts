import { db, type Card, type DayCount, type Deck, type Note, type ReviewLog } from '../db/schema'

const BACKUP_VERSION = 1

export interface Backup {
  app: 'flashcards'
  version: number
  exportedAt: string
  decks: Deck[]
  notes: Note[]
  cards: Card[]
  revlog: ReviewLog[]
  dayCounts: DayCount[]
}

export async function exportBackup(): Promise<Backup> {
  const [decks, notes, cards, revlog, dayCounts] = await Promise.all([
    db.decks.toArray(),
    db.notes.toArray(),
    db.cards.toArray(),
    db.revlog.toArray(),
    db.dayCounts.toArray(),
  ])
  return {
    app: 'flashcards',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    decks,
    notes,
    cards,
    revlog,
    dayCounts,
  }
}

export function downloadBackup(backup: Backup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `flashcards-${backup.exportedAt.slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/** Exporta un mazo como TSV, en el mismo formato que acepta el importador. */
export async function exportDeckTsv(deckId: number): Promise<string> {
  const notes = await db.notes.where('deckId').equals(deckId).toArray()
  const escape = (value: string) => value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
  const header = ['Front', 'Back', 'Hint', 'Extra', 'Tags'].join('\t')
  const body = notes.map((n) =>
    [n.front, n.back, n.hint, n.extra, n.tags.join(' ')].map(escape).join('\t'),
  )
  return [header, ...body].join('\n')
}

export function downloadText(filename: string, text: string, mime = 'text/tab-separated-values') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export interface RestoreResult {
  decks: number
  notes: number
  cards: number
}

/**
 * Restaura un respaldo. Reasigna todos los ids para que el contenido se sume
 * al existente en lugar de pisarlo, salvo que se pida reemplazar todo.
 */
export async function restoreBackup(raw: unknown, replace: boolean): Promise<RestoreResult> {
  const backup = raw as Backup
  if (!backup || backup.app !== 'flashcards' || !Array.isArray(backup.decks)) {
    throw new Error('El archivo no es un respaldo valido de Flashcards')
  }
  if (backup.version > BACKUP_VERSION) {
    throw new Error('El respaldo fue creado con una version mas nueva de la app')
  }

  return db.transaction(
    'rw',
    db.decks,
    db.notes,
    db.cards,
    db.revlog,
    db.dayCounts,
    async () => {
      if (replace) {
        await Promise.all([
          db.decks.clear(),
          db.notes.clear(),
          db.cards.clear(),
          db.revlog.clear(),
          db.dayCounts.clear(),
        ])
      }

      const deckIdMap = new Map<number, number>()
      for (const deck of backup.decks) {
        const oldId = deck.id!
        const newId = await db.decks.add({ ...deck, id: undefined })
        deckIdMap.set(oldId, newId)
      }

      const noteIdMap = new Map<number, number>()
      for (const note of backup.notes) {
        const deckId = deckIdMap.get(note.deckId)
        if (!deckId) continue
        const newId = await db.notes.add({ ...note, id: undefined, deckId })
        noteIdMap.set(note.id!, newId)
      }

      const cardIdMap = new Map<number, number>()
      for (const card of backup.cards) {
        const deckId = deckIdMap.get(card.deckId)
        const noteId = noteIdMap.get(card.noteId)
        if (!deckId || !noteId) continue
        const newId = await db.cards.add({ ...card, id: undefined, deckId, noteId })
        cardIdMap.set(card.id!, newId)
      }

      for (const log of backup.revlog ?? []) {
        const deckId = deckIdMap.get(log.deckId)
        const cardId = cardIdMap.get(log.cardId)
        if (!deckId || !cardId) continue
        await db.revlog.add({ ...log, id: undefined, deckId, cardId })
      }

      for (const count of backup.dayCounts ?? []) {
        const deckId = deckIdMap.get(count.deckId)
        if (!deckId) continue
        await db.dayCounts.add({ ...count, id: undefined, deckId })
      }

      return {
        decks: deckIdMap.size,
        notes: noteIdMap.size,
        cards: cardIdMap.size,
      }
    },
  )
}
