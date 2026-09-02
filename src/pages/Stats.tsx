import { useLiveQuery } from 'dexie-react-hooks'
import { CardState, db, localDay } from '../db/schema'
import { MATURE_DAYS } from '../db/queries'
import { EmptyState, Panel, SectionHeading, Spinner, Stat } from '../components/ui'
import { StrengthLegend, StrengthStrip } from '../components/StrengthStrip'
import { formatDuration } from '../lib/format'

const DAYS_BACK = 30
const FORECAST_DAYS = 14

interface DayBucket {
  day: string
  label: string
  count: number
}

function buildDays(count: number, offset: number): DayBucket[] {
  const out: DayBucket[] = []
  const today = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + offset + i)
    out.push({
      day: localDay(d),
      label: `${d.getDate()}/${d.getMonth() + 1}`,
      count: 0,
    })
  }
  return out
}

export default function Stats() {
  const data = useLiveQuery(async () => {
    const since = Date.now() - DAYS_BACK * 86400000
    const [logs, cards, deckCount] = await Promise.all([
      db.revlog.where('review').above(since).toArray(),
      db.cards.toArray(),
      db.decks.count(),
    ])

    const history = buildDays(DAYS_BACK, -(DAYS_BACK - 1))
    const historyIndex = new Map(history.map((b, i) => [b.day, i]))
    let totalTime = 0
    let again = 0
    for (const log of logs) {
      const index = historyIndex.get(localDay(new Date(log.review)))
      if (index !== undefined) history[index].count++
      totalTime += log.durationMs
      if (log.rating === 1) again++
    }

    const forecast = buildDays(FORECAST_DAYS, 0)
    forecast[0].label = 'Hoy'
    const forecastIndex = new Map(forecast.map((b, i) => [b.day, i]))
    const active = cards.filter((c) => c.suspended === 0)
    for (const card of active) {
      if (card.state === CardState.New) continue
      const index = forecastIndex.get(localDay(new Date(card.due)))
      if (index !== undefined) forecast[index].count++
      else if (card.due < Date.now()) forecast[0].count++
    }

    const review = active.filter((c) => c.state === CardState.Review)
    const strength = {
      new: active.filter((c) => c.state === CardState.New).length,
      learning: active.filter(
        (c) => c.state === CardState.Learning || c.state === CardState.Relearning,
      ).length,
      young: review.filter((c) => c.scheduledDays < MATURE_DAYS).length,
      mature: review.filter((c) => c.scheduledDays >= MATURE_DAYS).length,
    }

    // Dias consecutivos con al menos un repaso, contando hacia atras desde hoy.
    let streak = 0
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].count > 0) streak++
      else if (i < history.length - 1) break
    }

    return {
      history,
      forecast,
      strength,
      deckCount,
      totalCards: cards.length,
      reviews: logs.length,
      accuracy: logs.length > 0 ? 1 - again / logs.length : null,
      totalTime,
      streak,
    }
  }, [])

  if (!data) return <Spinner />

  if (data.deckCount === 0) {
    return (
      <EmptyState
        title="Todavia no hay nada que medir"
        description="En cuanto importes un mazo y hagas la primera sesion, aca vas a ver como avanza."
      />
    )
  }

  return (
    <div className="space-y-10">
      <SectionHeading
        as="h1"
        title="Tu progreso"
        description={`Ultimos ${DAYS_BACK} dias en todos los mazos.`}
      />

      <Panel className="grid grid-cols-2 gap-6 px-6 py-5 sm:grid-cols-4">
        <Stat value={data.reviews} label="repasos hechos" tone="claret" />
        <Stat
          value={data.accuracy === null ? 'sin datos' : `${Math.round(data.accuracy * 100)}%`}
          label="de aciertos"
        />
        <Stat value={formatDuration(data.totalTime)} label="estudiando" />
        <Stat value={data.streak} label={data.streak === 1 ? 'dia seguido' : 'dias seguidos'} />
      </Panel>

      <div>
        <SectionHeading
          title="Que tan consolidado esta lo que sabes"
          description="Cada tarjeta avanza de sin ver a consolidada a medida que la vas acertando con intervalos mas largos."
        />
        <div className="mt-5 space-y-3">
          <StrengthStrip strength={data.strength} height="h-3" />
          <StrengthLegend strength={data.strength} />
        </div>
      </div>

      <div>
        <SectionHeading title="Repasos por dia" />
        <BarChart buckets={data.history} tone="bg-claret" />
      </div>

      <div>
        <SectionHeading
          title="Lo que viene"
          description={`Tarjetas ya programadas para los proximos ${FORECAST_DAYS} dias. No incluye las que todavia no viste.`}
        />
        <BarChart buckets={data.forecast} tone="bg-m-young" />
      </div>
    </div>
  )
}

function BarChart({ buckets, tone }: { buckets: DayBucket[]; tone: string }) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  const step = Math.ceil(buckets.length / 8)

  return (
    <div className="mt-5">
      <div className="flex h-36 items-end gap-1 border-b border-rule">
        {buckets.map((bucket) => (
          <div key={bucket.day} className="flex h-full min-w-0 flex-1 items-end">
            <div
              className={`w-full rounded-t-sm ${tone} ${bucket.count === 0 ? 'opacity-0' : ''}`}
              style={{ height: `${Math.max((bucket.count / max) * 100, 2)}%` }}
              title={`${bucket.label}: ${bucket.count}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1">
        {buckets.map((bucket, i) => (
          <span
            key={bucket.day}
            className="tnum min-w-0 flex-1 truncate text-center text-[10px] text-ink-3"
          >
            {i % step === 0 || i === buckets.length - 1 ? bucket.label : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
