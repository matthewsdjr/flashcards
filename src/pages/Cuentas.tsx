import { useState } from 'react'
import { api } from '../api/cliente.ts'
import { useAccion, useConsulta } from '../api/hooks.ts'
import { useSesion } from '../auth/SesionContext.tsx'
import { Button, Field, Panel, SectionHeading, Spinner, Tag } from '../components/ui.tsx'
import { inputClass } from '../lib/classnames.ts'
import { formatDate, formatRelative } from '../lib/format.ts'
import type { AdminUser, Invite } from '../../shared/tipos.ts'

/** Que se pierde al borrar esa cuenta, dicho segun lo que realmente tenga. */
function avisoDeBorrado(cuenta: AdminUser): string {
  if (cuenta.cardCount === 0) {
    return `${cuenta.name} no tiene nada guardado todavia. Se borra la cuenta y pierde el acceso al servidor.`
  }
  const mazos = cuenta.deckCount === 1 ? 'su mazo' : `sus ${cuenta.deckCount} mazos`
  return `Se van ${mazos}, las ${cuenta.cardCount} tarjetas que contienen, el historial de repasos y los archivos que importo. No hay vuelta atras.`
}

export default function Cuentas() {
  const { usuario, refrescar } = useSesion()
  const usuarios = useConsulta(() => api.get<{ users: AdminUser[] }>('/usuarios'), [])
  const invitaciones = useConsulta(() => api.get<{ invites: Invite[] }>('/invitaciones'), [])
  const { ejecutar, enviando, error } = useAccion()

  const [nota, setNota] = useState('')
  const [copiado, setCopiado] = useState('')
  const [confirmando, setConfirmando] = useState<number | null>(null)

  async function crearInvitacion(event: React.FormEvent) {
    event.preventDefault()
    const creada = await ejecutar(() => api.post<{ code: string }>('/invitaciones', { note: nota }))
    if (creada) {
      setNota('')
      invitaciones.recargar()
    }
  }

  async function copiar(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiado(code)
      setTimeout(() => setCopiado(''), 2000)
    } catch {
      // Sin permiso de portapapeles: el codigo esta a la vista para copiarlo.
    }
  }

  async function cerrarSesiones(id: number) {
    const resultado = await ejecutar(() =>
      api.post<{ esPropia: boolean }>(`/usuarios/${id}/cerrar-sesiones`),
    )
    if (!resultado) return
    // Si se cerraron las propias, la sesion actual tambien murio.
    if (resultado.esPropia) await refrescar()
    else usuarios.recargar()
  }

  async function eliminar(id: number) {
    const ok = await ejecutar(() => api.delete(`/usuarios/${id}`))
    setConfirmando(null)
    if (ok !== undefined) {
      usuarios.recargar()
      invitaciones.recargar()
    }
  }

  if (usuarios.cargando && !usuarios.data) return <Spinner />

  const cuentas = usuarios.data?.users ?? []
  const invites = invitaciones.data?.invites ?? []
  const disponibles = invites.filter((i) => !i.usedAt && i.expiresAt > Date.now())
  const admins = cuentas.filter((c) => c.isAdmin).length

  return (
    <div className="space-y-12">
      <SectionHeading
        as="h1"
        title="Cuentas"
        description="Quien tiene acceso a este servidor y quien puede conseguirlo."
      />

      {error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div>
        <SectionHeading
          title="Usuarios"
          description={
            cuentas.length === 1
              ? 'Sos la unica cuenta del servidor.'
              : `${cuentas.length} cuentas en total.`
          }
        />

        <ul className="mt-5 border-t border-rule">
          {cuentas.map((cuenta) => {
            const esYo = cuenta.id === usuario?.id
            // Sin esto el servidor se quedaria sin quien lo administre.
            const ultimoAdmin = cuenta.isAdmin && admins <= 1
            return (
              <li key={cuenta.id} className="group border-b border-rule py-4">
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{cuenta.name}</span>
                      {cuenta.isAdmin && <Tag>administra</Tag>}
                      {esYo && <Tag>sos vos</Tag>}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-ink-2">{cuenta.email}</p>
                    <p className="tnum mt-2 text-xs text-ink-2">
                      Alta el {formatDate(cuenta.createdAt)} · {cuenta.deckCount} mazos ·{' '}
                      {cuenta.cardCount} tarjetas · {cuenta.reviewCount} repasos
                    </p>
                    <p className="mt-1 text-xs text-ink-3">
                      {cuenta.lastActivity
                        ? `Estudio por ultima vez ${formatRelative(cuenta.lastActivity)}`
                        : 'Todavia no estudio nada'}
                      {' · '}
                      {cuenta.sessions === 0
                        ? 'sin sesiones abiertas'
                        : cuenta.sessions === 1
                          ? '1 sesion abierta'
                          : `${cuenta.sessions} sesiones abiertas`}
                    </p>

                    {confirmando === cuenta.id && (
                      <p className="mt-3 max-w-prose rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
                        {avisoDeBorrado(cuenta)}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1">
                    {cuenta.sessions > 0 && (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        disabled={enviando}
                        onClick={() => void cerrarSesiones(cuenta.id)}
                        title={
                          esYo
                            ? 'Cierra tambien la sesion de este dispositivo'
                            : 'Deja fuera a esa cuenta en todos sus dispositivos'
                        }
                      >
                        Cerrar sesiones
                      </Button>
                    )}

                    {!esYo && !ultimoAdmin && (
                      <>
                        {confirmando === cuenta.id ? (
                          <>
                            <Button
                              variant="danger"
                              className="px-2 py-1 text-xs"
                              disabled={enviando}
                              onClick={() => void eliminar(cuenta.id)}
                            >
                              Borrar de verdad
                            </Button>
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs"
                              onClick={() => setConfirmando(null)}
                            >
                              Cancelar
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-xs text-danger"
                            onClick={() => setConfirmando(cuenta.id)}
                          >
                            Eliminar cuenta
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      <div>
        <SectionHeading
          title="Invitaciones"
          description="El registro esta cerrado: solo quien tenga uno de estos codigos puede crear una cuenta. Cada codigo sirve una sola vez."
        />

        <Panel className="mt-5 p-5">
          <form onSubmit={crearInvitacion} className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <Field label="Para quien es" hint="Solo para acordarte. Vence a los 14 dias.">
                <input
                  className={inputClass}
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Companero de anatomia"
                />
              </Field>
            </div>
            <Button type="submit" variant="primary" disabled={enviando}>
              {enviando ? 'Generando' : 'Generar codigo'}
            </Button>
          </form>
        </Panel>

        {invites.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-2">
            Todavia no generaste ninguna invitacion.
          </p>
        ) : (
          <>
            <p className="mt-6 mb-3 text-sm text-ink-2">
              {disponibles.length === 1
                ? '1 codigo sin usar'
                : `${disponibles.length} codigos sin usar`}
            </p>
            <ul className="border-t border-rule">
              {invites.map((invite) => {
                const vencido = invite.expiresAt <= Date.now()
                const usado = Boolean(invite.usedAt)
                return (
                  <li
                    key={invite.code}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-rule py-3.5"
                  >
                    <code
                      className={`font-mono text-sm tracking-wider ${
                        usado || vencido ? 'text-ink-3 line-through' : 'text-ink'
                      }`}
                    >
                      {invite.code}
                    </code>

                    <span className="text-xs text-ink-2">
                      {usado
                        ? `Usado por ${invite.usedBy ?? 'una cuenta ya eliminada'} el ${formatDate(invite.usedAt!)}`
                        : vencido
                          ? `Vencio el ${formatDate(invite.expiresAt)}`
                          : `Vence el ${formatDate(invite.expiresAt)}`}
                      {invite.note && ` · ${invite.note}`}
                    </span>

                    {!usado && !vencido && (
                      <div className="ml-auto flex gap-1">
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs"
                          onClick={() => void copiar(invite.code)}
                        >
                          {copiado === invite.code ? 'Copiado' : 'Copiar'}
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-xs text-danger"
                          disabled={enviando}
                          onClick={async () => {
                            await ejecutar(() => api.delete(`/invitaciones/${invite.code}`))
                            invitaciones.recargar()
                          }}
                        >
                          Anular
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
