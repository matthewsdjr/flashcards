import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { CardState, DEFAULT_DECK_CONFIG, db, type DeckConfig } from '../db/schema'
import {
  MATURE_DAYS,
  deckStats,
  deleteDeck,
  deleteNote,
  notesOfDeck,
  resetCards,
  setSuspended,
  toStrength,
} from '../db/queries'
import {
  Button,
  Checkbox,
  Field,
  Panel,
  SectionHeading,
  Spinner,
  Stat,
  Tag,
} from '../components/ui'
import { StrengthLegend, StrengthStrip } from '../components/StrengthStrip'
import { cx, inputClass } from '../lib/classnames'
import { downloadText, exportDeckTsv } from '../lib/backup'
import { formatDate } from '../lib/format'

/** Etiqueta y color de una tarjeta segun su lugar en la rampa de memoria. */
function cardState(state: number, scheduledDays: number) {
  if (state === CardState.New) return { label: 'sin ver', color: 'bg-m-new' }
  if (state === CardState.Learning) return { label: 'aprendiendo', color: 'bg-m-learning' }
  if (state === CardState.Relearning) return { label: 'reaprendiendo', color: 'bg-m-learning' }
  return scheduledDays >= MATURE_DAYS
    ? { label: 'consolidada', color: 'bg-m-mature' }
    : { label: 'sabida', color: 'bg-m-young' }
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

  if (data === undefined) return <Spinner />
  if (data === null) {
    return (
      <div className="py-16 text-center">
        <h1 className="display text-2xl font-medium">Ese mazo ya no existe</h1>
        <div className="mt-6">
          <Link to="/">
            <Button variant="primary">Ver mis mazos</Button>
          </Link>
        </div>
      </div>
    )
  }

  const { deck, stats } = data

  return (
    <div className="space-y-10">
      <div>
        <Link to="/" className="text-sm text-ink-2 transition hover:text-ink">
          Mazos
        </Link>
        <div className="mt-2">
          <SectionHeading
            as="h1"
            title={deck.name}
            description={deck.description || undefined}
            actions={
              <>
                <Link to={`/importar?deck=${deck.id}`}>
                  <Button variant="secondary">Importar</Button>
                </Link>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const tsv = await exportDeckTsv(deckId)
                    downloadText(`${deck.name.replace(/[^\w\s-]/g, '').trim()}.tsv`, tsv)
                  }}
                >
                  Exportar TSV
                </Button>
                <Link to={`/estudiar/${deck.id}`}>
                  <Button variant="primary">Estudiar {stats.dueNow > 0 && stats.dueNow}</Button>
                </Link>
              </>
            }
          />
        </div>

        <div className="mt-6 max-w-lg space-y-2.5">
          <StrengthStrip strength={toStrength(stats)} height="h-2" />
          <StrengthLegend strength={toStrength(stats)} />
        </div>
      </div>

      <Panel className="p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="display text-lg font-medium">Ritmo de estudio</h2>
          <Button variant="ghost" onClick={() => setEditingConfig((v) => !v)}>
            {editingConfig ? 'Cerrar' : 'Ajustar'}
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
          <div className="mt-5 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat value={deck.config.newPerDay} label="nuevas por dia" />
            <Stat value={deck.config.reviewsPerDay} label="repasos por dia" />
            <Stat
              value={`${Math.round(deck.config.requestRetention * 100)}%`}
              label="retencion objetivo"
            />
            <Stat value={deck.config.generateReverse ? 'Si' : 'No'} label="tarjeta inversa" />
          </div>
        )}
      </Panel>

      <div>
        <SectionHeading
          title="Tarjetas"
          actions={
            <input
              className={cx(inputClass, 'w-56')}
              placeholder="Buscar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          }
        />

        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-ink-2">
            {data.notes.length === 0
              ? 'Este mazo esta vacio. Importa un archivo para llenarlo.'
              : 'Ninguna tarjeta coincide con esa busqueda.'}
          </p>
        ) : (
          <ul className="mt-5 border-t border-rule">
            {filtered.slice(0, 200).map(({ note, cards }) => (
              <li key={note.id} className="group border-b border-rule">
                <div className="flex items-start justify-between gap-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">{note.front}</p>
                    <p className="mt-0.5 truncate text-sm text-ink-2">{note.back}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {cards.map((card) => {
                        const state = cardState(card.state, card.scheduledDays)
                        return (
                          <span
                            key={card.id}
                            className="flex items-center gap-1.5 text-xs text-ink-2"
                          >
                            <span aria-hidden className={cx('size-2 rounded-full', state.color)} />
                            {state.label}
                            {card.state !== CardState.New && ` hasta ${formatDate(card.due)}`}
                            {card.suspended === 1 && ' (en pausa)'}
                          </span>
                        )
                      })}
                      {note.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
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
                      {cards.every((c) => c.suspended === 1) ? 'Reanudar' : 'Pausar'}
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-2 py-1 text-xs text-danger"
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
          <p className="mt-4 text-center text-xs text-ink-3">
            Se muestran 200 de {filtered.length} tarjetas. Afina la busqueda para ver el resto.
          </p>
        )}
      </div>

      <Panel className="p-5">
        <h2 className="display text-lg font-medium text-danger">Borrar el mazo</h2>
        <p className="mt-1.5 max-w-prose text-sm text-ink-2">
          Se van las {stats.total} tarjetas y todo su historial de repasos. No hay vuelta atras, asi
          que descarga un respaldo desde Ajustes si te sirve conservarlo.
        </p>
        <div className="mt-5 flex gap-2">
          {confirmDelete ? (
            <>
              <Button
                variant="danger"
                onClick={async () => {
                  await deleteDeck(deckId)
                  navigate('/')
                }}
              >
                Borrar {deck.name}
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
              Borrar mazo
            </Button>
          )}
        </div>
      </Panel>
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
      className="mt-5 space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave(draft)
      }}
    >
      <div className="grid gap-5 sm:grid-cols-3">
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
        <Field label="Retencion objetivo" hint="Mas alto, repasos mas seguidos. 90 es lo habitual.">
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
        <Field label="Pasos de aprendizaje" hint="Separados por espacio. Por ejemplo: 1m 10m">
          <input
            className={inputClass}
            value={draft.learningSteps.join(' ')}
            onChange={(e) => setDraft({ ...draft, learningSteps: e.target.value.split(/\s+/) })}
          />
        </Field>
        <Field label="Pasos al fallar" hint="Se aplican cuando respondes Otra vez.">
          <input
            className={inputClass}
            value={draft.relearningSteps.join(' ')}
            onChange={(e) => setDraft({ ...draft, relearningSteps: e.target.value.split(/\s+/) })}
          />
        </Field>
      </div>

      <Checkbox
        checked={draft.generateReverse}
        onChange={(generateReverse) => setDraft({ ...draft, generateReverse })}
        label="Generar tarjeta inversa al importar"
        hint="Afecta solo a las importaciones futuras de este mazo."
      />

      <div className="flex justify-end">
        <Button type="submit" variant="primary">
          Guardar cambios
        </Button>
      </div>
    </form>
  )
}
