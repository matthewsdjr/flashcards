import Fastify, { type FastifyError } from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import compress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { purgeExpiredSessions } from './auth.ts'
import { loadUser } from './contexto.ts'
import { DATA_DIR } from './db.ts'
import rutasAuth from './rutas/auth.ts'
import rutasMazos from './rutas/mazos.ts'
import rutasImportar from './rutas/importar.ts'
import rutasVarios from './rutas/varios.ts'

const PORT = Number(process.env.PORT ?? 3000)
const HOST = process.env.HOST ?? '0.0.0.0'
const CLIENT_DIR = resolve(process.env.CLIENT_DIR ?? './dist')

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // Nunca registrar cookies ni cuerpos: ahi viajan credenciales.
    redact: ['req.headers.cookie', 'req.headers.authorization'],
    serializers: {
      req: (request) => ({
        method: request.method,
        url: request.url,
        ip: request.ip,
      }),
    },
  },
  trustProxy: process.env.TRUST_PROXY === 'true',
  bodyLimit: 32 * 1024 * 1024,
})

await app.register(compress, { global: true, encodings: ['gzip', 'deflate'] })
await app.register(cookie)
await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } })
await app.register(rateLimit, {
  global: true,
  max: 600,
  timeWindow: '1 minute',
  keyGenerator: (request) => request.ip,
})

app.addHook('onRequest', async (request) => {
  request.usuario = loadUser(request)
})

app.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'SAMEORIGIN')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Los assets llevan hash en el nombre: se cachean indefinidamente. Todo lo
  // demas, incluido el HTML, se revalida para que un deploy se vea al instante.
  if (!request.url.startsWith('/api/')) {
    reply.header(
      'Cache-Control',
      request.url.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, must-revalidate',
    )
  }
  return payload
})

await app.register(rutasAuth, { prefix: '/api/auth' })
await app.register(rutasMazos, { prefix: '/api/mazos' })
await app.register(rutasImportar, { prefix: '/api/importaciones' })
await app.register(rutasVarios, { prefix: '/api' })

app.setErrorHandler((error: FastifyError, request, reply) => {
  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: error.message })
  }
  request.log.error({ err: error }, 'error no controlado')
  // Al cliente solo le llega un mensaje generico: el detalle queda en el log.
  return reply.code(500).send({ error: 'Algo fallo en el servidor' })
})

// La API responde 404 en JSON; el resto de las rutas las resuelve el cliente.
app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith('/api/')) {
    return reply.code(404).send({ error: 'Ese endpoint no existe' })
  }
  return reply.type('text/html').sendFile('index.html')
})

if (existsSync(CLIENT_DIR)) {
  await app.register(fastifyStatic, { root: CLIENT_DIR, cacheControl: false })
} else {
  app.log.warn(`no se encontro el cliente compilado en ${CLIENT_DIR}`)
}

// Limpieza periodica de sesiones vencidas.
const purgeTimer = setInterval(
  () => {
    const removed = purgeExpiredSessions()
    if (removed > 0) app.log.info(`sesiones vencidas eliminadas: ${removed}`)
  },
  6 * 60 * 60 * 1000,
)
purgeTimer.unref()

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} recibido, cerrando`)
    void app.close().then(() => process.exit(0))
  })
}

try {
  await app.listen({ port: PORT, host: HOST })
  app.log.info(`datos en ${DATA_DIR}`)
} catch (error) {
  app.log.error({ err: error }, 'no se pudo iniciar el servidor')
  process.exit(1)
}
