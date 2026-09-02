import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { SESION_CAIDA, api } from '../api/cliente.ts'
import type { User } from '../../shared/tipos.ts'

interface Sesion {
  usuario: User | null
  cargando: boolean
  /** true cuando el servidor no tiene ninguna cuenta todavia. */
  necesitaPrimeraCuenta: boolean
  entrar: (email: string, password: string) => Promise<void>
  registrar: (datos: {
    email: string
    name: string
    password: string
    invite: string
  }) => Promise<void>
  salir: () => Promise<void>
  refrescar: () => Promise<void>
}

const Contexto = createContext<Sesion | null>(null)

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null)
  const [cargando, setCargando] = useState(true)
  const [necesitaPrimeraCuenta, setNecesitaPrimeraCuenta] = useState(false)

  const refrescar = useCallback(async () => {
    try {
      const estado = await api.get<{ user: User | null; necesitaPrimeraCuenta: boolean }>(
        '/auth/yo',
      )
      setUsuario(estado.user)
      setNecesitaPrimeraCuenta(estado.necesitaPrimeraCuenta)
    } catch {
      // Servidor caido o sin red: se muestra el formulario de entrada.
      setUsuario(null)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void refrescar()
  }, [refrescar])

  // Si el servidor rechaza cualquier peticion por sesion vencida, se cierra
  // la sesion en el cliente para que la app vuelva al formulario de entrada.
  useEffect(() => {
    const onCaida = () => setUsuario(null)
    window.addEventListener(SESION_CAIDA, onCaida)
    return () => window.removeEventListener(SESION_CAIDA, onCaida)
  }, [])

  const entrar = useCallback(
    async (email: string, password: string) => {
      await api.post('/auth/entrar', { email, password })
      await refrescar()
    },
    [refrescar],
  )

  const registrar = useCallback(
    async (datos: { email: string; name: string; password: string; invite: string }) => {
      await api.post('/auth/registro', datos)
      setNecesitaPrimeraCuenta(false)
      await refrescar()
    },
    [refrescar],
  )

  const salir = useCallback(async () => {
    await api.post('/auth/salir').catch(() => {})
    setUsuario(null)
  }, [])

  return (
    <Contexto.Provider
      value={{ usuario, cargando, necesitaPrimeraCuenta, entrar, registrar, salir, refrescar }}
    >
      {children}
    </Contexto.Provider>
  )
}

export function useSesion(): Sesion {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('useSesion necesita estar dentro de ProveedorSesion')
  return contexto
}
