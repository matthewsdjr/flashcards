import { api } from '../api/cliente.ts'
import { useConsulta } from '../api/hooks.ts'
import { EmptyState, Panel, SectionHeading, Spinner, Stat } from '../components/ui.tsx'
import { StrengthLegend, StrengthStrip } from '../components/StrengthStrip.tsx'
import { formatDuration } from '../lib/format.ts'
import type { StatsResponse } from '../../shared/tipos.ts'

/** El servidor manda los dias en YYYY-MM-DD; aca solo se acortan para el eje. */
function etiqueta(day: string, indice: number): string {
  if (indice === 0) return 'Hoy'
  const [, mes, dia] = day.split('-')
  return `${Number(dia)}/${Number(mes)}`
}

export default function Stats() {
  const consulta = useConsulta(() => api.get<StatsResponse>('/estadisticas'), [])

  if (consulta.cargando && !consulta.data) return <Spinner />
  if (consulta.error) {
    return <EmptyState title="No se pudo cargar el progreso" description={consulta.error} />
  }

  const data = consulta.data!
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
      <SectionHeading as="h1" title="Tu progreso" description="Ultimos 30 dias en todos los mazos." />

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
        <BarChart buckets={data.history} tone="bg-claret" hoy={false} />
      </div>

      <div>
        <SectionHeading
          title="Lo que viene"
          description="Tarjetas ya programadas para los proximos 14 dias. No incluye las que todavia no viste."
        />
        <BarChart buckets={data.forecast} tone="bg-m-young" hoy />
      </div>
    </div>
  )
}

function BarChart({
  buckets,
  tone,
  hoy,
}: {
  buckets: { day: string; count: number }[]
  tone: string
  hoy: boolean
}) {
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
              title={`${bucket.day}: ${bucket.count}`}
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
            {i % step === 0 || i === buckets.length - 1 ? etiqueta(bucket.day, hoy ? i : -1) : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
