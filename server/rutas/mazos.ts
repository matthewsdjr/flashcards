import type { FastifyInstance } from 'fastify'
import { parseIds, requireUser, tzOffset } from '../contexto.ts'
import {
  answerCard,
  buildQueue,
  createDeck,
  deckStats,
  deleteDeck,
  deleteNote,
  getCard,
  getDeck,
  listDecks,
  notesOfDeck,
  resetCards,
  setSuspended,
  updateDeck,
} from '../datos.ts'
import { db } from '../db.ts'
import { isGrade } from '../../shared/fsrs.ts'
import type { DeckWithStats } from '../../shared/tipos.ts'

export default async function rutasMazos(app: FastifyInstance) {
  app.get('/', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const tz = tzOffset(request)
    const decks: DeckWithStats[] = listDecks(user.id).map((deck) => ({
      ...deck,
      stats: deckStats(user.id, deck, tz),
    }))
    return { decks }
  })

  app.post<{ Body: { name?: string; description?: string; config?: unknown } }>(
    '/',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const name = String(request.body?.name ?? '').trim()
      if (!name) return reply.code(400).send({ error: 'El mazo necesita un nombre' })
      const deck = createDeck(
        user.id,
        name,
        String(request.body?.description ?? ''),
        (request.body?.config ?? {}) as Record<string, unknown>,
      )
      return reply.code(201).send({ deck })
    },
  )

  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const deck = getDeck(user.id, Number(request.params.id))
    if (!deck) return reply.code(404).send({ error: 'Ese mazo no existe' })
    return {
      deck,
      stats: deckStats(user.id, deck, tzOffset(request)),
      notes: notesOfDeck(user.id, deck.id),
    }
  })

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/:id',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const deck = updateDeck(user.id, Number(request.params.id), {
        name: request.body?.name as string | undefined,
        description: request.body?.description as string | undefined,
        config: request.body?.config,
      })
      if (!deck) return reply.code(404).send({ error: 'Ese mazo no existe' })
      return { deck }
    },
  )

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (!deleteDeck(user.id, Number(request.params.id))) {
      return reply.code(404).send({ error: 'Ese mazo no existe' })
    }
    return { ok: true }
  })

  app.get<{ Params: { id: string } }>('/:id/cola', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const deck = getDeck(user.id, Number(request.params.id))
    if (!deck) return reply.code(404).send({ error: 'Ese mazo no existe' })
    return { deck, queue: buildQueue(user.id, deck, tzOffset(request)) }
  })

  app.get<{ Params: { id: string } }>('/:id/exportar', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    const deck = getDeck(user.id, Number(request.params.id))
    if (!deck) return reply.code(404).send({ error: 'Ese mazo no existe' })

    const escape = (value: string) => value.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
    const lines = ['Front\tBack\tHint\tExtra\tTags']
    for (const { note } of notesOfDeck(user.id, deck.id)) {
      lines.push(
        [note.front, note.back, note.hint, note.extra, note.tags.join(' ')].map(escape).join('\t'),
      )
    }
    const filename = `${deck.name.replace(/[^\w\s-]/g, '').trim() || 'mazo'}.tsv`
    reply.header('Content-Type', 'text/tab-separated-values; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename="${filename}"`)
    return lines.join('\n')
  })

  app.post<{ Params: { id: string }; Body: { grade?: number; durationMs?: number } }>(
    '/tarjetas/:id/responder',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return

      const grade = Number(request.body?.grade)
      if (!isGrade(grade)) return reply.code(400).send({ error: 'Calificacion invalida' })

      const card = getCard(user.id, Number(request.params.id))
      if (!card) return reply.code(404).send({ error: 'Esa tarjeta no existe' })

      const deck = getDeck(user.id, card.deckId)
      if (!deck) return reply.code(404).send({ error: 'Ese mazo no existe' })

      const updated = answerCard(
        user.id,
        card,
        deck.config,
        grade,
        Number(request.body?.durationMs ?? 0),
        tzOffset(request),
      )
      return { card: updated }
    },
  )

  app.post<{ Body: { ids?: unknown } }>('/tarjetas/reiniciar', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    return { changed: resetCards(user.id, parseIds(request.body?.ids)) }
  })

  app.post<{ Body: { ids?: unknown; suspended?: boolean } }>(
    '/tarjetas/suspender',
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return
      const changed = setSuspended(
        user.id,
        parseIds(request.body?.ids),
        Boolean(request.body?.suspended),
      )
      return { changed }
    },
  )

  app.delete<{ Params: { id: string } }>('/notas/:id', async (request, reply) => {
    const user = requireUser(request, reply)
    if (!user) return
    if (!deleteNote(user.id, Number(request.params.id))) {
      return reply.code(404).send({ error: 'Esa nota no existe' })
    }
    return { ok: true }
  })

  /** Comprobacion barata que usa el healthcheck del contenedor. */
  app.get('/_ping', async () => {
    db.prepare('SELECT 1').get()
    return { ok: true }
  })
}
