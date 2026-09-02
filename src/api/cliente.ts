/**
 * Cliente HTTP de la API. Centraliza el manejo de errores y el desfase horario
 * para que el servidor pueda calcular los limites diarios en el dia del usuario.
 */

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  get esNoAutenticado() {
    return this.status === 401
  }
}

/** Se dispara cuando la sesion caduca, para que la app vuelva al login. */
export const SESION_CAIDA = 'flashcards:sesion-caida'

function withTz(path: string): string {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}tz=${new Date().getTimezoneOffset()}`
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {},
  }

  if (body instanceof FormData) {
    init.body = body
  } else if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(withTz(`/api${path}`), init)
  } catch {
    throw new ApiError('No se pudo contactar al servidor', 0)
  }

  const payload = await parse(response)

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Error ${response.status}`
    if (response.status === 401) window.dispatchEvent(new CustomEvent(SESION_CAIDA))
    throw new ApiError(message, response.status)
  }

  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
}

/** Descarga un archivo servido por la API respetando su nombre. */
export async function descargar(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(withTz(`/api${path}`), { credentials: 'same-origin' })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new CustomEvent(SESION_CAIDA))
    throw new ApiError('No se pudo descargar el archivo', response.status)
  }

  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^";]+)"?/.exec(disposition)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = match?.[1] ?? fallbackName
  link.click()
  URL.revokeObjectURL(url)
}
