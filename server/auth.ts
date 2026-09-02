import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { db } from './db.ts'
import type { User } from '../shared/tipos.ts'

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

// Parametros de scrypt. N=2^15 tarda ~100ms en el servidor, suficiente para
// encarecer un ataque por fuerza bruta sin volver lento el inicio de sesion.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const KEY_LENGTH = 64

export const SESSION_COOKIE = 'fc_sesion'
export const SESSION_DAYS = 30

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts
  const expected = Buffer.from(hash!, 'base64')
  try {
    const derived = await scryptAsync(
      password.normalize('NFKC'),
      Buffer.from(salt!, 'base64'),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024 },
    )
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/**
 * El token viaja en la cookie, pero en la base se guarda solo su hash: si
 * alguien lee la tabla de sesiones no puede suplantar a nadie con lo que ve.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(userId: number, userAgent: string): string {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token), userId, now, now + SESSION_DAYS * 86400000, userAgent.slice(0, 200))
  return token
}

interface UserRow {
  id: number
  email: string
  name: string
  is_admin: number
  created_at: number
}

export function userFromToken(token: string): User | null {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.is_admin, u.created_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), Date.now()) as UserRow | undefined
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  }
}

export function destroySession(token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token))
}

export function destroyAllSessions(userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

export function purgeExpiredSessions(): number {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
  return Number(result.changes)
}

export function userCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  return row.n
}

export interface InviteRow {
  code: string
  expires_at: number
  used_by: number | null
}

/** Devuelve la invitacion si es utilizable, o el motivo por el que no lo es. */
export function checkInvite(code: string): { ok: true } | { ok: false; reason: string } {
  const row = db.prepare('SELECT code, expires_at, used_by FROM invites WHERE code = ?').get(
    code.trim().toUpperCase(),
  ) as InviteRow | undefined
  if (!row) return { ok: false, reason: 'Ese codigo de invitacion no existe' }
  if (row.used_by !== null) return { ok: false, reason: 'Ese codigo ya fue usado' }
  if (row.expires_at <= Date.now()) return { ok: false, reason: 'Ese codigo vencio' }
  return { ok: true }
}

export function createInvite(createdBy: number, note: string, days = 14): string {
  // Alfabeto sin caracteres que se confunden al dictarlos (0/O, 1/I).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(12)
  let code = ''
  for (let i = 0; i < 12; i++) {
    code += alphabet[bytes[i]! % alphabet.length]
    if (i === 3 || i === 7) code += '-'
  }
  const now = Date.now()
  db.prepare(
    'INSERT INTO invites (code, created_by, created_at, expires_at, note) VALUES (?, ?, ?, ?, ?)',
  ).run(code, createdBy, now, now + days * 86400000, note.slice(0, 120))
  return code
}

export function consumeInvite(code: string, userId: number): void {
  db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?').run(
    userId,
    Date.now(),
    code.trim().toUpperCase(),
  )
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254
}

/** Requisitos minimos de contraseña, explicados en el mensaje de error. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'La contraseña necesita al menos 10 caracteres'
  if (password.length > 200) return 'La contraseña no puede pasar de 200 caracteres'
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'La contraseña tiene que combinar letras y numeros'
  }
  return null
}
