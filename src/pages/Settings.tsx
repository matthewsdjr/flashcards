import { useRef, useState } from 'react'
import { db } from '../db/schema'
import { downloadBackup, exportBackup, restoreBackup } from '../lib/backup'
import { Button, Checkbox, Panel, SectionHeading } from '../components/ui'

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
        `Se restauraron ${result.decks} mazos, ${result.notes} notas y ${result.cards} tarjetas.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ese archivo no se pudo restaurar')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div className="space-y-10">
      <SectionHeading
        as="h1"
        title="Ajustes"
        description="Todo vive en este navegador. Nada viaja a un servidor, asi que el respaldo es tu unica copia si cambias de equipo o limpias los datos del sitio."
      />

      <Panel className="p-5">
        <h2 className="display text-lg font-medium">Respaldo</h2>
        <p className="mt-1.5 max-w-prose text-sm text-ink-2">
          Un archivo JSON con todos los mazos, las tarjetas y el historial de repasos.
        </p>
        <div className="mt-5">
          <Button
            variant="primary"
            onClick={async () => {
              downloadBackup(await exportBackup())
              setError('')
              setMessage('Respaldo descargado.')
            }}
          >
            Descargar respaldo
          </Button>
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="display text-lg font-medium">Restaurar</h2>
        <p className="mt-1.5 max-w-prose text-sm text-ink-2">
          Carga un respaldo hecho con esta app. Por defecto se suma a lo que ya tenes.
        </p>
        <div className="mt-4">
          <Checkbox
            checked={replace}
            onChange={setReplace}
            label="Reemplazar todo en lugar de sumar"
            hint="Borra los mazos actuales antes de cargar el archivo."
          />
        </div>
        <div className="mt-5">
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            Elegir respaldo
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
      </Panel>

      {message && <p className="text-sm text-good">{message}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      <Panel className="p-5">
        <h2 className="display text-lg font-medium">Como armar el archivo</h2>
        <p className="mt-1.5 max-w-prose text-sm text-ink-2">
          Con dos columnas alcanza: pregunta y respuesta. Las columnas se reconocen por su nombre, y
          si el archivo no trae encabezado se toma la primera como frente y la segunda como reverso.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-rule bg-panel p-4 text-xs text-ink">
          {`Front\tBack\tTags
mitocondria\torganelo que produce ATP\tbiologia celula
ribosoma\tsintetiza proteinas\tbiologia`}
        </pre>
      </Panel>

      <Panel className="p-5">
        <h2 className="display text-lg font-medium text-danger">Borrar todo</h2>
        <p className="mt-1.5 max-w-prose text-sm text-ink-2">
          Elimina los mazos y el historial de este navegador. Descarga un respaldo antes si pensas
          volver a usarlos.
        </p>
        <div className="mt-5 flex gap-2">
          {confirmWipe ? (
            <>
              <Button
                variant="danger"
                onClick={async () => {
                  await db.delete()
                  window.location.reload()
                }}
              >
                Borrar todos los datos
              </Button>
              <Button variant="ghost" onClick={() => setConfirmWipe(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmWipe(true)}>
              Borrar todo
            </Button>
          )}
        </div>
      </Panel>
    </div>
  )
}
