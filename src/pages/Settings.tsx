import { useRef, useState } from 'react'
import { db } from '../db/schema'
import { downloadBackup, exportBackup, restoreBackup } from '../lib/backup'
import { Button, Card } from '../components/ui'

export default function Settings() {
  const fileInput = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [replace, setReplace] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)

  async function handleRestore(file: File) {
    setError('')
    setMessage('')
    try {
      const raw = JSON.parse(await file.text())
      const result = await restoreBackup(raw, replace)
      setMessage(
        `Restaurados ${result.decks} mazos, ${result.notes} notas y ${result.cards} tarjetas.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo restaurar el respaldo')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-slate-500">
          Todo se guarda en este navegador (IndexedDB). Nada se envia a un servidor. Si borras los
          datos del sitio o cambias de equipo, vas a necesitar un respaldo.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="text-base font-semibold">Respaldo</h2>
        <p className="mt-1 text-sm text-slate-500">
          Exporta todos los mazos, tarjetas y el historial de repasos en un solo archivo JSON.
        </p>
        <div className="mt-4">
          <Button
            variant="primary"
            onClick={async () => {
              downloadBackup(await exportBackup())
              setMessage('Respaldo descargado.')
            }}
          >
            Descargar respaldo
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold">Restaurar</h2>
        <p className="mt-1 text-sm text-slate-500">
          Carga un respaldo generado por esta app. Por defecto se suma a lo que ya tenes.
        </p>
        <label className="mt-3 flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
          />
          Reemplazar todo el contenido actual en lugar de sumarlo
        </label>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            Elegir archivo de respaldo
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleRestore(file)
            }}
          />
        </div>
      </Card>

      <Card className="border-rose-200 p-5 dark:border-rose-900">
        <h2 className="text-base font-semibold text-rose-700 dark:text-rose-400">
          Borrar todos los datos
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Elimina todos los mazos y el historial de este navegador. Descarga un respaldo antes.
        </p>
        <div className="mt-4 flex gap-2">
          {confirmWipe ? (
            <>
              <Button
                variant="danger"
                onClick={async () => {
                  await db.delete()
                  window.location.reload()
                }}
              >
                Si, borrar todo
              </Button>
              <Button variant="ghost" onClick={() => setConfirmWipe(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmWipe(true)}>
              Borrar todo
            </Button>
          )}
        </div>
      </Card>

      {message && <p className="text-sm text-emerald-600">{message}</p>}
      {error && <p className="text-sm text-rose-600">{error}</p>}

      <Card className="p-5">
        <h2 className="text-base font-semibold">Formato de importacion</h2>
        <p className="mt-1 text-sm text-slate-500">
          El importador acepta TSV, CSV y archivos separados por punto y coma o barra vertical.
          Ignora el preambulo <code>#separator:tab</code> que agrega Anki. Ejemplo minimo:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100">
{`Front\tBack\tTags
mitocondria\torganelo que produce ATP\tbiologia celula
ribosoma\tsintetiza proteinas\tbiologia`}
        </pre>
      </Card>
    </div>
  )
}
