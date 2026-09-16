import { Fragment, createElement, useMemo, type ReactNode } from 'react'
import katex from 'katex'
import { analiza, ETIQUETAS_BLOQUE, type Nodo } from '../lib/contenido.ts'

/*
 * Pintar una formula cuesta, y la misma tarjeta se vuelve a pintar cada vez que
 * se da vuelta o que se escribe en el buscador. Con guardar el resultado basta.
 */
const PINTADAS = new Map<string, string>()

function aHtml(latex: string, bloque: boolean): string {
  const clave = `${bloque ? 'b' : 'i'}:${latex}`
  const guardada = PINTADAS.get(clave)
  if (guardada !== undefined) return guardada

  let html = ''
  try {
    html = katex.renderToString(latex, {
      displayMode: bloque,
      throwOnError: true,
      strict: false,
      output: 'htmlAndMathml',
    })
  } catch {
    // Cadena vacia: la formula no se entendio y se muestra tal como vino.
    html = ''
  }

  if (PINTADAS.size > 400) PINTADAS.clear()
  PINTADAS.set(clave, html)
  return html
}

/*
 * Una formula es una caja, y el navegador puede cortar el renglon entre la caja
 * y lo que sigue. Sin esto, la coma de "\(\Delta p\), en cm" queda sola al
 * principio de la linea siguiente.
 */
const PUNTUACION = /^[,.;:!?)\]}»”"']+/

function pinta(nodos: Nodo[], enLinea: boolean): ReactNode[] {
  const salida: ReactNode[] = []
  // Signos que ya se pegaron a la formula anterior y no hay que repetir.
  let pegados = 0

  for (let i = 0; i < nodos.length; i++) {
    const nodo = nodos[i]

    if (nodo.tipo === 'texto') {
      const texto = pegados ? nodo.texto.slice(pegados) : nodo.texto
      pegados = 0
      if (texto) salida.push(<Fragment key={i}>{texto}</Fragment>)
      continue
    }

    if (nodo.tipo === 'formula') {
      const enBloque = nodo.bloque && !enLinea
      const html = aHtml(nodo.latex, enBloque)
      const cuerpo = html ? (
        <span
          key={i}
          className={enBloque ? 'my-3 block' : undefined}
          // Lo genera KaTeX a partir del LaTeX, no viene del archivo importado.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        // No se entendio la formula: se muestra tal como vino, sin disimularlo.
        <code key={i} className="rounded bg-danger-soft px-1 text-[0.85em] text-danger">
          {nodo.latex}
        </code>
      )

      const siguiente = nodos[i + 1]
      const signos =
        !enBloque && siguiente?.tipo === 'texto'
          ? (PUNTUACION.exec(siguiente.texto)?.[0] ?? '')
          : ''

      if (!signos) {
        salida.push(cuerpo)
      } else {
        pegados = signos.length
        salida.push(
          <span key={i} className="whitespace-nowrap">
            {cuerpo}
            {signos}
          </span>,
        )
      }
      continue
    }

    if (nodo.etiqueta === 'br') {
      salida.push(enLinea ? <Fragment key={i}> </Fragment> : <br key={i} />)
      continue
    }
    if (nodo.etiqueta === 'hr') {
      if (!enLinea) salida.push(<hr key={i} className="my-4 border-rule" />)
      continue
    }

    // En una linea sola los bloques estorban: se degradan a texto corrido.
    const etiqueta = enLinea && ETIQUETAS_BLOQUE.has(nodo.etiqueta) ? 'span' : nodo.etiqueta
    salida.push(createElement(etiqueta, { key: i }, pinta(nodo.hijos, enLinea)))
  }

  return salida
}

/**
 * Pinta el contenido de una tarjeta: HTML sencillo y formulas en LaTeX entre
 * \( \), \[ \], $$ $$ o [$] [/$]. Con `enLinea` todo cabe en un solo renglon.
 */
export function Contenido({
  texto,
  className,
  enLinea = false,
}: {
  texto: string
  className?: string
  enLinea?: boolean
}) {
  const nodos = useMemo(() => pinta(analiza(texto), enLinea), [texto, enLinea])
  return <div className={className}>{nodos}</div>
}
