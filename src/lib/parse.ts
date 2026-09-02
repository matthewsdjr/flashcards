import Papa from 'papaparse'

export type FieldRole = 'front' | 'back' | 'hint' | 'extra' | 'tags' | 'ignore'

export const FIELD_ROLE_LABELS: Record<FieldRole, string> = {
  front: 'Frente (pregunta)',
  back: 'Reverso (respuesta)',
  hint: 'Pista',
  extra: 'Notas adicionales',
  tags: 'Etiquetas',
  ignore: 'Ignorar',
}

export interface ParsedFile {
  /** Encabezados detectados, o nombres sinteticos (Columna 1, 2...) si no hay. */
  headers: string[]
  rows: string[][]
  delimiter: string
  hasHeader: boolean
  /** Lineas descartadas por estar vacias o ser comentarios de Anki (#...). */
  skipped: number
  errors: string[]
}

const DELIMITER_NAMES: Record<string, string> = {
  '\t': 'Tabulacion (TSV)',
  ',': 'Coma (CSV)',
  ';': 'Punto y coma',
  '|': 'Barra vertical',
}

export function delimiterName(delimiter: string): string {
  return DELIMITER_NAMES[delimiter] ?? `"${delimiter}"`
}

/**
 * Heuristica de encabezado: la primera fila se considera encabezado si ninguna
 * de sus celdas se repite y sus valores son cortos, algo tipico de nombres de
 * columna y raro en contenido de tarjetas.
 */
function looksLikeHeader(row: string[]): boolean {
  if (row.length < 2) return false
  const cells = row.map((c) => c.trim())
  if (cells.some((c) => c.length === 0 || c.length > 40)) return false
  if (new Set(cells.map((c) => c.toLowerCase())).size !== cells.length) return false
  return cells.some((c) => /^(front|back|pregunta|respuesta|anverso|reverso|term|definition|tags|etiquetas|hint|pista|nota|notes|extra)$/i.test(c))
}

/**
 * Parsea texto TSV/CSV. Ignora las lineas de metadatos que Anki antepone
 * en sus exportaciones (`#separator:tab`, `#html:true`, etc.).
 */
export function parseDelimited(text: string): ParsedFile {
  const errors: string[] = []

  // Anki exporta un preambulo de lineas '#clave:valor' que no son datos.
  const lines = text.replace(/^﻿/, '').split(/\r\n|\n|\r/)
  let skipped = 0
  let declaredDelimiter: string | undefined
  let start = 0
  while (start < lines.length && lines[start].startsWith('#')) {
    const match = /^#separator:\s*(.+)$/i.exec(lines[start])
    if (match) {
      const value = match[1].trim().toLowerCase()
      if (value === 'tab') declaredDelimiter = '\t'
      else if (value === 'comma') declaredDelimiter = ','
      else if (value === 'semicolon') declaredDelimiter = ';'
      else if (value === 'pipe') declaredDelimiter = '|'
      else if (value.length === 1) declaredDelimiter = value
    }
    start++
    skipped++
  }

  const body = lines.slice(start).join('\n')
  const result = Papa.parse<string[]>(body, {
    delimiter: declaredDelimiter ?? '',
    delimitersToGuess: ['\t', ',', ';', '|'],
    skipEmptyLines: 'greedy',
    newline: '\n',
  })

  for (const err of result.errors.slice(0, 5)) {
    errors.push(`Fila ${(err.row ?? 0) + 1}: ${err.message}`)
  }

  const delimiter = result.meta.delimiter || declaredDelimiter || '\t'
  let rows = (result.data as string[][]).filter(
    (row) => row.length > 0 && row.some((cell) => cell.trim().length > 0),
  )

  if (rows.length === 0) {
    return { headers: [], rows: [], delimiter, hasHeader: false, skipped, errors }
  }

  const width = Math.max(...rows.map((r) => r.length))
  // Normaliza el ancho para que el mapeo de columnas sea estable.
  rows = rows.map((row) => {
    const padded = row.slice(0, width)
    while (padded.length < width) padded.push('')
    return padded.map((cell) => cell ?? '')
  })

  const hasHeader = looksLikeHeader(rows[0])
  const headers = hasHeader
    ? rows[0].map((cell, i) => cell.trim() || `Columna ${i + 1}`)
    : Array.from({ length: width }, (_, i) => `Columna ${i + 1}`)

  return {
    headers,
    rows: hasHeader ? rows.slice(1) : rows,
    delimiter,
    hasHeader,
    skipped,
    errors,
  }
}

/** Propone un rol para cada columna a partir del encabezado y la posicion. */
export function guessMapping(headers: string[], hasHeader: boolean): FieldRole[] {
  return headers.map((header, index) => {
    if (hasHeader) {
      const h = header.trim().toLowerCase()
      if (/^(front|pregunta|anverso|term|termino|palabra)$/.test(h)) return 'front'
      if (/^(back|respuesta|reverso|definition|definicion|traduccion)$/.test(h)) return 'back'
      if (/^(tags?|etiquetas?|categoria)$/.test(h)) return 'tags'
      if (/^(hint|pista|ayuda)$/.test(h)) return 'hint'
      if (/^(extra|notas?|notes|ejemplo|comentario)$/.test(h)) return 'extra'
    }
    if (index === 0) return 'front'
    if (index === 1) return 'back'
    return 'ignore'
  })
}

export function splitTags(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}
