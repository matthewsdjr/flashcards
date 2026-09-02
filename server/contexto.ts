import type { FastifyReply, FastifyRequest } from 'fastify'
import { SESSION_COOKIE, SESSION_DAYS, userFromToken } from './auth.ts'
import type { User } from '../shared/tipos.ts'

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: User
  }
}

/** Detras de un proxy con TLS la cookie tiene que viajar como Secure. */
export function isSecure(request: FastifyRequest): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true
  if (process.env.COOKIE_SECURE === 'false') return false
  return request.protocol === 'https' || request.headers['x-forwarded-proto'] === 'https'
}

export function cookieOptions(request: FastifyRequest) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isSecure(request),
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  }
}

/** Resuelve el usuario de la cookie. No corta la petición si no hay sesión. */
export function loadUser(request: FastifyRequest): User | undefined {
  const token = request.cookies[SESSION_COOKIE]
  if (!token) return undefined
  const user = userFromToken(token)
  return user ?? undefined
}

/**
 * Devuelve el usuario o responde 401. El llamador debe cortar con `return`
 * cuando esto devuelve null.
 */
export function requireUser(request: FastifyRequest, reply: FastifyReply): User | null {
  if (request.usuario) return request.usuario
  reply.code(401).send({ error: 'Necesitas iniciar sesion' })
  return null
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply): User | null {
  const user = requireUser(request, reply)
  if (!user) return null
  if (!user.isAdmin) {
    reply.code(403).send({ error: 'Necesitas permisos de administrador' })
    return null
  }
  return user
}

/**
 * Minutos de desfase horario del cliente (Date.getTimezoneOffset()).
 * Con esto el servidor calcula los limites diarios en el dia del usuario y no
 * en UTC, que es lo que hace que "20 nuevas por dia" se sienta correcto.
 */
export function tzOffset(request: FastifyRequest): number {
  const raw = Number((request.query as { tz?: string } | undefined)?.tz ?? request.headers['x-tz'])
  if (!Number.isFinite(raw) || Math.abs(raw) > 900) return 0
  return Math.round(raw)
}

export function parseIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 5000)
}
