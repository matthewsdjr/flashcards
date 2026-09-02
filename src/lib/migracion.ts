/**
 * Rescate de los datos de la version local-first.
 *
 * La app guardaba todo en IndexedDB bajo la base `flashcards`. Se lee sin
 * Dexie, con la API nativa, para no arrastrar esa dependencia solo por esto:
 * en cuanto el usuario migra o descarta, este archivo deja de hacer falta.
 */

const DB_NAME = 'flashcards'
const DESCARTADO = 'flashcards:migracion-descartada'

export interface DatosLocales {
  decks: { id: number; name: string; description: string; config: unknown; createdAt: number }[]
  notes: {
    id: number
    deckId: number
    front: string
    back: string
    hint: string
    extra: string
    tags: string[]
  }[]
}

function abrir(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let existe = true
    const request = indexedDB.open(DB_NAME)
    // Si `upgradeneeded` dispara, la base no existia: la creamos sin querer.
    request.onupgradeneeded = () => {
      existe = false
    }
    request.onsuccess = () => {
      const db = request.result
      if (!existe || !db.objectStoreNames.contains('decks')) {
        db.close()
        indexedDB.deleteDatabase(DB_NAME)
        resolve(null)
        return
      }
      resolve(db)
    }
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

function leerTodo<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll()
      request.onsuccess = () => resolve((request.result ?? []) as T[])
      request.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/** Devuelve los datos locales, o null si no hay nada que migrar. */
export async function leerDatosLocales(): Promise<DatosLocales | null> {
  if (typeof indexedDB === 'undefined') return null
  if (localStorage.getItem(DESCARTADO) === 'si') return null

  const db = await abrir()
  if (!db) return null

  try {
    const [decks, notes] = await Promise.all([
      leerTodo<DatosLocales['decks'][number]>(db, 'decks'),
      leerTodo<DatosLocales['notes'][number]>(db, 'notes'),
    ])
    if (decks.length === 0) return null
    return { decks, notes }
  } finally {
    db.close()
  }
}

/** Borra la base local. Se llama tras migrar, para no dejar dos copias. */
export function borrarDatosLocales(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** Recuerda que el usuario no quiere que se le vuelva a preguntar. */
export function descartarMigracion(): void {
  try {
    localStorage.setItem(DESCARTADO, 'si')
  } catch {
    // Almacenamiento bloqueado: se volvera a preguntar en la proxima visita.
  }
}
