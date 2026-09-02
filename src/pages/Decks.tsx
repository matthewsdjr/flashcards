import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/cliente.ts'
import { useAccion, useConsulta } from '../api/hooks.ts'
import { Button, EmptyState, Field, Panel, SectionHeading, Spinner } from '../components/ui.tsx'
import { AvisoMigracion } from '../components/AvisoMigracion.tsx'
import { StrengthLegend, StrengthStrip } from '../components/StrengthStrip.tsx'
import { inputClass } from '../lib/classnames.ts'
import { pluralize } from '../lib/format.ts'
import type { Deck, DeckWithStats } from '../../shared/tipos.ts'

function toStrength(stats: DeckWithStats['stats']) {
  return {
    new: stats.newCount,
    learning: stats.learningCount,
    young: stats.youngCount,
    mature: stats.matureCount,
  }
}

export default function Decks() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const consulta = useConsulta(
    () => api.get<{ decks: DeckWithStats[] }>('/mazos'),
    [],
  )
  const { ejecutar, enviando, error } = useAccion()

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const created = await ejecutar(() =>
      api.post<{ deck: Deck }>('/mazos', { name, description }),
    )
    if (!created) return
    setName('')
    setDescription('')
    setCreating(false)
    navigate(`/mazo/${created.deck.id}`)
  }

  if (consulta.cargando && !consulta.data) return <Spinner />
  if (consulta.error) {
    return <EmptyState title="No se pudieron cargar los mazos" description={consulta.error} />
  }

  const decks = consulta.data?.decks ?? []
  const totalDue = decks.reduce((sum, d) => sum + d.stats.dueNow, 0)

  return (
    <div className="space-y-8">
      <SectionHeading
        as="h1"
        title="Mis mazos"
        description={
          decks.length === 0
            ? 'Importa un archivo o crea un mazo para empezar.'
            : totalDue > 0
              ? `Tenes ${pluralize(totalDue, 'tarjeta lista', 'tarjetas listas')} para repasar.`
              : 'Estas al dia. No queda nada para repasar por ahora.'
        }
        actions={
          <>
            <Link to="/importar">
              <Button variant="secondary">Importar archivo</Button>
            </Link>
            <Button variant="primary" onClick={() => setCreating((v) => !v)}>
              Crear mazo
            </Button>
          </>
        }
      />

      <AvisoMigracion onMigrado={consulta.recargar} />

      {creating && (
        <Panel className="p-5">
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Nombre">
              <input
                autoFocus
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Anatomia, sistema nervioso"
              />
            </Field>
            <Field label="Descripcion" hint="Opcional.">
              <input
                className={inputClass}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={!name.trim() || enviando}>
                Crear mazo
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {decks.length === 0 && !creating ? (
        <EmptyState
          title="Todavia no hay nada que estudiar"
          description="Importa un TSV o CSV exportado de Anki, Excel o Google Sheets, y las tarjetas quedan listas en segundos."
          action={
            <Link to="/importar">
              <Button variant="primary">Importar archivo</Button>
            </Link>
          }
        />
      ) : (
        <ul className="border-t border-rule">
          {decks.map((deck) => (
            <li key={deck.id} className="border-b border-rule">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-4 py-5">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/mazo/${deck.id}`}
                    className="display text-lg font-medium text-ink transition hover:text-claret"
                  >
                    {deck.name}
                  </Link>
                  {deck.description && (
                    <p className="mt-0.5 truncate text-sm text-ink-2">{deck.description}</p>
                  )}
                  <div className="mt-3 max-w-sm space-y-1.5">
                    <StrengthStrip strength={toStrength(deck.stats)} />
                    <StrengthLegend strength={toStrength(deck.stats)} />
                  </div>
                </div>

                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <p
                      className={`display tnum text-3xl font-medium ${
                        deck.stats.dueNow > 0 ? 'text-claret' : 'text-ink-3'
                      }`}
                    >
                      {deck.stats.dueNow}
                    </p>
                    <p className="text-xs text-ink-2">para hoy</p>
                  </div>
                  <Link to={`/estudiar/${deck.id}`}>
                    <Button variant={deck.stats.dueNow > 0 ? 'primary' : 'secondary'}>
                      Estudiar
                    </Button>
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
