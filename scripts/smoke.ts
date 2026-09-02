/**
 * Prueba de humo de la API contra un servidor real y una base descartable.
 * Cubre autenticacion, invitaciones, importacion, estudio y — sobre todo —
 * que una cuenta no pueda alcanzar los datos de otra.
 * Uso: npm test
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 3999
const BASE = `http://127.0.0.1:${PORT}`
const DATA_DIR = mkdtempSync(join(tmpdir(), 'flashcards-test-'))

let failures = 0
let server: ChildProcess | null = null

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FALLA ${label}${detail ? ` -> ${detail}` : ''}`)
  }
}

/** Cliente HTTP que conserva la cookie de sesion, como haria un navegador. */
class Cliente {
  cookie = ''

  async req(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {}
    if (this.cookie) headers.Cookie = this.cookie
    let payload: BodyInit | undefined
    if (body instanceof FormData) {
      payload = body
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    const response = await fetch(`${BASE}/api${path}`, { method, headers, body: payload })
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]!

    const text = await response.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = text
    }
    return { status: response.status, data }
  }

  get = (p: string) => this.req('GET', p)
  post = (p: string, b?: unknown) => this.req('POST', p, b)
  patch = (p: string, b?: unknown) => this.req('PATCH', p, b)
  del = (p: string) => this.req('DELETE', p)
}

async function arrancarServidor() {
  server = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', 'server/index.ts'],
    {
      env: {
        ...process.env,
        PORT: String(PORT),
        HOST: '127.0.0.1',
        DATA_DIR,
        LOG_LEVEL: 'error',
        CLIENT_DIR: '/tmp/no-existe-cliente',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  server.stderr?.on('data', (d) => {
    const text = String(d)
    if (!text.includes('ExperimentalWarning')) process.stderr.write(text)
  })

  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`${BASE}/api/mazos/_ping`)
      if (response.status === 200 || response.status === 401) return
    } catch {
      // el servidor todavia no escucha
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('el servidor no arranco')
}

async function main() {
  await arrancarServidor()

  const ana = new Cliente()
  const beto = new Cliente()

  console.log('\nAutenticacion')
  const estado = await ana.get('/auth/yo')
  check('el servidor nuevo pide la primera cuenta', estado.data?.necesitaPrimeraCuenta === true)
  check('sin sesion /auth/yo responde 200 con user nulo', estado.status === 200 && estado.data?.user === null)

  const sinSesion = await ana.get('/mazos')
  check('sin sesion la API responde 401', sinSesion.status === 401, String(sinSesion.status))

  const debil = await ana.post('/auth/registro', {
    email: 'ana@ejemplo.com',
    name: 'Ana',
    password: 'corta',
  })
  check('rechaza una contraseña debil', debil.status === 400, String(debil.status))

  const alta = await ana.post('/auth/registro', {
    email: 'ana@ejemplo.com',
    name: 'Ana',
    password: 'clave-larga-123',
  })
  check('crea la primera cuenta', alta.status === 201, String(alta.status))
  check('la primera cuenta es administradora', alta.data?.isAdmin === true)

  const yo = await ana.get('/auth/yo')
  check('la cookie de sesion identifica al usuario', yo.data?.user?.email === 'ana@ejemplo.com')

  const estado2 = await beto.get('/auth/yo')
  check('ya no hace falta una primera cuenta', estado2.data?.necesitaPrimeraCuenta === false)

  console.log('\nInvitaciones')
  const sinInvitacion = await beto.post('/auth/registro', {
    email: 'beto@ejemplo.com',
    name: 'Beto',
    password: 'otra-clave-456',
  })
  check('el registro sin invitacion se rechaza', sinInvitacion.status === 400, String(sinInvitacion.status))

  const inventado = await beto.post('/auth/registro', {
    email: 'beto@ejemplo.com',
    name: 'Beto',
    password: 'otra-clave-456',
    invite: 'XXXX-XXXX-XXXX',
  })
  check('un codigo inventado se rechaza', inventado.status === 400)

  const invitacion = await ana.post('/invitaciones', { note: 'para beto' })
  check('la administradora genera un codigo', invitacion.status === 201 && Boolean(invitacion.data?.code))
  const codigo = invitacion.data.code as string

  const conInvitacion = await beto.post('/auth/registro', {
    email: 'beto@ejemplo.com',
    name: 'Beto',
    password: 'otra-clave-456',
    invite: codigo,
  })
  check('con invitacion valida se crea la cuenta', conInvitacion.status === 201, String(conInvitacion.status))
  check('la segunda cuenta no es administradora', conInvitacion.data?.isAdmin !== true)

  const reusar = new Cliente()
  const reuso = await reusar.post('/auth/registro', {
    email: 'carla@ejemplo.com',
    name: 'Carla',
    password: 'tercera-clave-789',
    invite: codigo,
  })
  check('un codigo ya usado se rechaza', reuso.status === 400, String(reuso.status))

  const noAdmin = await beto.get('/invitaciones')
  check('quien no es admin no ve las invitaciones', noAdmin.status === 403, String(noAdmin.status))

  console.log('\nImportacion')
  const tsv = readFileSync('ejemplos/biologia-celular.tsv')
  const form = new FormData()
  form.append('archivo', new Blob([tsv], { type: 'text/tab-separated-values' }), 'biologia.tsv')
  const analisis = await ana.post('/importaciones/analizar', form)
  check('analiza el archivo subido', analisis.status === 200, String(analisis.status))
  check('detecta el tabulador', analisis.data?.delimiter === '\t')
  check('detecta el encabezado', analisis.data?.hasHeader === true)
  check('cuenta las 10 filas', analisis.data?.totalRows === 10, String(analisis.data?.totalRows))

  const sinCaras = await ana.post('/importaciones/confirmar', {
    importId: analisis.data.importId,
    newDeckName: 'Prueba',
    mapping: ['ignore', 'ignore', 'ignore', 'ignore', 'ignore'],
  })
  check('sin frente ni reverso no importa', sinCaras.status === 400, String(sinCaras.status))

  const confirmado = await ana.post('/importaciones/confirmar', {
    importId: analisis.data.importId,
    newDeckName: 'Biologia celular',
    mapping: ['front', 'back', 'hint', 'extra', 'tags'],
    onDuplicate: 'skip',
    tags: 'parcial1',
  })
  check('importa las 10 notas', confirmado.data?.added === 10, String(confirmado.data?.added))
  check('crea una tarjeta por nota', confirmado.data?.cardsCreated === 10)
  const mazoAna = confirmado.data.deckId as number

  const historial = await ana.get('/importaciones')
  check('queda registrada la importacion', historial.data?.imports?.length === 1)
  const archivo = await fetch(`${BASE}/api/importaciones/${historial.data.imports[0].id}/archivo`, {
    headers: { Cookie: ana.cookie },
  })
  const contenido = await archivo.text()
  check('el archivo original se puede descargar', contenido.includes('mitocondria'))

  console.log('\nAislamiento entre cuentas')
  const betoVeMazos = await beto.get('/mazos')
  check('beto no ve los mazos de ana', betoVeMazos.data?.decks?.length === 0)

  const betoAbre = await beto.get(`/mazos/${mazoAna}`)
  check('beto no puede abrir el mazo de ana', betoAbre.status === 404, String(betoAbre.status))

  const betoCola = await beto.get(`/mazos/${mazoAna}/cola`)
  check('beto no puede pedir la cola de ana', betoCola.status === 404)

  const betoRenombra = await beto.patch(`/mazos/${mazoAna}`, { name: 'secuestrado' })
  check('beto no puede renombrar el mazo de ana', betoRenombra.status === 404)

  const betoBorra = await beto.del(`/mazos/${mazoAna}`)
  check('beto no puede borrar el mazo de ana', betoBorra.status === 404)

  const colaAna = await ana.get(`/mazos/${mazoAna}/cola`)
  const primeraTarjeta = colaAna.data.queue[0].card.id as number
  const primeraNota = colaAna.data.queue[0].note.id as number

  const betoResponde = await beto.post(`/mazos/tarjetas/${primeraTarjeta}/responder`, {
    grade: 3,
    durationMs: 100,
  })
  check('beto no puede responder una tarjeta de ana', betoResponde.status === 404)

  const betoBorraNota = await beto.del(`/mazos/notas/${primeraNota}`)
  check('beto no puede borrar una nota de ana', betoBorraNota.status === 404)

  const betoReinicia = await beto.post('/mazos/tarjetas/reiniciar', { ids: [primeraTarjeta] })
  check('reiniciar tarjetas ajenas no cambia nada', betoReinicia.data?.changed === 0)

  const betoSuspende = await beto.post('/mazos/tarjetas/suspender', {
    ids: [primeraTarjeta],
    suspended: true,
  })
  check('suspender tarjetas ajenas no cambia nada', betoSuspende.data?.changed === 0)

  const betoArchivo = await fetch(
    `${BASE}/api/importaciones/${historial.data.imports[0].id}/archivo`,
    { headers: { Cookie: beto.cookie } },
  )
  check('beto no puede descargar el archivo de ana', betoArchivo.status === 404, String(betoArchivo.status))

  console.log('\nEstudio')
  check('la cola trae las 10 nuevas', colaAna.data.queue.length === 10, String(colaAna.data.queue.length))
  check('la cola trae los intervalos previstos', Object.keys(colaAna.data.queue[0].preview).length === 4)
  check('la tarjeta arranca como nueva', colaAna.data.queue[0].card.state === 0)

  const mala = await ana.post(`/mazos/tarjetas/${primeraTarjeta}/responder`, { grade: 9 })
  check('rechaza una calificacion invalida', mala.status === 400, String(mala.status))

  const bien = await ana.post(`/mazos/tarjetas/${primeraTarjeta}/responder`, {
    grade: 3,
    durationMs: 3200,
  })
  check('Bien saca la tarjeta del estado nuevo', bien.data?.card?.state !== 0)
  check('Bien la programa a futuro', bien.data?.card?.due > Date.now())

  const limitado = await ana.patch(`/mazos/${mazoAna}`, {
    config: { newPerDay: 3, reviewsPerDay: 200, requestRetention: 0.9 },
  })
  check('guarda la configuracion del mazo', limitado.data?.deck?.config?.newPerDay === 3)

  const colaLimitada = await ana.get(`/mazos/${mazoAna}/cola`)
  // Ya se consumio una nueva hoy, asi que del tope de 3 quedan 2.
  const nuevasEnCola = colaLimitada.data.queue.filter((q: any) => q.card.state === 0).length
  check('respeta el limite diario de nuevas', nuevasEnCola === 2, String(nuevasEnCola))

  const stats = await ana.get('/estadisticas')
  check('las estadisticas cuentan el repaso', stats.data?.reviews === 1, String(stats.data?.reviews))
  check('la racha arranca en 1', stats.data?.streak === 1)
  check('el reparto suma las 10 tarjetas', stats.data?.totalCards === 10)

  const statsBeto = await beto.get('/estadisticas')
  check('beto ve sus propias estadisticas vacias', statsBeto.data?.reviews === 0 && statsBeto.data?.totalCards === 0)

  console.log('\nRespaldo')
  const respaldo = await ana.get('/respaldo')
  check('el respaldo trae el mazo', respaldo.data?.decks?.length === 1)
  check('el respaldo trae las notas', respaldo.data?.notes?.length === 10)

  const restaurado = await beto.post('/respaldo', {
    decks: respaldo.data.decks,
    notes: respaldo.data.notes.map((n: any) => ({ ...n, deckId: n.deck_id })),
  })
  check('beto puede restaurar un respaldo en su cuenta', restaurado.data?.decks === 1, JSON.stringify(restaurado.data))
  check('la restauracion crea las notas', restaurado.data?.notes === 10, String(restaurado.data?.notes))

  const mazosBeto = await beto.get('/mazos')
  check('el mazo restaurado es de beto', mazosBeto.data?.decks?.length === 1)
  check('y es distinto del de ana', mazosBeto.data.decks[0].id !== mazoAna)

  console.log('\nPanel de cuentas')
  const listaBeto = await beto.get('/usuarios')
  check('quien no es admin no ve las cuentas', listaBeto.status === 403, String(listaBeto.status))

  const lista = await ana.get('/usuarios')
  check('la admin ve las dos cuentas', lista.data?.users?.length === 2, String(lista.data?.users?.length))

  const fichaAna = lista.data.users.find((u: any) => u.email === 'ana@ejemplo.com')
  const fichaBeto = lista.data.users.find((u: any) => u.email === 'beto@ejemplo.com')
  check('marca quien administra', fichaAna?.isAdmin === true && fichaBeto?.isAdmin === false)
  check('cuenta los mazos de cada uno', fichaAna?.deckCount === 1 && fichaBeto?.deckCount === 1, `${fichaAna?.deckCount}/${fichaBeto?.deckCount}`)
  check('cuenta las tarjetas de cada uno', fichaAna?.cardCount === 10 && fichaBeto?.cardCount === 10, `${fichaAna?.cardCount}/${fichaBeto?.cardCount}`)
  check('cuenta los repasos', fichaAna?.reviewCount >= 1 && fichaBeto?.reviewCount === 0, `${fichaAna?.reviewCount}/${fichaBeto?.reviewCount}`)
  check('registra la ultima actividad', typeof fichaAna?.lastActivity === 'number' && fichaBeto?.lastActivity === null)
  check('cuenta las sesiones abiertas', fichaAna?.sessions === 1 && fichaBeto?.sessions === 1, `${fichaAna?.sessions}/${fichaBeto?.sessions}`)
  check('no expone el hash de la contrasenia', !JSON.stringify(lista.data).includes('scrypt$'))

  const borrarseSola = await ana.del(`/usuarios/${fichaAna.id}`)
  check('la admin no puede borrarse a si misma', borrarseSola.status === 400, String(borrarseSola.status))

  const betoBorraAna = await beto.del(`/usuarios/${fichaAna.id}`)
  check('quien no es admin no puede borrar cuentas', betoBorraAna.status === 403, String(betoBorraAna.status))

  const betoCierraAna = await beto.post(`/usuarios/${fichaAna.id}/cerrar-sesiones`)
  check('quien no es admin no puede cerrar sesiones ajenas', betoCierraAna.status === 403)

  const inexistente = await ana.del('/usuarios/999999')
  check('borrar una cuenta inexistente da 404', inexistente.status === 404, String(inexistente.status))

  // Cerrar las sesiones de beto lo deja fuera sin tocar sus datos.
  const cierre = await ana.post(`/usuarios/${fichaBeto.id}/cerrar-sesiones`)
  check('la admin cierra las sesiones de otra cuenta', cierre.status === 200)
  check('y sabe que no eran las propias', cierre.data?.esPropia === false)
  const betoExpulsado = await beto.get('/mazos')
  check('beto queda fuera tras cerrarle las sesiones', betoExpulsado.status === 401, String(betoExpulsado.status))

  const betoVuelve = await beto.post('/auth/entrar', {
    email: 'beto@ejemplo.com',
    password: 'otra-clave-456',
  })
  check('beto puede volver a entrar con su contrasenia', betoVuelve.status === 200, String(betoVuelve.status))
  const betoSigueTeniendo = await beto.get('/mazos')
  check('sus mazos siguen ahi', betoSigueTeniendo.data?.decks?.length === 1)

  // Borrar la cuenta se lleva su contenido, sin tocar el de la otra.
  const borrado = await ana.del(`/usuarios/${fichaBeto.id}`)
  check('la admin elimina la cuenta', borrado.status === 200, String(borrado.status))
  const listaFinal = await ana.get('/usuarios')
  check('queda una sola cuenta', listaFinal.data?.users?.length === 1)
  const betoMuerto = await beto.get('/mazos')
  check('la sesion de la cuenta borrada ya no vale', betoMuerto.status === 401)
  const anaIntacta = await ana.get('/mazos')
  check('el contenido de la admin queda intacto', anaIntacta.data?.decks?.length === 1)

  // Los archivos subidos viven en disco y no los alcanza el CASCADE.
  const archivosHuerfanos = await fetch(`${BASE}/api/importaciones`, {
    headers: { Cookie: ana.cookie },
  }).then((r) => r.json())
  check('la admin conserva su propia importacion', archivosHuerfanos.imports.length === 1)

  const invitesTrasBorrado = await ana.get('/invitaciones')
  check('la invitacion usada sobrevive al borrado', invitesTrasBorrado.data?.invites?.length === 1)
  check('y deja de apuntar a una cuenta', invitesTrasBorrado.data.invites[0].usedBy === null)

  console.log('\nCierre de sesion')
  const malPass = new Cliente()
  const rechazo = await malPass.post('/auth/entrar', {
    email: 'ana@ejemplo.com',
    password: 'incorrecta-123',
  })
  check('rechaza una contraseña incorrecta', rechazo.status === 401, String(rechazo.status))

  // Cloudflare agrega cabeceras de cuerpo a los POST vacios; sin el parser
  // permisivo esto responde 415 y cerrar sesion queda roto en produccion.
  const vacioConTipo = await fetch(`${BASE}/api/auth/salir`, {
    method: 'POST',
    headers: { Cookie: ana.cookie, 'Content-Type': 'application/octet-stream' },
  })
  check('acepta un POST sin cuerpo con content-type desconocido', vacioConTipo.status === 200, String(vacioConTipo.status))

  const cuerpoRaro = await fetch(`${BASE}/api/auth/salir`, {
    method: 'POST',
    headers: { Cookie: ana.cookie, 'Content-Type': 'application/octet-stream' },
    body: 'contenido inesperado',
  })
  check('rechaza un cuerpo con tipo desconocido', cuerpoRaro.status === 415, String(cuerpoRaro.status))

  const salida = await ana.post('/auth/salir')
  check('cierra la sesion', salida.status === 200)
  const trasSalir = await ana.get('/mazos')
  check('tras salir la API responde 401', trasSalir.status === 401, String(trasSalir.status))

  console.log(failures === 0 ? '\nTodo en orden.\n' : `\n${failures} verificaciones fallaron.\n`)
}

main()
  .catch((error) => {
    console.error(error)
    failures++
  })
  .finally(() => {
    server?.kill('SIGTERM')
    rmSync(DATA_DIR, { recursive: true, force: true })
    process.exit(failures === 0 ? 0 : 1)
  })
