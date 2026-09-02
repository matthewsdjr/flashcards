import type { FastifyInstance } from 'fastify'
import { db } from '../db.ts'
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  checkInvite,
  consumeInvite,
  createSession,
  destroyAllSessions,
  destroySession,
  hashPassword,
  isValidEmail,
  passwordProblem,
  userCount,
  verifyPassword,
} from '../auth.ts'
import { cookieOptions, requireUser } from '../contexto.ts'

interface LoginBody {
  email?: string
  password?: string
}

interface RegisterBody extends LoginBody {
  name?: string
  invite?: string
}

export default async function rutasAuth(app: FastifyInstance) {
  // El registro y el inicio de sesion son los unicos puntos que aceptan
  // credenciales, asi que llevan un limite de intentos mas estricto.
  await app.register(async (limited) => {
    limited.setNotFoundHandler({ preHandler: limited.rateLimit() }, (_req, reply) => {
      reply.code(404).send({ error: 'No encontrado' })
    })

    limited.post<{ Body: LoginBody }>(
      '/entrar',
      { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
      async (request, reply) => {
        const email = String(request.body?.email ?? '').trim()
        const password = String(request.body?.password ?? '')

        const row = db
          .prepare('SELECT id, password_hash FROM users WHERE email = ?')
          .get(email) as { id: number; password_hash: string } | undefined

        // Se verifica siempre contra un hash, exista o no el usuario, para que
        // el tiempo de respuesta no revele si el email esta registrado.
        const stored = row?.password_hash ?? DUMMY_HASH
        const ok = await verifyPassword(password, stored)

        if (!row || !ok) {
          request.log.warn({ email }, 'intento de inicio de sesion fallido')
          return reply.code(401).send({ error: 'Email o contraseña incorrectos' })
        }

        const token = createSession(row.id, request.headers['user-agent'] ?? '')
        reply.setCookie(SESSION_COOKIE, token, cookieOptions(request))
        return { ok: true }
      },
    )

    limited.post<{ Body: RegisterBody }>(
      '/registro',
      { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
      async (request, reply) => {
        const email = String(request.body?.email ?? '').trim()
        const name = String(request.body?.name ?? '').trim()
        const password = String(request.body?.password ?? '')
        const invite = String(request.body?.invite ?? '').trim()

        if (!isValidEmail(email)) {
          return reply.code(400).send({ error: 'Ese email no parece valido' })
        }
        if (name.length < 2 || name.length > 80) {
          return reply.code(400).send({ error: 'El nombre necesita entre 2 y 80 caracteres' })
        }
        const problem = passwordProblem(password)
        if (problem) return reply.code(400).send({ error: problem })

        // La primera cuenta no necesita invitacion y queda como administradora:
        // es la unica forma de arrancar un servidor recien instalado.
        const isFirst = userCount() === 0
        if (!isFirst) {
          const check = checkInvite(invite)
          if (!check.ok) return reply.code(400).send({ error: check.reason })
        }

        const taken = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
        if (taken) return reply.code(409).send({ error: 'Ya existe una cuenta con ese email' })

        const hash = await hashPassword(password)
        const result = db
          .prepare(
            'INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)',
          )
          .run(email, name, hash, isFirst ? 1 : 0, Date.now())
        const userId = Number(result.lastInsertRowid)

        if (!isFirst) consumeInvite(invite, userId)

        const token = createSession(userId, request.headers['user-agent'] ?? '')
        reply.setCookie(SESSION_COOKIE, token, cookieOptions(request))
        return reply.code(201).send({ ok: true, isAdmin: isFirst })
      },
    )
  })

  /**
   * Estado de la sesion. Siempre responde 200: "no hay nadie" es una respuesta
   * valida, no un error, y asi el arranque de la app no ensucia la consola con
   * un 401 esperado.
   */
  app.get('/yo', async (request) => ({
    user: request.usuario ?? null,
    necesitaPrimeraCuenta: request.usuario ? false : userCount() === 0,
  }))

  app.post('/salir', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE]
    if (token) destroySession(token)
    reply.clearCookie(SESSION_COOKIE, { ...cookieOptions(request), maxAge: undefined })
    return { ok: true }
  })

  app.post<{ Body: { password?: string; newPassword?: string } }>(
    '/contrasena',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const user = requireUser(request, reply)
      if (!user) return

      const current = String(request.body?.password ?? '')
      const next = String(request.body?.newPassword ?? '')

      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id) as
        | { password_hash: string }
        | undefined
      if (!row || !(await verifyPassword(current, row.password_hash))) {
        return reply.code(401).send({ error: 'La contraseña actual no coincide' })
      }
      const problem = passwordProblem(next)
      if (problem) return reply.code(400).send({ error: problem })

      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        await hashPassword(next),
        user.id,
      )
      // Cambiar la contraseña cierra el resto de las sesiones abiertas.
      destroyAllSessions(user.id)
      const token = createSession(user.id, request.headers['user-agent'] ?? '')
      reply.setCookie(SESSION_COOKIE, token, cookieOptions(request))
      return { ok: true }
    },
  )

  app.log.info(`sesiones validas por ${SESSION_DAYS} dias`)
}

/**
 * Hash descartable con el formato real, para gastar el mismo tiempo de scrypt
 * cuando el email no existe. El valor no corresponde a ninguna contraseña util.
 */
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  Buffer.alloc(64, 7).toString('base64')
