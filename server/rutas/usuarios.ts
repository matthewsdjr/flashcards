import type { FastifyInstance } from 'fastify'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { db, queryAll, queryOne, UPLOADS_DIR } from '../db.ts'
import { requireAdmin } from '../contexto.ts'
import { destroyAllSessions } from '../auth.ts'
import type { AdminUser } from '../../shared/tipos.ts'

interface UserRow {
  id: number
  email: string
  name: string
  is_admin: number
  created_at: number
  deck_count: number
  card_count: number
  review_count: number
  last_activity: number | null
  sessions: number
}

function toAdminUser(row: UserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    deckCount: row.deck_count,
    cardCount: row.card_count,
    reviewCount: row.review_count,
    lastActivity: row.last_activity,
    sessions: row.sessions,
  }
}

function adminCount(): number {
  return queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1')!.n
}

export default async function rutasUsuarios(app: FastifyInstance) {
  app.get('/', async (request, reply) => {
    const admin = requireAdmin(request, reply)
    if (!admin) return

    const rows = queryAll<UserRow>(
      `SELECT u.id, u.email, u.name, u.is_admin, u.created_at,
              (SELECT COUNT(*) FROM decks   d WHERE d.user_id = u.id) AS deck_count,
              (SELECT COUNT(*) FROM cards   c WHERE c.user_id = u.id) AS card_count,
              (SELECT COUNT(*) FROM reviews r WHERE r.user_id = u.id) AS review_count,
              (SELECT MAX(reviewed_at) FROM reviews r WHERE r.user_id = u.id) AS last_activity,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?)
                AS sessions
       FROM users u ORDER BY u.created_at ASC`,
      Date.now(),
    )
    return { users: rows.map(toAdminUser) }
  })

  /** Deja fuera a esa cuenta de todos sus dispositivos. */
  app.post<{ Params: { id: string } }>('/:id/cerrar-sesiones', async (request, reply) => {
    const admin = requireAdmin(request, reply)
    if (!admin) return

    const id = Number(request.params.id)
    const objetivo = queryOne<{ id: number }>('SELECT id FROM users WHERE id = ?', id)
    if (!objetivo) return reply.code(404).send({ error: 'Esa cuenta no existe' })

    destroyAllSessions(id)
    request.log.info({ actor: admin.id, objetivo: id }, 'sesiones cerradas por un administrador')
    // Cerrar las propias sesiones incluye la actual: el cliente vuelve al login.
    return { ok: true, esPropia: id === admin.id }
  })

  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const admin = requireAdmin(request, reply)
    if (!admin) return

    const id = Number(request.params.id)
    // Borrarse a si mismo dejaria el servidor sin quien administre y sin forma
    // de recuperarlo desde la interfaz.
    if (id === admin.id) {
      return reply.code(400).send({ error: 'No podes borrar tu propia cuenta desde aca' })
    }

    const objetivo = queryOne<{ id: number; is_admin: number; email: string }>(
      'SELECT id, is_admin, email FROM users WHERE id = ?',
      id,
    )
    if (!objetivo) return reply.code(404).send({ error: 'Esa cuenta no existe' })
    if (objetivo.is_admin === 1 && adminCount() <= 1) {
      return reply.code(400).send({ error: 'Es la unica cuenta administradora del servidor' })
    }

    // Las filas caen por ON DELETE CASCADE, pero los archivos subidos viven en
    // disco: hay que leer sus rutas antes de borrar y limpiarlos despues.
    const archivos = queryAll<{ path: string }>(
      'SELECT path FROM imports WHERE user_id = ?',
      id,
    )
    db.prepare('DELETE FROM users WHERE id = ?').run(id)
    for (const archivo of archivos) {
      await unlink(join(UPLOADS_DIR, archivo.path)).catch(() => {})
    }
    request.log.warn({ actor: admin.id, objetivo: id }, 'cuenta eliminada por un administrador')
    return { ok: true }
  })
}
