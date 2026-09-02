/**
 * Prueba de humo del nucleo: parsear -> importar -> encolar -> calificar.
 * Corre en Node sobre un IndexedDB simulado. Uso: npm test
 */
import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { CardState, DEFAULT_DECK_CONFIG, db } from '../src/db/schema'
import { answerCard, buildQueue, createDeck, deckStats } from '../src/db/queries'
import { guessMapping, parseDelimited } from '../src/lib/parse'
import { importRows } from '../src/lib/import'
import { exportBackup, restoreBackup } from '../src/lib/backup'
import { Rating } from '../src/lib/scheduler'

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`)
  }
}

async function main() {
  console.log('\nParseo de archivos')
  const tsv = parseDelimited(readFileSync('ejemplos/biologia-celular.tsv', 'utf8'))
  check('detecta el tabulador', tsv.delimiter === '\t', tsv.delimiter)
  check('detecta el encabezado', tsv.hasHeader)
  check('lee las 10 filas de datos', tsv.rows.length === 10, String(tsv.rows.length))

  const csv = parseDelimited(readFileSync('ejemplos/verbos-irregulares-ingles.csv', 'utf8'))
  check('detecta la coma', csv.delimiter === ',', csv.delimiter)
  check('lee las 8 filas del CSV', csv.rows.length === 8, String(csv.rows.length))

  const ankiStyle = parseDelimited('#separator:tab\n#html:false\nhola\thello\nadios\tbye\n')
  check('ignora el preambulo de Anki', ankiStyle.skipped === 2, String(ankiStyle.skipped))
  check('sin encabezado usa columnas sinteticas', !ankiStyle.hasHeader)
  check('parsea las 2 filas', ankiStyle.rows.length === 2, String(ankiStyle.rows.length))

  const mapping = guessMapping(tsv.headers, tsv.hasHeader)
  check('mapea Front/Back/Tags por nombre', mapping[0] === 'front' && mapping[1] === 'back' && mapping[4] === 'tags', mapping.join(','))

  console.log('\nImportacion')
  const deckId = await createDeck('Biologia celular')
  const result = await importRows({
    deckId,
    rows: tsv.rows,
    mapping,
    onDuplicate: 'skip',
    extraTags: ['parcial1'],
  })
  check('agrega 10 notas', result.added === 10, String(result.added))
  check('crea 1 tarjeta por nota', result.cardsCreated === 10, String(result.cardsCreated))

  const note = await db.notes.where('deckId').equals(deckId).first()
  check('conserva la pista', note?.hint === 'La central energetica', note?.hint)
  check('suma la etiqueta global', note?.tags.includes('parcial1') === true, note?.tags.join(','))

  const again = await importRows({ deckId, rows: tsv.rows, mapping, onDuplicate: 'skip', extraTags: [] })
  check('omite los duplicados al reimportar', again.added === 0 && again.skipped === 10, `added=${again.added} skipped=${again.skipped}`)

  const invalid = await importRows({
    deckId,
    rows: [['solo frente', ''], ['', 'solo reverso']],
    mapping: ['front', 'back'],
    onDuplicate: 'skip',
    extraTags: [],
  })
  check('descarta filas sin frente o reverso', invalid.invalid === 2, String(invalid.invalid))

  console.log('\nCola de estudio y limites diarios')
  const deck = (await db.decks.get(deckId))!
  const queue = await buildQueue(deck)
  check('encola las 10 tarjetas nuevas', queue.length === 10, String(queue.length))

  await db.decks.update(deckId, { config: { ...DEFAULT_DECK_CONFIG, newPerDay: 3 } })
  const limited = await buildQueue((await db.decks.get(deckId))!)
  check('respeta el limite de nuevas por dia', limited.length === 3, String(limited.length))
  await db.decks.update(deckId, { config: DEFAULT_DECK_CONFIG })

  console.log('\nProgramacion FSRS')
  const config = (await db.decks.get(deckId))!.config
  const first = (await buildQueue((await db.decks.get(deckId))!))[0]
  check('la tarjeta arranca como nueva', first.state === CardState.New)

  const now = new Date()
  const good = await answerCard(first, config, Rating.Good, 3200, now)
  check('Bien la saca del estado nuevo', good.state !== CardState.New, String(good.state))
  check('Bien la programa a futuro', good.due > now.getTime(), `${good.due} vs ${now.getTime()}`)
  check('registra el repaso', (await db.revlog.count()) === 1)

  const logged = await db.revlog.orderBy('id').last()
  check('guarda la duracion de la respuesta', logged?.durationMs === 3200, String(logged?.durationMs))

  const counts = await db.dayCounts.where('deckId').equals(deckId).first()
  check('cuenta la tarjeta nueva del dia', counts?.newCount === 1, String(counts?.newCount))

  // Progresion real hasta el estado de repaso: se responde Bien hasta graduar.
  let graduated = good
  let step = new Date(now)
  for (let i = 0; i < 5 && graduated.state !== CardState.Review; i++) {
    step = new Date(graduated.due + 1000)
    graduated = await answerCard(graduated, config, Rating.Good, 1000, step)
  }
  check('la tarjeta se gradua a repaso', graduated.state === CardState.Review, String(graduated.state))
  // ts-fsrs usa learningSteps como indice de paso: al graduar debe volver a cero,
  // porque si no la proxima falla no entra en reaprendizaje.
  check('al graduar reinicia el indice de pasos', graduated.learningSteps === 0, String(graduated.learningSteps))

  // Un Otra vez sobre una tarjeta en repaso debe reprogramarla en minutos, no en dias.
  const lapseAt = new Date(graduated.due + 1000)
  const lapsed = await answerCard(graduated, config, Rating.Again, 1500, lapseAt)
  check('Otra vez manda a reaprendizaje', lapsed.state === CardState.Relearning, String(lapsed.state))
  check('Otra vez reprograma dentro del dia', lapsed.due - lapseAt.getTime() < 86400000, String(lapsed.due - lapseAt.getTime()))
  check('Otra vez incrementa los lapsos', lapsed.lapses === 1, String(lapsed.lapses))

  const easyCard = (await buildQueue((await db.decks.get(deckId))!))[0]
  const easy = await answerCard(easyCard, config, Rating.Easy, 900, now)
  const hardCard = (await buildQueue((await db.decks.get(deckId))!))[0]
  const hard = await answerCard(hardCard, config, Rating.Hard, 900, now)
  check('Facil da un intervalo mayor que Dificil', easy.due > hard.due, `${easy.due} vs ${hard.due}`)

  console.log('\nEstadisticas')
  const stats = await deckStats((await db.decks.get(deckId))!)
  check('cuenta el total de tarjetas', stats.total === 10, String(stats.total))
  check('suma nuevas + aprendiendo + repaso = total', stats.newCount + stats.learningCount + stats.reviewCount === stats.total, `${stats.newCount}+${stats.learningCount}+${stats.reviewCount}`)

  console.log('\nRespaldo')
  const backup = await exportBackup()
  check('exporta el mazo', backup.decks.length === 1)
  check('exporta las notas', backup.notes.length === 10, String(backup.notes.length))
  check('exporta el historial completo', backup.revlog.length === (await db.revlog.count()), String(backup.revlog.length))

  const restored = await restoreBackup(backup, false)
  check('restaura sumando al contenido actual', restored.notes === 10 && (await db.notes.count()) === 20, String(await db.notes.count()))

  await restoreBackup(backup, true)
  check('restaura reemplazando todo', (await db.notes.count()) === 10, String(await db.notes.count()))
  check('mantiene la integridad de las tarjetas', (await db.cards.count()) === 10, String(await db.cards.count()))

  const noteIds = new Set((await db.notes.toArray()).map((n) => n.id!))
  const deckIds = new Set((await db.decks.toArray()).map((d) => d.id!))
  const restoredCards = await db.cards.toArray()
  const orphans = restoredCards.filter((c) => !noteIds.has(c.noteId) || !deckIds.has(c.deckId))
  check('no quedan tarjetas huerfanas', orphans.length === 0, String(orphans.length))

  console.log(failures === 0 ? '\nTodo en orden.\n' : `\n${failures} verificaciones fallaron.\n`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
