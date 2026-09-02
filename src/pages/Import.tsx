import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/cliente.ts'
import { useAccion, useConsulta } from '../api/hooks.ts'
import {
  Button,
  Checkbox,
  Field,
  Panel,
  SectionHeading,
  Stat,
  Tag,
} from '../components/ui.tsx'
import { cx, inputClass } from '../lib/classnames.ts'
import { FIELD_ROLE_LABELS, delimiterName, guessMapping, splitTags, type FieldRole } from '../../shared/parse.ts'
import type { DeckWithStats } from '../../shared/tipos.ts'

const NEW_DECK = '__new__'

interface Analisis {
  importId: number
  filename: string
  bytes: number
  headers: string[]
  hasHeader: boolean
  delimiter: string
  errors: string[]
  sample: string[][]
  totalRows: number
}

interface Resultado {
  added: number
  updated: number
  skipped: number
  invalid: number
  cardsCreated: number
  deckId: number
  deckName: string
}

/** Vista previa local de una fila, con el mapeo elegido. */
function previewRow(row: string[], mapping: FieldRole[], extraTags: string[]) {
  const parts: Record<'front' | 'back' | 'hint' | 'extra', string[]> = {
    front: [],
    back: [],
    hint: [],
    extra: [],
  }
  const tags = [...extraTags]
  mapping.forEach((role, index) => {
    const value = (row[index] ?? '').trim()
    if (!value || role === 'ignore') return
    if (role === 'tags') tags.push(...splitTags(value))
    else parts[role].push(value)
  })
  return {
    front: parts.front.join('\n'),
    back: parts.back.join('\n'),
    hint: parts.hint.join('\n'),
    extra: parts.extra.join('\n'),
    tags: [...new Set(tags)],
  }
}

export default function Import() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const fileInput = useRef<HTMLInputElement>(null)

  const mazos = useConsulta(() => api.get<{ decks: DeckWithStats[] }>('/mazos'), [])
  const { ejecutar, enviando, error, setError } = useAccion()

  const [analisis, setAnalisis] = useState<Analisis | null>(null)
  const [mapping, setMapping] = useState<FieldRole[]>([])
  const [dragging, setDragging] = useState(false)
  const [deckChoice, setDeckChoice] = useState(searchParams.get('deck') ?? NEW_DECK)
  const [newDeckName, setNewDeckName] = useState('')
  const [onDuplicate, setOnDuplicate] = useState<'skip' | 'update' | 'add'>('skip')
  const [tagsInput, setTagsInput] = useState('')
  const [generateReverse, setGenerateReverse] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  async function subir(file: File) {
    setResultado(null)
    const form = new FormData()
    form.append('archivo', file)
    const data = await ejecutar(() => api.post<Analisis>('/importaciones/analizar', form))
    if (!data) return
    setAnalisis(data)
    setMapping(guessMapping(data.headers, data.hasHeader))
    if (!newDeckName) setNewDeckName(data.filename.replace(/\.(tsv|csv|txt)$/i, ''))
  }

  const extraTags = useMemo(() => splitTags(tagsInput), [tagsInput])

  const previews = useMemo(
    () => (analisis?.sample ?? []).slice(0, 4).map((row) => previewRow(row, mapping, extraTags)),
    [analisis, mapping, extraTags],
  )

  const hasFront = mapping.includes('front')
  const hasBack = mapping.includes('back')
  const deckNameOk = deckChoice !== NEW_DECK || newDeckName.trim().length > 0
  const canImport = Boolean(analisis) && hasFront && hasBack && deckNameOk && !enviando

  async function confirmar() {
    if (!analisis) return
    const data = await ejecutar(() =>
      api.post<Resultado>('/importaciones/confirmar', {
        importId: analisis.importId,
        deckId: deckChoice === NEW_DECK ? null : Number(deckChoice),
        newDeckName,
        mapping,
        onDuplicate,
        tags: tagsInput,
        generateReverse,
      }),
    )
    if (data) setResultado(data)
  }

  function reset() {
    setAnalisis(null)
    setResultado(null)
    setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }

  if (resultado) {
    return (
      <div className="mx-auto max-w-md space-y-7 text-center">
        <div>
          <h1 className="display text-3xl font-medium">Listo para estudiar</h1>
          <p className="mt-2 text-sm text-ink-2">
            {resultado.added > 0
              ? `Se agregaron ${resultado.added} notas a ${resultado.deckName}.`
              : 'No habia nada nuevo que agregar.'}
          </p>
        </div>

        <Panel className="grid grid-cols-3 gap-4 px-6 py-5 text-left">
          <Stat value={resultado.cardsCreated} label="tarjetas creadas" tone="claret" />
          <Stat value={resultado.skipped} label="duplicadas" />
          <Stat value={resultado.invalid} label="descartadas" />
        </Panel>

        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={reset}>
            Importar otro
          </Button>
          <Button variant="primary" onClick={() => navigate(`/estudiar/${resultado.deckId}`)}>
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
        description="Acepta TSV, CSV y archivos separados por punto y coma o barra vertical. El separador se detecta solo, y el archivo original queda guardado en tu cuenta."
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
          if (file) void subir(file)
        }}
        className={cx(
          'rounded-lg border border-dashed px-6 py-12 text-center transition',
          dragging ? 'border-claret bg-claret-soft' : 'border-rule bg-paper',
        )}
      >
        <p className="text-sm text-ink-2">Arrastra tu archivo hasta aca</p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={enviando}>
            {enviando && !analisis ? 'Subiendo' : 'Elegir archivo'}
          </Button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".tsv,.csv,.txt,text/plain,text/csv,text/tab-separated-values"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void subir(file)
          }}
        />
        {analisis && (
          <p className="tnum mt-4 text-xs text-ink-2">
            {analisis.filename} · {analisis.totalRows} filas ·{' '}
            {delimiterName(analisis.delimiter)}
            {analisis.hasHeader && ' · con encabezado'}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      {analisis?.errors.map((e) => (
        <p key={e} className="text-xs text-hard">
          {e}
        </p>
      ))}

      {analisis && (
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
                  {analisis.headers.map((header, index) => (
                    <tr key={index} className="border-b border-rule-soft">
                      <td className="py-2.5 pr-4 font-medium text-ink">{header}</td>
                      <td className="max-w-70 truncate py-2.5 pr-4 text-ink-2">
                        {analisis.sample[0]?.[index] || <span className="text-ink-3">vacio</span>}
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
                  {mazos.data?.decks.map((deck) => (
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
              description={`Muestra de las primeras filas. El archivo completo tiene ${analisis.totalRows}.`}
            />
            <ul className="mt-5 space-y-2">
              {previews.map((note, i) => (
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
            <Button variant="primary" disabled={!canImport} onClick={() => void confirmar()}>
              {enviando ? 'Importando' : `Importar ${analisis.totalRows} filas`}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
