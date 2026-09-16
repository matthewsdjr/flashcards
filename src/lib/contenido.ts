/*
 * Las tarjetas exportadas de Anki y las generadas con un modelo traen dos cosas
 * que no son texto plano: HTML sencillo (<br>, <small>, <b>) y formulas en
 * LaTeX. Aqui ese texto se convierte en un arbol que la vista sabe pintar.
 *
 * El analisis es propio, y no el del navegador, por una razon: solo se aceptan
 * las etiquetas de esta lista y se descartan todos los atributos, asi que nada
 * de lo que venga en un archivo importado puede inyectar marcado en la pagina.
 */

/** Etiquetas que se respetan. El resto se ignora, pero su contenido se queda. */
const ETIQUETAS: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  var: 'em',
  u: 'u',
  s: 's',
  del: 's',
  strike: 's',
  small: 'small',
  sup: 'sup',
  sub: 'sub',
  code: 'code',
  kbd: 'kbd',
  mark: 'mark',
  pre: 'pre',
  p: 'p',
  div: 'div',
  span: 'span',
  blockquote: 'blockquote',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  br: 'br',
  hr: 'hr',
}

const VACIAS = new Set(['br', 'hr'])

/** Las que separan renglones cuando hay que volver al texto plano. */
export const ETIQUETAS_BLOQUE = new Set([
  'p',
  'div',
  'blockquote',
  'ul',
  'ol',
  'li',
  'pre',
  'br',
  'hr',
])

const ETIQUETA = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)(\s[^<>]*)?\/?>/

/*
 * Delimitadores de formula, en orden: los mas largos van primero para que $$
 * no se confunda con $ ni [$$] con [$].
 */
const DELIMITADORES = [
  { abre: '\\[', cierra: '\\]', bloque: true },
  { abre: '\\(', cierra: '\\)', bloque: false },
  { abre: '[$$]', cierra: '[/$$]', bloque: true },
  { abre: '[$]', cierra: '[/$]', bloque: false },
  { abre: '$$', cierra: '$$', bloque: true },
]

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  times: '×',
  minus: '−',
  deg: '°',
}

function decodifica(texto: string): string {
  if (!texto.includes('&')) return texto
  return texto.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (todo, cuerpo: string) => {
    if (cuerpo[0] === '#') {
      const codigo =
        cuerpo[1] === 'x' || cuerpo[1] === 'X'
          ? Number.parseInt(cuerpo.slice(2), 16)
          : Number.parseInt(cuerpo.slice(1), 10)
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff
        ? String.fromCodePoint(codigo)
        : todo
    }
    return ENTIDADES[cuerpo.toLowerCase()] ?? todo
  })
}

export type Nodo =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'formula'; latex: string; bloque: boolean }
  | { tipo: 'etiqueta'; etiqueta: string; hijos: Nodo[] }

function leeFormula(texto: string, desde: number) {
  for (const d of DELIMITADORES) {
    if (!texto.startsWith(d.abre, desde)) continue
    const inicio = desde + d.abre.length
    const cierre = texto.indexOf(d.cierra, inicio)
    // Sin cierre no es una formula: mas vale mostrar el texto tal cual.
    if (cierre === -1) continue
    return { latex: texto.slice(inicio, cierre), bloque: d.bloque, fin: cierre + d.cierra.length }
  }

  /*
   * El dolar suelto pide cuidado: en espanol tambien es moneda. Solo cuenta si
   * cierra en el mismo renglon, no lleva espacios pegados a los bordes y dentro
   * hay algo que parezca matematica y no una cifra.
   */
  if (texto[desde] === '$') {
    const resto = texto.slice(desde + 1)
    const corte = resto.search(/[$\n]/)
    if (corte > 0 && resto[corte] === '$') {
      const dentro = resto.slice(0, corte)
      if (dentro === dentro.trim() && /[a-zA-Z\\^_{}]/.test(dentro)) {
        return { latex: dentro, bloque: false, fin: desde + corte + 2 }
      }
    }
  }
  return null
}

export function analiza(texto: string): Nodo[] {
  const raiz: Nodo[] = []
  const pila: Nodo[][] = [raiz]
  const abiertas: string[] = []
  let suelto = ''
  let i = 0

  const cierraTexto = () => {
    if (!suelto) return
    pila[pila.length - 1].push({ tipo: 'texto', texto: decodifica(suelto) })
    suelto = ''
  }

  while (i < texto.length) {
    const c = texto[i]

    // Las formulas se leen antes que las etiquetas: dentro puede haber < y >.
    if (c === '\\' || c === '$' || c === '[') {
      const f = leeFormula(texto, i)
      if (f) {
        cierraTexto()
        pila[pila.length - 1].push({
          tipo: 'formula',
          latex: decodifica(f.latex).trim(),
          bloque: f.bloque,
        })
        i = f.fin
        continue
      }
    }

    if (c === '<') {
      const m = ETIQUETA.exec(texto.slice(i))
      if (m) {
        i += m[0].length
        const etiqueta = ETIQUETAS[m[2].toLowerCase()]
        if (!etiqueta) continue
        cierraTexto()
        if (VACIAS.has(etiqueta)) {
          pila[pila.length - 1].push({ tipo: 'etiqueta', etiqueta, hijos: [] })
        } else if (m[1]) {
          // Un cierre sin apertura no significa nada; se descarta.
          const donde = abiertas.lastIndexOf(etiqueta)
          if (donde !== -1) {
            pila.length = donde + 1
            abiertas.length = donde
          }
        } else {
          const nodo: Nodo = { tipo: 'etiqueta', etiqueta, hijos: [] }
          pila[pila.length - 1].push(nodo)
          pila.push(nodo.hijos)
          abiertas.push(etiqueta)
        }
        continue
      }
    }

    suelto += c
    i++
  }

  cierraTexto()
  return raiz
}

/** Version sin marcado, para buscar y para donde no cabe una formula pintada. */
export function textoPlano(texto: string): string {
  const partes: string[] = []
  const recorre = (nodos: Nodo[]) => {
    for (const nodo of nodos) {
      if (nodo.tipo === 'texto') partes.push(nodo.texto)
      else if (nodo.tipo === 'formula') partes.push(nodo.latex)
      else {
        const bloque = ETIQUETAS_BLOQUE.has(nodo.etiqueta)
        if (bloque) partes.push(' ')
        recorre(nodo.hijos)
        if (bloque) partes.push(' ')
      }
    }
  }
  recorre(analiza(texto))
  return partes.join('').replace(/\s+/g, ' ').trim()
}
