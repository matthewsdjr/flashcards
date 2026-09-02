import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { db, type Card as CardRow, type Deck, type Note } from '../db/schema'
import { answerCard, buildQueue } from '../db/queries'
import {
  GRADES,
  GRADE_CLASSES,
  GRADE_KEYS,
  GRADE_LABELS,
  preview,
  type Grade,
} from '../lib/scheduler'
import { Badge, Button, Card, EmptyState } from '../components/ui'
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

  if (loading) return <p className="text-sm text-slate-500">Cargando sesion...</p>

  if (!deck) {
    return (
      <EmptyState
        title="Mazo no encontrado"
        description="El mazo que intentas estudiar ya no existe."
        action={
          <Link to="/">
            <Button variant="primary">Volver a mis mazos</Button>
          </Link>
        }
      />
    )
  }

  if (!current) {
    return (
      <div className="space-y-6">
        <EmptyState
          title={stats.reviewed > 0 ? 'Sesion terminada' : 'Nada pendiente por ahora'}
          description={
            stats.reviewed > 0
              ? `Repasaste ${stats.reviewed} tarjetas en ${formatDuration(stats.timeMs)}. Fallaste ${stats.again}.`
              : 'Ya alcanzaste el limite diario de este mazo o todas las tarjetas estan programadas para mas adelante.'
          }
          action={
            <div className="flex gap-2">
              <Link to="/">
                <Button variant="secondary">Mis mazos</Button>
              </Link>
              <Link to={`/mazo/${deck.id}`}>
                <Button variant="primary">Ver el mazo</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  const { card, note } = current
  const question = card.reverse ? note.back : note.front
  const answer = card.reverse ? note.front : note.back

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to="/" className="text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            Mazos
          </Link>
          <span className="text-slate-400">/</span>
          <span className="text-sm font-medium">{deck.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="slate">{queue.length} en cola</Badge>
          <Badge tone="emerald">{stats.reviewed} hechas</Badge>
          {card.reverse === 1 && <Badge tone="blue">Inversa</Badge>}
        </div>
      </div>

      <Card className="overflow-hidden">
        <div className="flex min-h-56 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
          <p className="card-content text-2xl font-medium whitespace-pre-wrap">{question}</p>
          {note.hint && !revealed && (
            showHint ? (
              <p className="text-sm text-slate-500 whitespace-pre-wrap">{note.hint}</p>
            ) : (
              <button
                onClick={() => setShowHint(true)}
                className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
              >
                Mostrar pista (H)
              </button>
            )
          )}
        </div>

        {revealed && (
          <div className="border-t border-slate-200 bg-slate-50 px-6 py-10 text-center dark:border-slate-800 dark:bg-slate-950/40">
            <p className="card-content text-2xl font-medium whitespace-pre-wrap">{answer}</p>
            {note.extra && (
              <p className="mx-auto mt-4 max-w-prose text-sm text-slate-500 whitespace-pre-wrap">
                {note.extra}
              </p>
            )}
            {note.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {note.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </Card>

      {!revealed ? (
        <Button variant="primary" className="w-full py-3" onClick={() => setRevealed(true)}>
          Mostrar respuesta
          <span className="text-xs opacity-70">(Espacio)</span>
        </Button>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {options?.map(({ grade, interval }) => (
            <button
              key={grade}
              onClick={() => void handleAnswer(grade)}
              className={cx(
                'flex flex-col items-center gap-0.5 rounded-lg px-3 py-3 text-white transition',
                'focus-visible:outline-2 focus-visible:outline-offset-2',
                GRADE_CLASSES[grade],
              )}
            >
              <span className="text-sm font-semibold">{GRADE_LABELS[grade]}</span>
              <span className="text-xs tabular-nums opacity-90">
                {interval} - tecla {GRADE_KEYS[grade]}
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-slate-400">
        Espacio muestra la respuesta y luego responde Bien. Las teclas 1 a 4 califican directo.
      </p>
    </div>
  )
}
