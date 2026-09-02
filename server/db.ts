import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * SQLite nativo de Node 24: sin dependencias compiladas.
 * Toda fila de contenido lleva user_id y toda consulta filtra por el,
 * de modo que el aislamiento entre cuentas no depende de recordar un JOIN.
 */

export const DATA_DIR = resolve(process.env.DATA_DIR ?? './datos')
export const UPLOADS_DIR = resolve(DATA_DIR, 'archivos')
const DB_PATH = resolve(DATA_DIR, 'flashcards.db')

mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(UPLOADS_DIR, { recursive: true })

export const db = new DatabaseSync(DB_PATH)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA synchronous = NORMAL;
`)

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: '001-inicial',
    sql: `
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        name          TEXT    NOT NULL,
        password_hash TEXT    NOT NULL,
        is_admin      INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id         TEXT    PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        user_agent TEXT    NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE invites (
        code       TEXT    PRIMARY KEY,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
        used_at    INTEGER,
        note       TEXT    NOT NULL DEFAULT ''
      );

      CREATE TABLE decks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT    NOT NULL,
        description TEXT    NOT NULL DEFAULT '',
        config      TEXT    NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX idx_decks_user ON decks(user_id, created_at DESC);

      CREATE TABLE notes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_id    INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        front      TEXT    NOT NULL,
        back       TEXT    NOT NULL,
        hint       TEXT    NOT NULL DEFAULT '',
        extra      TEXT    NOT NULL DEFAULT '',
        tags       TEXT    NOT NULL DEFAULT '',
        checksum   TEXT    NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_notes_deck ON notes(deck_id);
      CREATE INDEX idx_notes_checksum ON notes(deck_id, checksum);

      CREATE TABLE cards (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id        INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        deck_id        INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reverse        INTEGER NOT NULL DEFAULT 0,
        due            INTEGER NOT NULL,
        stability      REAL    NOT NULL DEFAULT 0,
        difficulty     REAL    NOT NULL DEFAULT 0,
        elapsed_days   INTEGER NOT NULL DEFAULT 0,
        scheduled_days INTEGER NOT NULL DEFAULT 0,
        learning_steps INTEGER NOT NULL DEFAULT 0,
        reps           INTEGER NOT NULL DEFAULT 0,
        lapses         INTEGER NOT NULL DEFAULT 0,
        state          INTEGER NOT NULL DEFAULT 0,
        last_review    INTEGER,
        suspended      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_cards_note ON cards(note_id);
      CREATE INDEX idx_cards_queue ON cards(deck_id, suspended, state, due);

      CREATE TABLE reviews (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id           INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        deck_id           INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rating            INTEGER NOT NULL,
        state             INTEGER NOT NULL,
        due               INTEGER NOT NULL,
        stability         REAL    NOT NULL,
        difficulty        REAL    NOT NULL,
        elapsed_days      INTEGER NOT NULL,
        last_elapsed_days INTEGER NOT NULL,
        scheduled_days    INTEGER NOT NULL,
        learning_steps    INTEGER NOT NULL,
        reviewed_at       INTEGER NOT NULL,
        duration_ms       INTEGER NOT NULL
      );
      CREATE INDEX idx_reviews_user_time ON reviews(user_id, reviewed_at);

      CREATE TABLE day_counts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        deck_id      INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day          TEXT    NOT NULL,
        new_count    INTEGER NOT NULL DEFAULT 0,
        review_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(deck_id, day)
      );

      CREATE TABLE imports (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deck_id    INTEGER REFERENCES decks(id) ON DELETE SET NULL,
        filename   TEXT    NOT NULL,
        bytes      INTEGER NOT NULL,
        path       TEXT    NOT NULL,
        delimiter  TEXT    NOT NULL DEFAULT '',
        rows       INTEGER NOT NULL DEFAULT 0,
        added      INTEGER NOT NULL DEFAULT 0,
        updated    INTEGER NOT NULL DEFAULT 0,
        skipped    INTEGER NOT NULL DEFAULT 0,
        invalid    INTEGER NOT NULL DEFAULT 0,
        mapping    TEXT    NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_imports_user ON imports(user_id, created_at DESC);
    `,
  },
]

db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  name       TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
)`)

const applied = new Set(
  (db.prepare('SELECT name FROM migrations').all() as unknown as { name: string }[]).map(
    (r) => r.name,
  ),
)

for (const migration of MIGRATIONS) {
  if (applied.has(migration.name)) continue
  db.exec('BEGIN')
  try {
    db.exec(migration.sql)
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now(),
    )
    db.exec('COMMIT')
    console.log(`[db] migracion aplicada: ${migration.name}`)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

type Param = string | number | bigint | null | Uint8Array

/**
 * Lecturas tipadas. node:sqlite devuelve Record<string, SQLOutputValue>, que no
 * se solapa con nuestras interfaces de fila; el casteo se concentra aca en vez
 * de repetirse en cada consulta.
 */
export function queryAll<T>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

export function queryOne<T>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...params) as unknown as T | undefined
}

let depth = 0

/**
 * Ejecuta `fn` dentro de una transaccion, revirtiendo ante cualquier error.
 *
 * Es reentrante: SQLite no admite BEGIN anidado, asi que las llamadas internas
 * usan un SAVEPOINT. Esto importa porque restaurar un respaldo envuelve varias
 * altas de notas, y cada una abre su propia transaccion.
 */
export function transaction<T>(fn: () => T): T {
  const nested = depth > 0
  const punto = `sp_${depth}`
  db.exec(nested ? `SAVEPOINT ${punto}` : 'BEGIN')
  depth++
  try {
    const result = fn()
    db.exec(nested ? `RELEASE ${punto}` : 'COMMIT')
    return result
  } catch (error) {
    db.exec(nested ? `ROLLBACK TO ${punto}; RELEASE ${punto}` : 'ROLLBACK')
    throw error
  } finally {
    depth--
  }
}

export { dirname }
