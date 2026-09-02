import { useState } from 'react'
import { api } from '../api/cliente.ts'
import { useAccion, useConsulta } from '../api/hooks.ts'
import { Button, Field, Panel, SectionHeading, Spinner } from '../components/ui.tsx'
import { inputClass } from '../lib/classnames.ts'
import { formatDate } from '../lib/format.ts'
import type { Invite } from '../../shared/tipos.ts'

export default function Invitaciones() {
  const consulta = useConsulta(() => api.get<{ invites: Invite[] }>('/invitaciones'), [])
  const { ejecutar, enviando, error } = useAccion()
  const [nota, setNota] = useState('')
  const [copiado, setCopiado] = useState('')

  async function crear(event: React.FormEvent) {
    event.preventDefault()
    const creada = await ejecutar(() => api.post<{ code: string }>('/invitaciones', { note: nota }))
    if (creada) {
      setNota('')
      consulta.recargar()
    }
  }

  async function copiar(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiado(code)
      setTimeout(() => setCopiado(''), 2000)
    } catch {
      // Sin permiso de portapapeles: el codigo esta a la vista para copiarlo a mano.
    }
  }

  if (consulta.cargando && !consulta.data) return <Spinner />

  const invites = consulta.data?.invites ?? []
  const disponibles = invites.filter((i) => !i.usedAt && i.expiresAt > Date.now())

  return (
    <div className="space-y-8">
      <SectionHeading
        as="h1"
        title="Invitaciones"
        description="El registro esta cerrado: solo quien tenga uno de estos codigos puede crear una cuenta. Cada codigo sirve una sola vez."
      />

      <Panel className="p-5">
        <form onSubmit={crear} className="flex flex-wrap items-end gap-3">
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
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </Panel>

      {invites.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-2">
          Todavia no generaste ninguna invitacion.
        </p>
      ) : (
        <div>
          <p className="mb-4 text-sm text-ink-2">
            {disponibles.length === 1
              ? '1 codigo sin usar'
              : `${disponibles.length} codigos sin usar`}
          </p>
          <ul className="border-t border-rule">
            {invites.map((invite) => {
              const vencido = invite.expiresAt <= Date.now()
              const usado = Boolean(invite.usedAt)
              return (
                <li key={invite.code} className="flex flex-wrap items-center gap-4 border-b border-rule py-3.5">
                  <code
                    className={`font-mono text-sm tracking-wider ${
                      usado || vencido ? 'text-ink-3 line-through' : 'text-ink'
                    }`}
                  >
                    {invite.code}
                  </code>

                  <span className="text-xs text-ink-2">
                    {usado
                      ? `Usado por ${invite.usedBy ?? 'alguien'} el ${formatDate(invite.usedAt!)}`
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
                        onClick={async () => {
                          await ejecutar(() => api.delete(`/invitaciones/${invite.code}`))
                          consulta.recargar()
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
        </div>
      )}
    </div>
  )
}
