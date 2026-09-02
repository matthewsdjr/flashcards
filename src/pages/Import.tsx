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
import {
  Button,
  Checkbox,
  Field,
  Panel,
  SectionHeading,
  Stat,
  Tag,
} from '../components/ui'
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
  const [dragging, setDragging] = useState(false)
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
        setError('Ese archivo no tiene filas con datos. Revisa que no este vacio.')
        setParsed(null)
        return
      }
      setFilename(file.name)
      setParsed(data)
      setMapping(guessMapping(data.headers, data.hasHeader))
      if (!newDeckName) setNewDeckName(file.name.replace(/\.(tsv|csv|txt)$/i, ''))
    } catch {
      setError('No se pudo leer el archivo. Tiene que ser un archivo de texto.')
    }
  }

  const extraTags = useMemo(() => splitTags(tagsInput), [tagsInput])

  const previewNotes = useMemo(() => {
    if (!parsed) return []
    return parsed.rows.slice(0, 4).map((row) => rowToNote(row, mapping, extraTags))
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
        deckId = await createDeck(newDeckName, `Importado de ${filename}`, { generateReverse })
      } else {
        deckId = Number(deckChoice)
        await db.decks.update(deckId, { 'config.generateReverse': generateReverse })
      }
      const res = await importRows({ deckId, rows: parsed.rows, mapping, onDuplicate, extraTags })
      setResult({ ...res, deckId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'La importacion no se completo')
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
      <div className="mx-auto max-w-md space-y-7 text-center">
        <div>
          <h1 className="display text-3xl font-medium">Listo para estudiar</h1>
          <p className="mt-2 text-sm text-ink-2">
            {result.added > 0
              ? `Se agregaron ${result.added} notas al mazo.`
              : 'No habia nada nuevo que agregar.'}
          </p>
        </div>

        <Panel className="grid grid-cols-3 gap-4 px-6 py-5 text-left">
          <Stat value={result.cardsCreated} label="tarjetas creadas" tone="claret" />
          <Stat value={result.skipped} label="duplicadas" />
          <Stat value={result.invalid} label="descartadas" />
        </Panel>

        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={reset}>
            Importar otro
          </Button>
          <Button variant="primary" onClick={() => navigate(`/estudiar/${result.deckId}`)}>
            Empezar a estudiar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <SectionHeading
        as="h1"
        title="Importar tarjetas"
        description="Acepta TSV, CSV y archivos separados por punto y coma o barra vertical. El separador se detecta solo, y el preambulo que agrega Anki se ignora."
      />

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void handleFile(file)
        }}
        className={cx(
          'rounded-lg border border-dashed px-6 py-12 text-center transition',
          dragging ? 'border-claret bg-claret-soft' : 'border-rule bg-paper',
        )}
      >
        <p className="text-sm text-ink-2">Arrastra tu archivo hasta aca</p>
        <div className="mt-4">
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
        {filename && parsed && (
          <p className="tnum mt-4 text-xs text-ink-2">
            {filename} · {parsed.rows.length} filas · {delimiterName(parsed.delimiter)}
            {parsed.hasHeader && ' · con encabezado'}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {parsed?.errors.map((e) => (
        <p key={e} className="text-xs text-hard">
          {e}
        </p>
      ))}

      {parsed && (
        <>
          <div>
            <SectionHeading
              title="Que es cada columna"
              description="Frente y reverso son obligatorios. Si dos columnas comparten rol, su contenido se une."
            />
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-125 text-left text-sm">
                <thead>
                  <tr className="border-b border-rule text-xs text-ink-2">
                    <th className="py-2 pr-4 font-medium">Columna</th>
                    <th className="py-2 pr-4 font-medium">Primer valor</th>
                    <th className="py-2 font-medium">Rol</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.headers.map((header, index) => (
                    <tr key={index} className="border-b border-rule-soft">
                      <td className="py-2.5 pr-4 font-medium text-ink">{header}</td>
                      <td className="max-w-70 truncate py-2.5 pr-4 text-ink-2">
                        {parsed.rows[0]?.[index] || <span className="text-ink-3">vacio</span>}
                      </td>
                      <td className="py-2.5">
                        <select
                          aria-label={`Rol de la columna ${header}`}
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
              <p className="mt-3 text-sm text-danger">
                Falta asignar {!hasFront ? 'el frente' : 'el reverso'}. Sin las dos caras no hay
                tarjeta que estudiar.
              </p>
            )}
          </div>

          <Panel className="space-y-5 p-5">
            <h2 className="display text-lg font-medium">Donde van y con que etiquetas</h2>
            <div className="grid gap-5 sm:grid-cols-2">
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
                <Field label="Nombre del mazo">
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
                  <option value="skip">Saltear la fila</option>
                  <option value="update">Actualizar pista, notas y etiquetas</option>
                  <option value="add">Agregarla igual</option>
                </select>
              </Field>

              <Field label="Etiquetas para todo el lote" hint="Separadas por espacio o coma.">
                <input
                  className={inputClass}
                  value={tagsInput}
                  onChange={(e) => setTagsInput(e.target.value)}
                  placeholder="parcial1 biologia"
                />
              </Field>
            </div>

            <Checkbox
              checked={generateReverse}
              onChange={setGenerateReverse}
              label="Generar tambien la tarjeta inversa"
              hint="Agrega una segunda tarjeta que pregunta al reves. Duplica lo que vas a estudiar."
            />
          </Panel>

          <div>
            <SectionHeading
              title="Asi van a quedar"
              actions={
                <span
                  className={cx(
                    'tnum text-sm font-medium',
                    validCount > 0 ? 'text-ink' : 'text-danger',
                  )}
                >
                  {validCount} de {parsed.rows.length} filas utiles
                </span>
              }
            />
            <ul className="mt-5 space-y-2">
              {previewNotes.map((note, i) => (
                <li key={i} className="rounded-lg border border-rule bg-paper px-4 py-3">
                  <p className="card-face text-base text-ink">
                    {note.front || <span className="text-danger">falta el frente</span>}
                  </p>
                  <p className="mt-1 text-sm text-ink-2">
                    {note.back || <span className="text-danger">falta el reverso</span>}
                  </p>
                  {note.hint && <p className="mt-1.5 text-xs text-ink-3">Pista: {note.hint}</p>}
                  {note.tags.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {note.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-rule pt-6">
            <Link to="/">
              <Button variant="ghost">Cancelar</Button>
            </Link>
            <Button variant="primary" disabled={!canImport} onClick={() => void handleImport()}>
              {busy ? 'Importando' : `Importar ${validCount} tarjetas`}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
