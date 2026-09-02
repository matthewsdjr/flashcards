import { useEffect, useState } from 'react'
import { api } from '../api/cliente.ts'
import { useAccion } from '../api/hooks.ts'
import {
  borrarDatosLocales,
  descartarMigracion,
  leerDatosLocales,
  type DatosLocales,
} from '../lib/migracion.ts'
import { Button, Panel } from './ui.tsx'
import { pluralize } from '../lib/format.ts'

/**
 * Si el navegador todavia guarda mazos de la version sin cuentas, ofrece
 * subirlos. Al terminar borra la copia local para no dejar dos verdades.
 */
export function AvisoMigracion({ onMigrado }: { onMigrado: () => void }) {
  const [datos, setDatos] = useState<DatosLocales | null>(null)
  const [listo, setListo] = useState<string | null>(null)
  const { ejecutar, enviando, error } = useAccion()

  useEffect(() => {
    void leerDatosLocales().then(setDatos)
  }, [])

  if (!datos) return null

  if (listo) {
    return (
      <Panel className="border-l-2 border-l-m-mature p-5">
        <p className="text-sm text-ink">{listo}</p>
      </Panel>
    )
  }

  async function migrar() {
    if (!datos) return
    const resultado = await ejecutar(() =>
      api.post<{ decks: number; notes: number; cards: number }>('/respaldo', {
        decks: datos.decks,
        notes: datos.notes,
      }),
    )
    if (!resultado) return
    await borrarDatosLocales()
    setDatos(null)
    setListo(
      `Listo: ${pluralize(resultado.decks, 'mazo subido', 'mazos subidos')} con ${resultado.cards} tarjetas. Ya estan en tu cuenta.`,
    )
    onMigrado()
  }

  function descartar() {
    descartarMigracion()
    setDatos(null)
  }

  const totalNotas = datos.notes.length

  return (
    <Panel className="border-l-2 border-l-claret p-5">
      <h2 className="display text-lg font-medium text-ink">
        Encontramos mazos guardados en este navegador
      </h2>
      <p className="mt-1.5 max-w-prose text-sm text-ink-2">
        Son de la version anterior, la que guardaba todo localmente:{' '}
        {pluralize(datos.decks.length, 'mazo', 'mazos')} con{' '}
        {pluralize(totalNotas, 'tarjeta', 'tarjetas')}. Podes subirlos a tu cuenta para tenerlos en
        cualquier dispositivo. El historial de repasos no se conserva, las tarjetas empiezan como
        nuevas.
      </p>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void migrar()} disabled={enviando}>
          {enviando ? 'Subiendo' : 'Subir a mi cuenta'}
        </Button>
        <Button variant="ghost" onClick={descartar} disabled={enviando}>
          No, gracias
        </Button>
      </div>
    </Panel>
  )
}
