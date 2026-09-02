import { checksumOf, db, type Note } from '../db/schema'
import { newCard } from './scheduler'
import { splitTags, type FieldRole } from './parse'

export interface ImportOptions {
  deckId: number
  rows: string[][]
  mapping: FieldRole[]
  /** Que hacer con filas cuyo contenido ya existe en el mazo. */
  onDuplicate: 'skip' | 'update' | 'add'
  /** Etiquetas aplicadas a todas las notas importadas. */
  extraTags: string[]
}

export interface ImportResult {
  added: number
  updated: number
  skipped: number
  invalid: number
  cardsCreated: number
}

interface DraftNote {
  front: string
  back: string
  hint: string
  extra: string
  tags: string[]
}

/** Convierte una fila cruda en una nota usando el mapeo de columnas elegido. */
export function rowToNote(row: string[], mapping: FieldRole[], extraTags: string[]): DraftNote {
  const parts: Record<Exclude<FieldRole, 'ignore' | 'tags'>, string[]> = {
    front: [],
    back: [],
    hint: [],
    extra: [],
  }
  const tags = [...extraTags]

  mapping.forEach((role, index) => {
    const value = (row[index] ?? '').trim()
    if (!value || role === 'ignore') return
    if (role === 'tags') tags.push(...splitTags(value))
    else parts[role].push(value)
  })

  return {
    // Varias columnas con el mismo rol se concatenan en lugar de perderse.
    front: parts.front.join('\n'),
    back: parts.back.join('\n'),
    hint: parts.hint.join('\n'),
    extra: parts.extra.join('\n'),
    tags: Array.from(new Set(tags)),
  }
}

export async function importRows(options: ImportOptions): Promise<ImportResult> {
  const { deckId, rows, mapping, onDuplicate, extraTags } = options
  const deck = await db.decks.get(deckId)
  if (!deck) throw new Error('El mazo ya no existe')

  const result: ImportResult = { added: 0, updated: 0, skipped: 0, invalid: 0, cardsCreated: 0 }
  const now = Date.now()

  const existing = await db.notes.where('deckId').equals(deckId).toArray()
  const byChecksum = new Map(existing.map((n) => [n.checksum, n]))
  const seenInBatch = new Set<string>()

  const toInsert: Note[] = []
  const toUpdate: { id: number; changes: Partial<Note> }[] = []

  for (const row of rows) {
    const draft = rowToNote(row, mapping, extraTags)
    // Una tarjeta sin frente o sin reverso no es estudiable.
    if (!draft.front || !draft.back) {
      result.invalid++
      continue
    }

    const checksum = checksumOf(draft.front, draft.back)
    const duplicate = byChecksum.get(checksum) ?? (seenInBatch.has(checksum) ? true : undefined)

    if (duplicate && onDuplicate === 'skip') {
      result.skipped++
      continue
    }
    if (duplicate && onDuplicate === 'update' && typeof duplicate === 'object') {
      toUpdate.push({
        id: duplicate.id!,
        changes: { hint: draft.hint, extra: draft.extra, tags: draft.tags },
      })
      result.updated++
      continue
    }

    seenInBatch.add(checksum)
    toInsert.push({ deckId, ...draft, createdAt: now, checksum })
  }

  await db.transaction('rw', db.notes, db.cards, async () => {
    for (const update of toUpdate) {
      await db.notes.update(update.id, update.changes)
    }
    if (toInsert.length > 0) {
      const ids = await db.notes.bulkAdd(toInsert, { allKeys: true })
      const cards = ids.flatMap((noteId) => {
        const base = [newCard(noteId as number, deckId, 0)]
        if (deck.config.generateReverse) base.push(newCard(noteId as number, deckId, 1))
        return base
      })
      await db.cards.bulkAdd(cards)
      result.added = ids.length
      result.cardsCreated = cards.length
    }
  })

  return result
}
