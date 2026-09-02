import { useRef, useState } from 'react'
import { api, descargar } from '../api/cliente.ts'
import { useAccion, useConsulta } from '../api/hooks.ts'
import { useSesion } from '../auth/SesionContext.tsx'
import { Button, Field, Panel, SectionHeading } from '../components/ui.tsx'
import { inputClass } from '../lib/classnames.ts'
import { formatDate } from '../lib/format.ts'
import type { ImportRecord } from '../../shared/tipos.ts'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Settings() {
  const { usuario } = useSesion()
  const fileInput = useRef<HTMLInputElement>(null)
  const [mensaje, setMensaje] = useState('')

  const importaciones = useConsulta(
    () => api.get<{ imports: ImportRecord[] }>('/importaciones'),
    [],
  )
  const { ejecutar, enviando, error, setError } = useAccion()

  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  async function restaurar(file: File) {
    setMensaje('')
    const texto = await file.text()
    let payload: unknown
    try {
      payload = JSON.parse(texto)
    } catch {
      setError('Ese archivo no es un JSON valido')
      return
    }
    const cuerpo = payload as { decks?: unknown; notes?: unknown }
    const resultado = await ejecutar(() =>
      api.post<{ decks: number; notes: number; cards: number }>('/respaldo', {
        decks: cuerpo.decks,
        notes: cuerpo.notes,
      }),
    )
    if (resultado) {
      setMensaje(
        `Se agregaron ${resultado.decks} mazos con ${resultado.cards} tarjetas a tu cuenta.`,
      )
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  async function cambiarContrasena(event: React.FormEvent) {
    event.preventDefault()
    setMensaje('')
    const ok = await ejecutar(() => api.post('/auth/contrasena', { password, newPassword }))
    if (ok !== undefined) {
      setPassword('')
      setNewPassword('')
      setMensaje('Contraseña cambiada. Se cerraron las demas sesiones abiertas.')
    }
  }

  return (
    <div className="space-y-10">
      <SectionHeading
        as="h1"
        title="Ajustes"
        description={`Sesion iniciada como ${usuario?.email}. Tus mazos viven en el servidor, asi que los tenes en cualquier dispositivo donde entres.`}
      />

      <Panel className="p-5">
        <h2 className="display text-lg font-medium">Archivos que importaste</h2>
        <p className="mt-1.5 max-w-prose text-sm text-ink-2">
          Se guarda el archivo original de cada importacion. Podes volver a descargarlo o
          reimportarlo con otro mapeo de columnas.
        </p>

        {importaciones.data && importaciones.data.imports.length > 0 ? (
          <ul className="mt-5 border-t border-rule">
            {importaciones.data.imports.map((registro) => (
              <li key={registro.id} className="group flex items-center gap-4 border-b border-rule py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{registro.filename}</p>
                  <p className="tnum mt-0.5 text-xs text-ink-2">
                    {formatDate(registro.createdAt)} · {formatBytes(registro.bytes)} ·{' '}
                    {registro.rows} filas · {registro.added} agregadas
                    {registro.deckName && ` · ${registro.deckName}`}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs"
                    onClick={() =>
                      void descargar(`/importaciones/${registro.id}/archivo`, registro.filename)
                    }
                  >
                    Descargar
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-xs text-danger"
                    onClick={async () => {
                      await ejecutar(() => api.delete(`/importaciones/${registro.id}`))
                      importaciones.recargar()
                    }}
                  >
                    Borrar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 text-sm text-ink-3">Todavia no importaste ningun archivo.</p>
        )}
      </Panel>

      <Panel className="p-5">
        <h2 className="display text-lg font-medium">Respaldo</h2>
        <p className="mt-1.5 max-w-prose text-sm text-ink-2">
          Un archivo JSON con todos tus mazos, tarjetas e historial. Al restaurarlo, el contenido se
          suma a tu cuenta como mazos nuevos.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => void descargar('/respaldo', 'flashcards.json')}
          >
            Descargar respaldo
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={enviando}>
            {enviando ? 'Subiendo' : 'Restaurar desde un archivo'}
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void restaurar(file)
            }}
          />
        </div>
      </Panel>

      <Panel className="p-5">
        <h2 className="display text-lg font-medium">Cambiar la contraseña</h2>
        <form onSubmit={cambiarContrasena} className="mt-4 grid max-w-md gap-4">
          <Field label="Contraseña actual">
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="Contraseña nueva" hint="Al menos 10 caracteres, con letras y numeros.">
            <input
              type="password"
              className={inputClass}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>
          <div>
            <Button type="submit" variant="secondary" disabled={enviando}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      </Panel>

      {mensaje && <p className="text-sm text-good">{mensaje}</p>}
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
    </div>
  )
}
