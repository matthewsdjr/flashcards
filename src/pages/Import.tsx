import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { createDeck } from '../db/queries'
import {
  FIELD_ROLE_LABELS,
  delimiterName,
  guessMapping,
  parseDelimited,
  splitTags,
  type FieldRole,
  type ParsedFile,
} from '../lib/parse'
import { importRows, rowToNote, type ImportResult } from '../lib/import'
import { Badge, Button, Card, Field } from '../components/ui'
import { cx, inputClass } from '../lib/classnames'

const NEW_DECK = '__new__'

export default function Import() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fileInput = useRef<HTMLInputElement>(null)

  const decks = useLiveQuery(() => db.decks.orderBy('name').toArray(), [])

  const [filename, setFilename] = useState('')
  const [parsed, setParsed] = useState<ParsedFile | null>(null)
  const [mapping, setMapping] = useState<FieldRole[]>([])
  const [deckChoice, setDeckChoice] = useState(searchParams.get('deck') ?? NEW_DECK)
  const [newDeckName, setNewDeckName] = useState('')
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update' | 'add'>('skip')
  const [tagsInput, setTagsInput] = useState('')
  const [generateReverse, setGenerateReverse] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<(ImportResult & { deckId: number }) | null>(null)
  const [error, setError] = useState('')

  async function handleFile(file: File) {
    setError('')
    setResult(null)
    try {
      const text = await file.text()
      const data = parseDelimited(text)
      if (data.rows.length === 0) {
        setError('No se encontraron filas con datos en el archivo.')
        setParsed(null)
        return
      }
      setFilename(file.name)
      setParsed(data)
      setMapping(guessMapping(data.headers, data.hasHeader))
      if (!newDeckName) setNewDeckName(file.name.replace(/\.(tsv|csv|txt)$/i, ''))
    } catch {
      setError('No se pudo leer el archivo. Verifica que sea un archivo de texto.')
    }
  }

  const extraTags = useMemo(() => splitTags(tagsInput), [tagsInput])

  const previewNotes = useMemo(() => {
    if (!parsed) return []
    return parsed.rows.slice(0, 5).map((row) => rowToNote(row, mapping, extraTags))
  }, [parsed, mapping, extraTags])

  const validCount = useMemo(() => {
    if (!parsed) return 0
    return parsed.rows.filter((row) => {
      const note = rowToNote(row, mapping, extraTags)
      return note.front && note.back
    }).length
  }, [parsed, mapping, extraTags])

  const hasFront = mapping.includes('front')
  const hasBack = mapping.includes('back')
  const deckNameOk = deckChoice !== NEW_DECK || newDeckName.trim().length > 0
  const canImport = Boolean(parsed) && hasFront && hasBack && validCount > 0 && deckNameOk && !busy

  async function handleImport() {
    if (!parsed) return
    setBusy(true)
    setError('')
    try {
      let deckId: number
      if (deckChoice === NEW_DECK) {
        deckId = await createDeck(newDeckName, `Importado desde ${filename}`, { generateReverse })
      } else {
        deckId = Number(deckChoice)
        await db.decks.update(deckId, { 'config.generateReverse': generateReverse })
      }
      const res = await importRows({
        deckId,
        rows: parsed.rows,
        mapping,
        onDuplicate,
        extraTags,
      })
      setResult({ ...res, deckId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fallo la importacion')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setParsed(null)
    setResult(null)
    setFilename('')
    setError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  if (result) {
    return (
      <Card className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold">Importacion completada</h1>
        <dl className="mt-6 grid grid-cols-2 gap-3 text-left text-sm">
          <Stat label="Notas agregadas" value={result.added} />
          <Stat label="Tarjetas creadas" value={result.cardsCreated} />
          <Stat label="Actualizadas" value={result.updated} />
          <Stat label="Duplicadas omitidas" value={result.skipped} />
          <Stat label="Filas invalidas" value={result.invalid} />
        </dl>
        <div className="mt-7 flex justify-center gap-2">
          <Button variant="secondary" onClick={reset}>
            Importar otro
          </Button>
          <Button variant="primary" onClick={() => navigate(`/estudiar/${result.deckId}`)}>
            Empezar a estudiar
          </Button>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Importar tarjetas</h1>
        <p className="mt-1 text-sm text-slate-500">
          Acepta TSV (el formato que exporta Anki), CSV y archivos separados por punto y coma o
          barra vertical. El separador se detecta solo.
        </p>
      </div>

      <Card className="p-5">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (file) void handleFile(file)
          }}
          className="rounded-lg border-2 border-dashed border-slate-300 px-6 py-10 text-center dark:border-slate-700"
        >
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Arrastra el archivo aca o
          </p>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Elegir archivo
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".tsv,.csv,.txt,text/plain,text/csv,text/tab-separated-values"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          {filename && (
            <p className="mt-3 text-xs text-slate-500">
              {filename}
              {parsed && (
                <>
                  {' '}
                  - {parsed.rows.length} filas - {delimiterName(parsed.delimiter)}
                  {parsed.hasHeader && ' - con encabezado'}
                </>
              )}
            </p>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
        {parsed?.errors.map((e) => (
          <p key={e} className="mt-2 text-xs text-amber-600">
            {e}
          </p>
        ))}
      </Card>

      {parsed && (
        <>
          <Card className="p-5">
            <h2 className="text-base font-semibold">Mapeo de columnas</h2>
            <p className="mt-1 text-sm text-slate-500">
              Indica que representa cada columna. Frente y reverso son obligatorios; si asignas el
              mismo rol a dos columnas, su contenido se une.
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-125 text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-800">
                    <th className="py-2 pr-4 font-medium">Columna</th>
                    <th className="py-2 pr-4 font-medium">Ejemplo</th>
                    <th className="py-2 font-medium">Rol</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.headers.map((header, index) => (
                    <tr
                      key={index}
                      className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                    >
                      <td className="py-2 pr-4 font-medium">{header}</td>
                      <td className="max-w-70 truncate py-2 pr-4 text-slate-500">
                        {parsed.rows[0]?.[index] || <span className="italic">vacio</span>}
                      </td>
                      <td className="py-2">
                        <select
                          className={cx(inputClass, 'max-w-56')}
                          value={mapping[index] ?? 'ignore'}
                          onChange={(e) => {
                            const next = [...mapping]
                            next[index] = e.target.value as FieldRole
                            setMapping(next)
                          }}
                        >
                          {(Object.keys(FIELD_ROLE_LABELS) as FieldRole[]).map((role) => (
                            <option key={role} value={role}>
                              {FIELD_ROLE_LABELS[role]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(!hasFront || !hasBack) && (
              <p className="mt-3 text-sm text-rose-600">
                Asigna al menos una columna al frente y otra al reverso.
              </p>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="text-base font-semibold">Destino y opciones</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Mazo de destino">
                <select
                  className={inputClass}
                  value={deckChoice}
                  onChange={(e) => setDeckChoice(e.target.value)}
                >
                  <option value={NEW_DECK}>Crear un mazo nuevo</option>
                  {decks?.map((deck) => (
                    <option key={deck.id} value={String(deck.id)}>
                      {deck.name}
                    </option>
                  ))}
                </select>
              </Field>

              {deckChoice === NEW_DECK && (
                <Field label="Nombre del mazo nuevo">
                  <input
                    className={inputClass}
                    value={newDeckName}
                    onChange={(e) => setNewDeckName(e.target.value)}
                  />
                </Field>
              )}

              <Field label="Si la tarjeta ya existe" hint="Se comparan frente y reverso.">
                <select
                  className={inputClass}
                  value={onDuplicate}
                  onChange={(e) => setOnDuplicate(e.target.value as typeof onDuplicate)}
                >
                  <option value="skip">Omitir la fila</option>
                  <option value="update">Actualizar pista, notas y etiquetas</option>
                  <option value="add">Importar igual (permite duplicados)</option>
                </select>
              </Field>

              <Field label="Etiquetas para todas las notas" hint="Separadas por espacio o coma.">
                <input
                  className={inputClass}
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="parcial1 biologia"
                />
              </Field>
            </div>

            <label className="mt-4 flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={generateReverse}
                onChange={(e) => setGenerateReverse(e.target.checked)}
              />
              <span>
                Generar tambien la tarjeta inversa
                <span className="block text-xs text-slate-500">
                  Crea una segunda tarjeta que muestra el reverso como pregunta. Duplica la
                  cantidad de tarjetas a estudiar.
                </span>
              </span>
            </label>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Vista previa</h2>
              <Badge tone={validCount > 0 ? 'emerald' : 'rose'}>
                {validCount} de {parsed.rows.length} filas validas
              </Badge>
            </div>
            <ul className="mt-4 space-y-2">
              {previewNotes.map((note, i) => (
                <li
                  key={i}
                  className="rounded-lg bg-slate-50 px-4 py-3 text-sm dark:bg-slate-800/50"
                >
                  <p className="font-medium">{note.front || <em className="text-rose-600">sin frente</em>}</p>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                    {note.back || <em className="text-rose-600">sin reverso</em>}
                  </p>
                  {note.hint && <p className="mt-1 text-xs text-slate-500">Pista: {note.hint}</p>}
                  {note.extra && <p className="mt-1 text-xs text-slate-500">{note.extra}</p>}
                  {note.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {note.tags.map((tag) => (
                        <Badge key={tag}>{tag}</Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <Link to="/">
              <Button variant="ghost">Cancelar</Button>
            </Link>
            <Button variant="primary" disabled={!canImport} onClick={() => void handleImport()}>
              {busy ? 'Importando...' : `Importar ${validCount} tarjetas`}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800/50">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
