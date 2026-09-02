import type { FastifyInstance } from 'fastify'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { unlink, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { db, queryAll, queryOne, UPLOADS_DIR } from '../db.ts'
import { requireUser } from '../contexto.ts'
import { createDeck, getDeck, insertNotes, type DraftNote } from '../datos.ts'
import { parseDelimited, splitTags, type FieldRole } from '../../shared/parse.ts'
import type { ImportRecord } from '../../shared/tipos.ts'

const ROLES: FieldRole[] = ['front', 'back', 'hint', 'extra', 'tags', 'ignore']
const MAX_BYTES = 10 * 1024 * 1024
const EXTENSIONS = new Set(['.tsv', '.csv', '.txt', ''])

/** Convierte una fila cruda en una nota segun el mapeo de columnas elegido. */
export function rowToNote(row: string[], mapping: FieldRole[], extraTags: string[]): DraftNote {
  const parts: Record<'front' | 'back' | 'hint' | 'extra', string[]> = {
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
    // Varias columnas con el mismo rol se concatenan en lugar de perderse.
    else parts[role].push(value)
  })

  return {
    front: parts.front.join('\n').slice(0, 5000),
    back: parts.back.join('\n').slice(0, 5000),
    hint: parts.hint.join('\n').slice(0, 2000),
    extra: parts.extra.join('\n').slice(0, 5000),
    tags: [...new Set(tags)].slice(0, 30),
  }
}

function sanitizeMapping(raw: unknown, width: number): FieldRole[] {
  const list = Array.isArray(raw) ? raw : []
  const out: FieldRole[] = []
  for (let i = 0; i < width; i++) {
    const value = list[i]
    out.push(ROLES.includes(value as FieldRole) ? (value as FieldRole) : 'ignore')
  }
  return out
}

interface ImportRow {
  id: number
  deck_id: number | null
  deck_name: string | null
  filename: string
  bytes: number
  delimiter: string
  rows: number
  added: number
  updated: number
  skipped: number
  invalid: number
  created_at: number
}

function toRecord(row: ImportRow): ImportRecord {
  return {
    id: row.id,
    deckId: row.deck_id,
    deckName: row.deck_name,
    filename: row.filename,
    bytes: row.bytes,
    delimiter: row.delimiter,
    rows: row.rows,
    added: row.added,
    updated: row.updated,
    skipped: row.skipped,
    invalid: row.invalid,
    createdAt: row.created_at,
  }
}

export default async function rutasImportar(app: FastifyInstance) {
  /**
   * Paso 1: se sube el archivo y el servidor devuelve su estructura para que
   * el usuario confirme el mapeo. Todavia no se crea ninguna tarjeta.
   */
  app.post('/analizar', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return

    const file = await request.file({ limits: { fileSize: MAX_BYTES } })
    if (!file) return reply.code(400).send({ error: 'No llego ningun archivo' })

    const extension = extname(file.filename).toLowerCase()
    if (!EXTENSIONS.has(extension)) {
      return reply.code(400).send({ error: 'Solo se aceptan archivos .tsv, .csv o .txt' })
    }

    let buffer: Buffer
    try {
      buffer = await file.toBuffer()
    } catch {
      return reply.code(413).send({ error: 'El archivo pasa de 10 MB' })
    }

    const text = buffer.toString('utf8')
    const parsed = parseDelimited(text)
    if (parsed.rows.length === 0) {
      return reply.code(400).send({ error: 'Ese archivo no tiene filas con datos' })
    }

    // El archivo queda guardado con un nombre generado: el original nunca
    // toca el sistema de archivos, asi que no hay riesgo de path traversal.
    const stored = `${randomUUID()}${extension || '.tsv'}`
    await writeFile(join(UPLOADS_DIR, stored), buffer, { mode: 0o600 })

    const token = createHash('sha256').update(stored).digest('hex').slice(0, 16)
    db.prepare(
      `INSERT INTO imports (user_id, deck_id, filename, bytes, path, delimiter, rows, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      user.id,
      file.filename.slice(0, 200),
      buffer.byteLength,
      stored,
      parsed.delimiter,
      parsed.rows.length,
      Date.now(),
    )
    const importId = Number(queryOne<{ id: number }>('SELECT last_insert_rowid() AS id')!.id)

    return {
      importId,
      token,
      filename: file.filename,
      bytes: buffer.byteLength,
      headers: parsed.headers,
      hasHeader: parsed.hasHeader,
      delimiter: parsed.delimiter,
      skipped: parsed.skipped,
      errors: parsed.errors,
      // Solo una muestra: el archivo completo ya esta guardado en el servidor.
      sample: parsed.rows.slice(0, 8),
      totalRows: parsed.rows.length,
    }
  })

  /** Paso 2: se confirma el mapeo y el servidor crea las tarjetas. */
  app.post<{
    Body: {
      importId?: number
      deckId?: number | null
      newDeckName?: string
      mapping?: unknown
      onDuplicate?: string
      tags?: string
      generateReverse?: boolean
    }
  }>('/confirmar', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return

    const importId = Number(request.body?.importId)
    const record = queryOne<{ id: number; path: string; filename: string; delimiter: string }>(
      'SELECT id, path, filename, delimiter FROM imports WHERE id = ? AND user_id = ?',
      importId,
      user.id,
    )
    if (!record) return reply.code(404).send({ error: 'Esa importacion no existe' })

    const text = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      createReadStream(join(UPLOADS_DIR, record.path))
        .on('data', (c) => chunks.push(c as Buffer))
        .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        .on('error', reject)
    }).catch(() => null)

    if (text === null) {
      return reply.code(410).send({ error: 'El archivo subido ya no esta disponible' })
    }

    const parsed = parseDelimited(text)
    const mapping = sanitizeMapping(request.body?.mapping, parsed.headers.length)
    if (!mapping.includes('front') || !mapping.includes('back')) {
      return reply.code(400).send({ error: 'Falta asignar el frente o el reverso' })
    }

    const generateReverse = Boolean(request.body?.generateReverse)
    let deck = request.body?.deckId ? getDeck(user.id, Number(request.body.deckId)) : null
    if (request.body?.deckId && !deck) {
      return reply.code(404).send({ error: 'Ese mazo no existe' })
    }
    if (!deck) {
      const name = String(request.body?.newDeckName ?? '').trim()
      if (!name) return reply.code(400).send({ error: 'El mazo nuevo necesita un nombre' })
      deck = createDeck(user.id, name, `Importado de ${record.filename}`, { generateReverse })
    } else {
      deck = { ...deck, config: { ...deck.config, generateReverse } }
      db.prepare('UPDATE decks SET config = ? WHERE id = ? AND user_id = ?').run(
        JSON.stringify(deck.config),
        deck.id,
        user.id,
      )
    }

    const onDuplicate = (['skip', 'update', 'add'] as const).includes(
      request.body?.onDuplicate as 'skip',
    )
      ? (request.body!.onDuplicate as 'skip' | 'update' | 'add')
      : 'skip'
    const extraTags = splitTags(String(request.body?.tags ?? '')).slice(0, 10)

    const drafts = parsed.rows.map((row) => rowToNote(row, mapping, extraTags))
    const result = insertNotes(user.id, deck, drafts, onDuplicate)

    db.prepare(
      `UPDATE imports SET deck_id = ?, mapping = ?, added = ?, updated = ?, skipped = ?, invalid = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      deck.id,
      JSON.stringify(mapping),
      result.added,
      result.updated,
      result.skipped,
      result.invalid,
      record.id,
      user.id,
    )

    return { ...result, deckId: deck.id, deckName: deck.name }
  })

  /** Historial de importaciones del usuario, con el archivo original. */
  app.get('/', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const rows = queryAll<ImportRow>(
      `SELECT i.id, i.deck_id, d.name AS deck_name, i.filename, i.bytes, i.delimiter,
              i.rows, i.added, i.updated, i.skipped, i.invalid, i.created_at
       FROM imports i LEFT JOIN decks d ON d.id = i.deck_id
       WHERE i.user_id = ? ORDER BY i.created_at DESC LIMIT 100`,
      user.id,
    )
    return { imports: rows.map(toRecord) }
  })

  app.get<{ Params: { id: string } }>('/:id/archivo', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const row = queryOne<{ filename: string; path: string }>(
      'SELECT filename, path FROM imports WHERE id = ? AND user_id = ?',
      Number(request.params.id),
      user.id,
    )
    if (!row) return reply.code(404).send({ error: 'Ese archivo no existe' })

    // `path` es un UUID generado por el servidor, nunca la ruta que mando nadie.
    const safe = row.filename.replace(/["\\\r\n]/g, '_')
    reply.header('Content-Type', 'text/plain; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${safe}"`)
    return reply.send(createReadStream(join(UPLOADS_DIR, row.path)))
  })

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const row = queryOne<{ path: string }>(
      'SELECT path FROM imports WHERE id = ? AND user_id = ?',
      Number(request.params.id),
      user.id,
    )
    if (!row) return reply.code(404).send({ error: 'Esa importacion no existe' })

    db.prepare('DELETE FROM imports WHERE id = ? AND user_id = ?').run(
      Number(request.params.id),
      user.id,
    )
    // Borrar el registro y el archivo; las tarjetas ya creadas no se tocan.
    await unlink(join(UPLOADS_DIR, row.path)).catch(() => {})
    return { ok: true }
  })
}
