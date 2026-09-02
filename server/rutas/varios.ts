import type { FastifyInstance } from 'fastify'
import { db, transaction } from '../db.ts'
import { requireAdmin, requireUser, tzOffset } from '../contexto.ts'
import { createInvite } from '../auth.ts'
import { createDeck, insertNotes, type DraftNote } from '../datos.ts'
import { MATURE_DAYS, localDay, normalizeConfig, type StatsResponse } from '../../shared/tipos.ts'

const DAYS_BACK = 30
const FORECAST_DAYS = 14

function dayKeys(count: number, offset: number, tz: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + offset + i)
    out.push(localDay(d, tz))
  }
  return out
}

export default async function rutasVarios(app: FastifyInstance) {
  app.get('/estadisticas', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const tz = tzOffset(request)
    const since = Date.now() - DAYS_BACK * 86400000

    const logs = db
      .prepare(
        'SELECT rating, reviewed_at, duration_ms FROM reviews WHERE user_id = ? AND reviewed_at > ?',
      )
      .all(user.id, since) as { rating: number; reviewed_at: number; duration_ms: number }[]

    const historyKeys = dayKeys(DAYS_BACK, -(DAYS_BACK - 1), tz)
    const historyCounts = new Map(historyKeys.map((day) => [day, 0]))
    let totalTime = 0
    let again = 0
    for (const log of logs) {
      const day = localDay(new Date(log.reviewed_at), tz)
      if (historyCounts.has(day)) historyCounts.set(day, historyCounts.get(day)! + 1)
      totalTime += log.duration_ms
      if (log.rating === 1) again++
    }

    const forecastKeys = dayKeys(FORECAST_DAYS, 0, tz)
    const forecastCounts = new Map(forecastKeys.map((day) => [day, 0]))
    const pending = db
      .prepare('SELECT due FROM cards WHERE user_id = ? AND suspended = 0 AND state != 0')
      .all(user.id) as { due: number }[]
    const now = Date.now()
    for (const card of pending) {
      const day = localDay(new Date(card.due), tz)
      if (forecastCounts.has(day)) forecastCounts.set(day, forecastCounts.get(day)! + 1)
      // Lo vencido se muestra como carga de hoy, que es cuando toca hacerlo.
      else if (card.due < now) forecastCounts.set(forecastKeys[0]!, forecastCounts.get(forecastKeys[0]!)! + 1)
    }

    const strengthRow = db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN suspended = 0 AND state = 0 THEN 1 ELSE 0 END)       AS new_count,
           SUM(CASE WHEN suspended = 0 AND state IN (1,3) THEN 1 ELSE 0 END)  AS learning,
           SUM(CASE WHEN suspended = 0 AND state = 2 AND scheduled_days <  ? THEN 1 ELSE 0 END) AS young,
           SUM(CASE WHEN suspended = 0 AND state = 2 AND scheduled_days >= ? THEN 1 ELSE 0 END) AS mature
         FROM cards WHERE user_id = ?`,
      )
      .get(MATURE_DAYS, MATURE_DAYS, user.id) as Record<string, number | null>

    // Racha: dias consecutivos con al menos un repaso, contando desde hoy.
    let streak = 0
    for (let i = historyKeys.length - 1; i >= 0; i--) {
      if (historyCounts.get(historyKeys[i]!)! > 0) streak++
      else if (i < historyKeys.length - 1) break
    }

    const deckCount = (
      db.prepare('SELECT COUNT(*) AS n FROM decks WHERE user_id = ?').get(user.id) as { n: number }
    ).n

    const response: StatsResponse = {
      history: historyKeys.map((day) => ({ day, count: historyCounts.get(day)! })),
      forecast: forecastKeys.map((day) => ({ day, count: forecastCounts.get(day)! })),
      strength: {
        new: strengthRow.new_count ?? 0,
        learning: strengthRow.learning ?? 0,
        young: strengthRow.young ?? 0,
        mature: strengthRow.mature ?? 0,
      },
      totalCards: strengthRow.total ?? 0,
      reviews: logs.length,
      accuracy: logs.length > 0 ? 1 - again / logs.length : null,
      totalTime,
      streak,
      deckCount,
    }
    return response
  })

  /** Respaldo completo de la cuenta, en el mismo formato que acepta el alta. */
  app.get('/respaldo', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const decks = db
      .prepare('SELECT id, name, description, config, created_at FROM decks WHERE user_id = ?')
      .all(user.id) as { id: number; name: string; description: string; config: string; created_at: number }[]

    const payload = {
      app: 'flashcards' as const,
      version: 2,
      exportedAt: new Date().toISOString(),
      decks: decks.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        config: normalizeConfig(JSON.parse(d.config)),
        createdAt: d.created_at,
      })),
      notes: db
        .prepare(
          'SELECT id, deck_id, front, back, hint, extra, tags, created_at FROM notes WHERE user_id = ?',
        )
        .all(user.id),
      cards: db.prepare('SELECT * FROM cards WHERE user_id = ?').all(user.id),
      reviews: db.prepare('SELECT * FROM reviews WHERE user_id = ?').all(user.id),
    }
    reply.header('Content-Type', 'application/json; charset=utf-8')
    reply.header(
      'Content-Disposition',
      `attachment; filename="flashcards-${payload.exportedAt.slice(0, 10)}.json"`,
    )
    return payload
  })

  /**
   * Alta masiva desde un respaldo. Sirve para restaurar y tambien para migrar
   * lo que estaba en IndexedDB: en los dos casos entra como contenido nuevo
   * de esta cuenta, con identificadores propios.
   */
  app.post<{ Body: { decks?: unknown[]; notes?: unknown[] } }>(
    '/respaldo',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return

      const rawDecks = Array.isArray(request.body?.decks) ? request.body.decks : []
      const rawNotes = Array.isArray(request.body?.notes) ? request.body.notes : []
      if (rawDecks.length === 0) {
        return reply.code(400).send({ error: 'El respaldo no trae ningun mazo' })
      }
      if (rawDecks.length > 500 || rawNotes.length > 100000) {
        return reply.code(413).send({ error: 'El respaldo es demasiado grande' })
      }

      // Se agrupan las notas por el id de mazo que traia el archivo original.
      const notesByOldDeck = new Map<number, DraftNote[]>()
      for (const raw of rawNotes as Record<string, unknown>[]) {
        const oldDeckId = Number(raw.deckId ?? raw.deck_id)
        const draft: DraftNote = {
          front: String(raw.front ?? '').slice(0, 5000),
          back: String(raw.back ?? '').slice(0, 5000),
          hint: String(raw.hint ?? '').slice(0, 2000),
          extra: String(raw.extra ?? '').slice(0, 5000),
          tags: Array.isArray(raw.tags)
            ? raw.tags.map((t) => String(t)).slice(0, 30)
            : String(raw.tags ?? '').split(' ').filter(Boolean).slice(0, 30),
        }
        if (!draft.front || !draft.back) continue
        const list = notesByOldDeck.get(oldDeckId)
        if (list) list.push(draft)
        else notesByOldDeck.set(oldDeckId, [draft])
      }

      const summary = transaction(() => {
        let decksCreated = 0
        let notesCreated = 0
        let cardsCreated = 0
        for (const raw of rawDecks as Record<string, unknown>[]) {
          const oldId = Number(raw.id)
          const name = String(raw.name ?? '').trim() || 'Mazo importado'
          const deck = createDeck(
            user.id,
            name,
            String(raw.description ?? ''),
            normalizeConfig(raw.config),
          )
          decksCreated++
          const drafts = notesByOldDeck.get(oldId) ?? []
          if (drafts.length > 0) {
            const result = insertNotes(user.id, deck, drafts, 'skip')
            notesCreated += result.added
            cardsCreated += result.cardsCreated
          }
        }
        return { decks: decksCreated, notes: notesCreated, cards: cardsCreated }
      })

      return summary
    },
  )

  app.get('/invitaciones', async (request, reply) => {
    const user = requireAdmin(request, reply)
    if (!user) return
    const rows = db
      .prepare(
        `SELECT i.code, i.created_at, i.expires_at, i.used_at, i.note, u.email AS used_by
         FROM invites i LEFT JOIN users u ON u.id = i.used_by
         WHERE i.created_by = ? ORDER BY i.created_at DESC LIMIT 100`,
      )
      .all(user.id) as {
      code: string
      created_at: number
      expires_at: number
      used_at: number | null
      note: string
      used_by: string | null
    }[]
    return {
      invites: rows.map((r) => ({
        code: r.code,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        usedAt: r.used_at,
        usedBy: r.used_by,
        note: r.note,
      })),
    }
  })

  app.post<{ Body: { note?: string; days?: number } }>('/invitaciones', async (request, reply) => {
    const user = requireAdmin(request, reply)
    if (!user) return
    const days = Math.min(365, Math.max(1, Number(request.body?.days) || 14))
    const code = createInvite(user.id, String(request.body?.note ?? ''), days)
    return reply.code(201).send({ code })
  })

  app.delete<{ Params: { code: string } }>('/invitaciones/:code', async (request, reply) => {
    const user = requireAdmin(request, reply)
    if (!user) return
    const result = db
      .prepare('DELETE FROM invites WHERE code = ? AND created_by = ? AND used_by IS NULL')
      .run(request.params.code, user.id)
    if (Number(result.changes) === 0) {
      return reply.code(404).send({ error: 'Ese codigo no existe o ya fue usado' })
    }
    return { ok: true }
  })
}
