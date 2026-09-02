/**
 * Recorre la app en Chrome, importa un mazo de ejemplo y guarda capturas.
 * Sirve para revisar el diseño y como prueba de humo de la interfaz.
 * Uso: npm run shots -- [url] [carpeta]
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const BASE = process.argv[2] ?? 'http://127.0.0.1:3997'
const OUT = resolve(process.argv[3] ?? 'shots')
const DECK = resolve('ejemplos/biologia-celular.tsv')

// Cada corrida crea su propia cuenta, para no depender del estado del servidor.
const CUENTA = {
  email: `capturas-${Date.now()}@ejemplo.com`,
  name: 'Capturas',
  password: 'clave-de-prueba-123',
}

const errors: string[] = []

async function shot(page: Page, name: string) {
  await new Promise((r) => setTimeout(r, 450))
  await page.screenshot({ path: `${OUT}/${name}.png` as `${string}.png` })
  console.log(`  ${name}.png`)
}

async function clickText(page: Page, selector: string, text: string) {
  const handle = await page
    .locator(`${selector}::-p-text(${text})`)
    .setTimeout(8000)
    .waitHandle()
  await handle.click()
}

async function run(theme: 'light' | 'dark') {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--font-render-hinting=none'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 })
  page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${theme} console: ${m.text()}`)
  })

  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.evaluate((t) => localStorage.setItem('flashcards-theme', t), theme)
  await page.reload({ waitUntil: 'networkidle0' })

  // Entrar a la cuenta. En el primer tema se crea; en el segundo ya existe.
  await page.locator('input[type=email]').setTimeout(10000).wait()
  await shot(page, `${theme}-0-entrar`)

  const hayRegistro = await page.$('input[autocomplete=name]')
  if (hayRegistro) {
    await page.locator('input[autocomplete=name]').fill(CUENTA.name)
  }
  await page.locator('input[type=email]').fill(CUENTA.email)
  await page.locator('input[type=password]').fill(CUENTA.password)
  await clickText(page, 'button[type=submit]', hayRegistro ? 'Crear cuenta' : 'Entrar')
  await page.locator('::-p-text(Mis mazos)').setTimeout(10000).wait()

  await shot(page, `${theme}-1-vacio`)

  // Importar el mazo de ejemplo por el flujo real de la interfaz.
  await page.goto(`${BASE}#/importar`, { waitUntil: 'networkidle0' })
  const input = await page.locator('input[type=file]').waitHandle()
  await input.uploadFile(DECK)
  await page.locator('table').setTimeout(15000).wait()
  await shot(page, `${theme}-2-importar`)

  await clickText(page, 'button', 'Importar 10 filas')
  await page.locator('::-p-text(Listo para estudiar)').setTimeout(15000).wait()
  await shot(page, `${theme}-3-importado`)

  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' })
  await page.locator('button::-p-text(Estudiar)').setTimeout(8000).wait()
  await shot(page, `${theme}-4-mazos`)

  await clickText(page, 'button', 'Estudiar')
  await page.locator('::-p-text(Mostrar respuesta)').setTimeout(8000).wait()
  await shot(page, `${theme}-5-pregunta`)

  await clickText(page, 'button', 'Mostrar respuesta')
  await page.locator('::-p-text(Otra vez)').setTimeout(8000).wait()
  await shot(page, `${theme}-6-respuesta`)

  // Responder unas cuantas para que haya historial en las estadisticas.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Space')
    await new Promise((r) => setTimeout(r, 250))
    await page.keyboard.press(i % 3 === 0 ? '1' : '3')
    await new Promise((r) => setTimeout(r, 250))
  }

  await page.goto(`${BASE}#/estadisticas`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 600))
  await shot(page, `${theme}-7-progreso`)

  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' })
  await clickText(page, 'a', 'biologia')
  await new Promise((r) => setTimeout(r, 500))
  await shot(page, `${theme}-8-mazo`)

  // Vista movil de la pantalla que mas se usa.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 })
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 400))
  await shot(page, `${theme}-9-movil`)

  await browser.close()
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  for (const theme of ['light', 'dark'] as const) {
    console.log(`\n${theme}:`)
    await run(theme)
  }
  if (errors.length > 0) {
    console.log(`\n${errors.length} errores en consola:`)
    for (const e of [...new Set(errors)].slice(0, 10)) console.log(`  ${e}`)
    process.exit(1)
  }
  console.log('\nSin errores de consola.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
