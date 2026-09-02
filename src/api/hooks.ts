import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './cliente.ts'

export interface Consulta<T> {
  data: T | undefined
  error: string | null
  cargando: boolean
  recargar: () => void
}

/**
 * Consulta simple con recarga manual. No hay cache compartida: cada pantalla
 * pide lo suyo y lo vuelve a pedir cuando cambia algo, que para el volumen de
 * datos de esta app es mas que suficiente y evita estados desincronizados.
 */
export function useConsulta<T>(fn: () => Promise<T>, deps: unknown[]): Consulta<T> {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    let vigente = true
    setCargando(true)
    fnRef
      .current()
      .then((result) => {
        if (!vigente) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!vigente) return
        // El 401 lo maneja el contexto de sesion, no cada pantalla.
        if (err instanceof ApiError && err.esNoAutenticado) return
        setError(err instanceof Error ? err.message : 'Algo fallo')
      })
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const recargar = useCallback(() => setNonce((n) => n + 1), [])
  return { data, error, cargando, recargar }
}

/** Envuelve una accion con estado de envio y mensaje de error. */
export function useAccion() {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ejecutar = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setEnviando(true)
    setError(null)
    try {
      return await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo fallo')
      return undefined
    } finally {
      setEnviando(false)
    }
  }, [])

  return { ejecutar, enviando, error, setError }
}
