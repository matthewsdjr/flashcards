import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { createDeck, deckStats, toStrength, type DeckStats } from '../db/queries'
import {
  Button,
  EmptyState,
  Field,
  Panel,
  SectionHeading,
  Spinner,
} from '../components/ui'
import { StrengthLegend, StrengthStrip } from '../components/StrengthStrip'
import { inputClass } from '../lib/classnames'
import { pluralize } from '../lib/format'

export default function Decks() {
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const data = useLiveQuery(async () => {
    const decks = await db.decks.orderBy('createdAt').reverse().toArray()
    const stats = await Promise.all(decks.map((deck) => deckStats(deck)))
    const byId = new Map<number, DeckStats>(stats.map((s) => [s.deckId, s]))
    return { decks, byId }
  }, [])

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    const id = await createDeck(name, description)
    setName('')
    setDescription('')
    setCreating(false)
    navigate(`/mazo/${id}`)
  }

  if (!data) return <Spinner />

  const totalDue = data.decks.reduce((sum, d) => sum + (data.byId.get(d.id!)?.dueNow ?? 0), 0)

  return (
    <div className="space-y-8">
      <SectionHeading
        as="h1"
        title="Mis mazos"
        description={
          data.decks.length === 0
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
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" disabled={!name.trim()}>
                Crear mazo
              </Button>
            </div>
          </form>
        </Panel>
      )}

      {data.decks.length === 0 && !creating ? (
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
          {data.decks.map((deck) => {
            const stats = data.byId.get(deck.id!)
            const due = stats?.dueNow ?? 0
            return (
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
                      <StrengthStrip strength={toStrength(stats!)} />
                      <StrengthLegend strength={toStrength(stats!)} />
                    </div>
                  </div>

                  <div className="flex items-center gap-5">
                    <div className="text-right">
                      <p
                        className={`display tnum text-3xl font-medium ${due > 0 ? 'text-claret' : 'text-ink-3'}`}
                      >
                        {due}
                      </p>
                      <p className="text-xs text-ink-2">para hoy</p>
                    </div>
                    <Link to={`/estudiar/${deck.id}`}>
                      <Button variant={due > 0 ? 'primary' : 'secondary'}>Estudiar</Button>
                    </Link>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
