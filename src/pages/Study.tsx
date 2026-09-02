import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { db, type Card as CardRow, type Deck, type Note } from '../db/schema'
import { answerCard, buildQueue } from '../db/queries'
import {
  GRADES,
  GRADE_KEYS,
  GRADE_LABELS,
  GRADE_RULE,
  GRADE_TEXT,
  preview,
  type Grade,
} from '../lib/scheduler'
import { Button, EmptyState, Panel, Spinner, Stat, Tag } from '../components/ui'
import { cx } from '../lib/classnames'
import { formatDuration, formatInterval } from '../lib/format'

interface QueueItem {
  card: CardRow
  note: Note
}

interface SessionStats {
  reviewed: number
  again: number
  /** Tiempo efectivo respondiendo, sin contar las pausas entre tarjetas. */
  timeMs: number
}

export default function Study() {
  const { deckId: deckIdParam } = useParams()
  const deckId = Number(deckIdParam)

  const [deck, setDeck] = useState<Deck | null>(null)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [stats, setStats] = useState<SessionStats>({ reviewed: 0, again: 0, timeMs: 0 })
  const shownAt = useRef(0)
  const answering = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    const found = await db.decks.get(deckId)
    if (!found) {
      setDeck(null)
      setLoading(false)
      return
    }
    setDeck(found)
    const cards = await buildQueue(found)
    const notes = await db.notes.bulkGet(cards.map((c) => c.noteId))
    const items: QueueItem[] = []
    cards.forEach((card, index) => {
      const note = notes[index]
      if (note) items.push({ card, note })
    })
    setQueue(items)
    setRevealed(false)
    setShowHint(false)
    shownAt.current = Date.now()
    setLoading(false)
  }, [deckId])

  useEffect(() => {
    void load()
  }, [load])

  const current = queue[0]

  const options = useMemo(() => {
    if (!current || !deck || !revealed) return null
    const now = new Date()
    const log = preview(current.card, deck.config, now)
    return GRADES.map((grade) => ({
      grade,
      interval: formatInterval(now.getTime(), log[grade].card.due.getTime()),
    }))
  }, [current, deck, revealed])

  const handleAnswer = useCallback(
    async (grade: Grade) => {
      if (!current || !deck || answering.current) return
      answering.current = true
      const duration = Date.now() - shownAt.current
      try {
        const updated = await answerCard(current.card, deck.config, grade, duration)
        setStats((s) => ({
          reviewed: s.reviewed + 1,
          again: s.again + (grade === 1 ? 1 : 0),
          timeMs: s.timeMs + duration,
        }))
        setQueue((prev) => {
          const rest = prev.slice(1)
          // Si vuelve a vencer dentro de la sesion, se reinserta en orden de vencimiento.
          if (updated.due <= Date.now() + 20 * 60 * 1000) {
            const item = { card: updated, note: current.note }
            const at = rest.findIndex((q) => q.card.due > updated.due)
            if (at === -1) rest.push(item)
            else rest.splice(at, 0, item)
          }
          return rest
        })
        setRevealed(false)
        setShowHint(false)
        shownAt.current = Date.now()
      } finally {
        answering.current = false
      }
    },
    [current, deck],
  )

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      if (!revealed) {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          setRevealed(true)
        }
        if (event.key.toLowerCase() === 'h') setShowHint((v) => !v)
        return
      }
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        void handleAnswer(3 as Grade)
        return
      }
      const grade = GRADES.find((g) => GRADE_KEYS[g] === event.key)
      if (grade) {
        event.preventDefault()
        void handleAnswer(grade)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [revealed, handleAnswer])

  if (loading) return <Spinner label="Preparando la sesion" />

  if (!deck) {
    return (
      <EmptyState
        title="Ese mazo ya no existe"
        description="Puede que lo hayas borrado desde otra pestaña."
        action={
          <Link to="/">
            <Button variant="primary">Ver mis mazos</Button>
          </Link>
        }
      />
    )
  }

  if (!current) {
    const done = stats.reviewed > 0
    return (
      <div className="mx-auto max-w-lg space-y-6 text-center">
        <div>
          <h1 className="display text-3xl font-medium text-ink">
            {done ? 'Terminaste por hoy' : 'No queda nada pendiente'}
          </h1>
          <p className="mt-2 text-sm text-ink-2">
            {done
              ? 'Las tarjetas vuelven solas cuando toque repasarlas.'
              : 'Ya alcanzaste el limite diario del mazo, o todo esta programado para mas adelante.'}
          </p>
        </div>

        {done && (
          <Panel className="flex justify-around px-6 py-5 text-left">
            <Stat value={stats.reviewed} label="repasadas" tone="claret" />
            <Stat value={stats.again} label="falladas" />
            <Stat value={formatDuration(stats.timeMs)} label="de estudio" />
          </Panel>
        )}

        <div className="flex justify-center gap-2">
          <Link to="/">
            <Button variant="secondary">Mis mazos</Button>
          </Link>
          <Link to={`/mazo/${deck.id}`}>
            <Button variant="primary">Ver {deck.name}</Button>
          </Link>
        </div>
      </div>
    )
  }

  const { card, note } = current
  const question = card.reverse ? note.back : note.front
  const answer = card.reverse ? note.front : note.back
  const seen = stats.reviewed
  const remaining = queue.length
  const progress = seen + remaining > 0 ? (seen / (seen + remaining)) * 100 : 0

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-11rem)] max-w-2xl flex-col justify-center">
      <div className="flex items-baseline justify-between gap-4">
        <Link
          to={`/mazo/${deck.id}`}
          className="truncate text-sm font-medium text-ink-2 transition hover:text-ink"
        >
          {deck.name}
        </Link>
        <p className="tnum shrink-0 text-sm text-ink-2">
          <span className="font-medium text-ink">{seen}</span> de {seen + remaining}
        </p>
      </div>

      {/* La barra de avance es informacion, no decoracion: reemplaza a las insignias. */}
      <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-rule">
        <div
          className="h-full rounded-full bg-claret transition-[width] duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <Panel
        radius="hero"
        className={cx(
          'relative mt-6 overflow-hidden transition',
          // Antes de responder, tocar la ficha la da vuelta: es como funciona en papel.
          !revealed && 'cursor-pointer hover:-translate-y-0.5',
        )}
      >
        {/* El lomo claret: el detalle memorable de la ficha. */}
        <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-claret" />

        <div
          role={revealed ? undefined : 'button'}
          tabIndex={revealed ? undefined : 0}
          aria-label={revealed ? undefined : 'Mostrar la respuesta'}
          onClick={() => !revealed && setRevealed(true)}
          className="flex min-h-56 flex-col items-center justify-center gap-5 px-8 py-12 text-center focus-visible:outline-none sm:px-14">
          <p className="card-face text-3xl leading-snug whitespace-pre-wrap text-ink sm:text-4xl">
            {question}
          </p>

          {note.hint &&
            !revealed &&
            (showHint ? (
              <p className="max-w-md text-sm whitespace-pre-wrap text-ink-2">{note.hint}</p>
            ) : (
              <button
                onClick={(e) => {
                  // No debe revelar la respuesta: la pista es un paso previo.
                  e.stopPropagation()
                  setShowHint(true)
                }}
                className="rounded text-sm font-medium text-claret transition hover:underline"
              >
                Ver la pista
              </button>
            ))}
        </div>

        {revealed && (
          <div className="animate-reveal border-t border-rule px-8 py-10 text-center sm:px-14">
            <p className="card-face text-2xl leading-snug whitespace-pre-wrap text-ink sm:text-3xl">
              {answer}
            </p>
            {note.extra && (
              <p className="mx-auto mt-5 max-w-md text-sm leading-relaxed whitespace-pre-wrap text-ink-2">
                {note.extra}
              </p>
            )}
            {note.tags.length > 0 && (
              <div className="mt-6 flex flex-wrap justify-center gap-1.5">
                {note.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      <div className="mt-6">
        {!revealed ? (
          <div className="flex justify-center">
            <Button variant="primary" className="px-8" onClick={() => setRevealed(true)}>
              Mostrar respuesta
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {options?.map(({ grade, interval }) => (
              <button
                key={grade}
                onClick={() => void handleAnswer(grade)}
                className={cx(
                  'group rounded-md border border-b-2 border-rule bg-paper px-3 py-3',
                  'shadow-raised transition hover:-translate-y-px hover:border-ink-3',
                  GRADE_RULE[grade],
                )}
              >
                <span className={cx('block text-sm font-semibold', GRADE_TEXT[grade])}>
                  {GRADE_LABELS[grade]}
                </span>
                <span className="tnum mt-0.5 block text-xs text-ink-2">{interval}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="mt-5 text-center text-xs text-ink-3">
        {revealed
          ? 'Teclas 1 a 4 para calificar. Espacio responde Bien.'
          : `Toca la ficha o pulsa Espacio${note.hint ? '. H muestra la pista' : ''}.`}
      </p>
    </div>
  )
}
