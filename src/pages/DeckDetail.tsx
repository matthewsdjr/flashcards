import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { CardState, DEFAULT_DECK_CONFIG, db, type DeckConfig } from '../db/schema'
import {
  deckStats,
  deleteDeck,
  deleteNote,
  notesOfDeck,
  resetCards,
  setSuspended,
} from '../db/queries'
import { Badge, Button, Card, EmptyState, Field } from '../components/ui'
import { cx, inputClass } from '../lib/classnames'
import { downloadText, exportDeckTsv } from '../lib/backup'
import { formatDate } from '../lib/format'

const STATE_LABEL: Record<number, string> = {
  [CardState.New]: 'Nueva',
  [CardState.Learning]: 'Aprendiendo',
  [CardState.Review]: 'Repaso',
  [CardState.Relearning]: 'Reaprendiendo',
}

const STATE_TONE: Record<number, 'blue' | 'amber' | 'emerald' | 'rose'> = {
  [CardState.New]: 'blue',
  [CardState.Learning]: 'amber',
  [CardState.Review]: 'emerald',
  [CardState.Relearning]: 'rose',
}

export default function DeckDetail() {
  const { deckId: deckIdParam } = useParams()
  const deckId = Number(deckIdParam)
  const navigate = useNavigate()

  const [query, setQuery] = useState('')
  const [editingConfig, setEditingConfig] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const data = useLiveQuery(async () => {
    const deck = await db.decks.get(deckId)
    if (!deck) return null
    const [notes, stats] = await Promise.all([notesOfDeck(deckId), deckStats(deck)])
    return { deck, notes, stats }
  }, [deckId])

  const filtered = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    if (!q) return data.notes
    return data.notes.filter(
      ({ note }) =>
        note.front.toLowerCase().includes(q) ||
        note.back.toLowerCase().includes(q) ||
        note.tags.some((t) => t.toLowerCase().includes(q)),
    )
  }, [data, query])

  if (data === undefined) return <p className="text-sm text-slate-500">Cargando...</p>
  if (data === null) {
    return (
      <EmptyState
        title="Mazo no encontrado"
        description="Es posible que lo hayas borrado."
        action={
          <Link to="/">
            <Button variant="primary">Volver</Button>
          </Link>
        }
      />
    )
  }

  const { deck, stats } = data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            Mazos
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{deck.name}</h1>
          {deck.description && <p className="mt-1 text-sm text-slate-500">{deck.description}</p>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone="blue">{stats.newCount} nuevas</Badge>
            <Badge tone="amber">{stats.learningCount} aprendiendo</Badge>
            <Badge tone="emerald">{stats.reviewCount} en repaso</Badge>
            <Badge>{stats.total} tarjetas</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/importar?deck=${deck.id}`}>
            <Button variant="secondary">Importar</Button>
          </Link>
          <Button
            variant="secondary"
            onClick={async () => {
              const tsv = await exportDeckTsv(deckId)
              downloadText(`${deck.name.replace(/[^\w\s-]/g, '')}.tsv`, tsv)
            }}
          >
            Exportar TSV
          </Button>
          <Link to={`/estudiar/${deck.id}`}>
            <Button variant="primary">Estudiar ({stats.dueNow})</Button>
          </Link>
        </div>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Configuracion del mazo</h2>
          <Button variant="ghost" onClick={() => setEditingConfig((v) => !v)}>
            {editingConfig ? 'Cerrar' : 'Editar'}
          </Button>
        </div>
        {editingConfig ? (
          <ConfigForm
            config={deck.config}
            onSave={async (config) => {
              await db.decks.update(deckId, { config })
              setEditingConfig(false)
            }}
          />
        ) : (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
            <ConfigItem label="Nuevas por dia" value={deck.config.newPerDay} />
            <ConfigItem label="Repasos por dia" value={deck.config.reviewsPerDay} />
            <ConfigItem
              label="Retencion objetivo"
              value={`${Math.round(deck.config.requestRetention * 100)}%`}
            />
            <ConfigItem
              label="Tarjeta inversa"
              value={deck.config.generateReverse ? 'Si' : 'No'}
            />
          </dl>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Tarjetas</h2>
          <input
            className={cx(inputClass, 'max-w-64')}
            placeholder="Buscar en el mazo..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">
            {data.notes.length === 0
              ? 'Este mazo todavia no tiene tarjetas. Importa un TSV para empezar.'
              : 'Ninguna tarjeta coincide con la busqueda.'}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.slice(0, 200).map(({ note, cards }) => (
              <li key={note.id} className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{note.front}</p>
                    <p className="truncate text-sm text-slate-500">{note.back}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {cards.map((card) => (
                        <Badge key={card.id} tone={STATE_TONE[card.state]}>
                          {STATE_LABEL[card.state]}
                          {card.state !== CardState.New && ` - ${formatDate(card.due)}`}
                          {card.suspended === 1 && ' (suspendida)'}
                        </Badge>
                      ))}
                      {note.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() => void resetCards(cards.map((c) => c.id!))}
                    >
                      Reiniciar
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs"
                      onClick={() =>
                        void setSuspended(
                          cards.map((c) => c.id!),
                          cards.every((c) => c.suspended === 0),
                        )
                      }
                    >
                      {cards.every((c) => c.suspended === 1) ? 'Reanudar' : 'Suspender'}
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-rose-600"
                      onClick={() => void deleteNote(note.id!)}
                    >
                      Borrar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {filtered.length > 200 && (
          <p className="mt-3 text-center text-xs text-slate-400">
            Mostrando las primeras 200 de {filtered.length} tarjetas.
          </p>
        )}
      </Card>

      <Card className="border-rose-200 p-5 dark:border-rose-900">
        <h2 className="text-base font-semibold text-rose-700 dark:text-rose-400">Zona peligrosa</h2>
        <p className="mt-1 text-sm text-slate-500">
          Borrar el mazo elimina sus tarjetas y todo el historial de repasos. No se puede deshacer.
        </p>
        <div className="mt-4 flex gap-2">
          {confirmDelete ? (
            <>
              <Button
                variant="danger"
                onClick={async () => {
                  await deleteDeck(deckId)
                  navigate('/')
                }}
              >
                Si, borrar {deck.name}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Borrar mazo
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}

function ConfigItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function ConfigForm({
  config,
  onSave,
}: {
  config: DeckConfig
  onSave: (config: DeckConfig) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<DeckConfig>({ ...DEFAULT_DECK_CONFIG, ...config })

  return (
    <form
      className="mt-4 space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave(draft)
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nuevas por dia">
          <input
            type="number"
            min={0}
            max={9999}
            className={inputClass}
            value={draft.newPerDay}
            onChange={(e) => setDraft({ ...draft, newPerDay: Number(e.target.value) })}
          />
        </Field>
        <Field label="Repasos por dia">
          <input
            type="number"
            min={0}
            max={9999}
            className={inputClass}
            value={draft.reviewsPerDay}
            onChange={(e) => setDraft({ ...draft, reviewsPerDay: Number(e.target.value) })}
          />
        </Field>
        <Field
          label="Retencion objetivo (%)"
          hint="Mas alto significa repasos mas frecuentes. Recomendado: 90."
        >
          <input
            type="number"
            min={70}
            max={98}
            className={inputClass}
            value={Math.round(draft.requestRetention * 100)}
            onChange={(e) =>
              setDraft({
                ...draft,
                requestRetention: Math.min(0.98, Math.max(0.7, Number(e.target.value) / 100)),
              })
            }
          />
        </Field>
        <Field label="Pasos de aprendizaje" hint="Separados por espacio. Ej: 1m 10m">
          <input
            className={inputClass}
            value={draft.learningSteps.join(' ')}
            onChange={(e) => setDraft({ ...draft, learningSteps: e.target.value.split(/\s+/) })}
          />
        </Field>
        <Field label="Pasos de reaprendizaje" hint="Se aplican cuando fallas una tarjeta.">
          <input
            className={inputClass}
            value={draft.relearningSteps.join(' ')}
            onChange={(e) => setDraft({ ...draft, relearningSteps: e.target.value.split(/\s+/) })}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          checked={draft.generateReverse}
          onChange={(e) => setDraft({ ...draft, generateReverse: e.target.checked })}
        />
        Generar tarjeta inversa en las proximas importaciones
      </label>
      <div className="flex justify-end">
        <Button type="submit" variant="primary">
          Guardar configuracion
        </Button>
      </div>
    </form>
  )
}
