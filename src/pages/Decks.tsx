import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { createDeck, deckStats, type DeckStats } from '../db/queries'
import { Badge, Button, Card, EmptyState, Field } from '../components/ui'
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

  if (!data) return <p className="text-sm text-slate-500">Cargando...</p>

  const totalDue = data.decks.reduce((sum, d) => sum + (data.byId.get(d.id!)?.dueNow ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mis mazos</h1>
          <p className="mt-1 text-sm text-slate-500">
            {totalDue > 0
              ? `${pluralize(totalDue, 'tarjeta pendiente', 'tarjetas pendientes')} para hoy.`
              : 'No tenes tarjetas pendientes por ahora.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/importar">
            <Button variant="secondary">Importar TSV</Button>
          </Link>
          <Button variant="primary" onClick={() => setCreating((v) => !v)}>
            Nuevo mazo
          </Button>
        </div>
      </div>

      {creating && (
        <Card className="p-5">
          <form onSubmit={handleCreate} className="space-y-4">
            <Field label="Nombre del mazo">
              <input
                autoFocus
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Anatomia - Sistema nervioso"
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
        </Card>
      )}

      {data.decks.length === 0 && !creating ? (
        <EmptyState
          title="Todavia no hay mazos"
          description="Crea un mazo vacio o importa directamente un archivo TSV o CSV exportado desde Anki, Excel o Google Sheets."
          action={
            <Link to="/importar">
              <Button variant="primary">Importar un archivo</Button>
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.decks.map((deck) => {
            const stats = data.byId.get(deck.id!)
            return (
              <li key={deck.id}>
                <Card className="flex h-full flex-col justify-between gap-4 p-5">
                  <div>
                    <Link
                      to={`/mazo/${deck.id}`}
                      className="text-base font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {deck.name}
                    </Link>
                    {deck.description && (
                      <p className="mt-1 text-sm text-slate-500">{deck.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <Badge tone="blue">{stats?.newCount ?? 0} nuevas</Badge>
                      <Badge tone="amber">{stats?.learningCount ?? 0} aprendiendo</Badge>
                      <Badge tone="emerald">{stats?.reviewCount ?? 0} en repaso</Badge>
                      {(stats?.suspended ?? 0) > 0 && (
                        <Badge tone="rose">{stats?.suspended} suspendidas</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-500">
                      {stats?.dueNow ? `${stats.dueNow} para estudiar ahora` : 'Al dia'}
                    </span>
                    <Link to={`/estudiar/${deck.id}`}>
                      <Button variant={stats?.dueNow ? 'primary' : 'secondary'}>Estudiar</Button>
                    </Link>
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
