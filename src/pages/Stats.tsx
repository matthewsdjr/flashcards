import { useLiveQuery } from 'dexie-react-hooks'
import { CardState, db, localDay } from '../db/schema'
import { Card, EmptyState } from '../components/ui'
import { formatDuration } from '../lib/format'

const DAYS_BACK = 30
const FORECAST_DAYS = 14

interface DayBucket {
  day: string
  label: string
  count: number
}

function lastDays(n: number): DayBucket[] {
  const out: DayBucket[] = []
  const today = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push({ day: localDay(d), label: `${d.getDate()}/${d.getMonth() + 1}`, count: 0 })
  }
  return out
}

function nextDays(n: number): DayBucket[] {
  const out: DayBucket[] = []
  const today = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    out.push({ day: localDay(d), label: i === 0 ? 'Hoy' : `${d.getDate()}/${d.getMonth() + 1}`, count: 0 })
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

    const history = lastDays(DAYS_BACK)
    const historyIndex = new Map(history.map((b, i) => [b.day, i]))
    let totalTime = 0
    let again = 0
    for (const log of logs) {
      const index = historyIndex.get(localDay(new Date(log.review)))
      if (index !== undefined) history[index].count++
      totalTime += log.durationMs
      if (log.rating === 1) again++
    }

    const forecast = nextDays(FORECAST_DAYS)
    const forecastIndex = new Map(forecast.map((b, i) => [b.day, i]))
    const active = cards.filter((c) => c.suspended === 0)
    for (const card of active) {
      if (card.state === CardState.New) continue
      const index = forecastIndex.get(localDay(new Date(card.due)))
      if (index !== undefined) forecast[index].count++
      else if (card.due < Date.now()) forecast[0].count++
    }

    const mature = active.filter(
      (c) => c.state === CardState.Review && c.scheduledDays >= 21,
    ).length

    return {
      history,
      forecast,
      deckCount,
      totalCards: cards.length,
      reviews: logs.length,
      accuracy: logs.length > 0 ? 1 - again / logs.length : null,
      totalTime,
      mature,
      newCount: active.filter((c) => c.state === CardState.New).length,
    }
  }, [])

  if (!data) return <p className="text-sm text-slate-500">Cargando...</p>

  if (data.deckCount === 0) {
    return (
      <EmptyState
        title="Sin datos todavia"
        description="Las estadisticas aparecen cuando importas un mazo y empezas a repasar."
      />
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Estadisticas</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Repasos (30 dias)" value={String(data.reviews)} />
        <Metric
          label="Aciertos"
          value={data.accuracy === null ? '-' : `${Math.round(data.accuracy * 100)}%`}
        />
        <Metric label="Tiempo de estudio" value={formatDuration(data.totalTime)} />
        <Metric label="Tarjetas maduras" value={`${data.mature} / ${data.totalCards}`} />
      </div>

      <Card className="p-5">
        <h2 className="text-base font-semibold">Repasos por dia</h2>
        <p className="mt-1 text-sm text-slate-500">Ultimos {DAYS_BACK} dias.</p>
        <BarChart buckets={data.history} color="bg-indigo-500" />
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold">Carga proxima</h2>
        <p className="mt-1 text-sm text-slate-500">
          Tarjetas programadas para los proximos {FORECAST_DAYS} dias. No incluye las nuevas
          ({data.newCount} sin introducir).
        </p>
        <BarChart buckets={data.forecast} color="bg-emerald-500" />
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  )
}

function BarChart({ buckets, color }: { buckets: DayBucket[]; color: string }) {
  const max = Math.max(1, ...buckets.map((b) => b.count))
  return (
    <div className="mt-5 flex h-40 items-end gap-1">
      {buckets.map((bucket) => (
        <div key={bucket.day} className="group flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex w-full flex-1 items-end">
            <div
              className={`w-full rounded-t ${color} transition group-hover:opacity-80`}
              style={{ height: `${(bucket.count / max) * 100}%`, minHeight: bucket.count ? 2 : 0 }}
              title={`${bucket.label}: ${bucket.count}`}
            />
          </div>
          <span className="truncate text-[10px] tabular-nums text-slate-400">{bucket.label}</span>
        </div>
      ))}
    </div>
  )
}
