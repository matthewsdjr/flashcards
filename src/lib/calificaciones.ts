import { GRADES, Rating, type Grade } from '../../shared/fsrs.ts'

export { GRADES }
export type { Grade }

export const GRADE_LABELS: Record<Grade, string> = {
  [Rating.Again]: 'Otra vez',
  [Rating.Hard]: 'Dificil',
  [Rating.Good]: 'Bien',
  [Rating.Easy]: 'Facil',
}

export const GRADE_KEYS: Record<Grade, string> = {
  [Rating.Again]: '1',
  [Rating.Hard]: '2',
  [Rating.Good]: '3',
  [Rating.Easy]: '4',
}

/*
 * Los botones de calificacion no se rellenan de color: llevan un filete
 * inferior y el texto teñido. Asi se escanean igual sin competir con la ficha.
 */
export const GRADE_RULE: Record<Grade, string> = {
  [Rating.Again]: 'border-b-again hover:bg-again/5',
  [Rating.Hard]: 'border-b-hard hover:bg-hard/5',
  [Rating.Good]: 'border-b-good hover:bg-good/5',
  [Rating.Easy]: 'border-b-easy hover:bg-easy/5',
}

export const GRADE_TEXT: Record<Grade, string> = {
  [Rating.Again]: 'text-again',
  [Rating.Hard]: 'text-hard',
  [Rating.Good]: 'text-good',
  [Rating.Easy]: 'text-easy',
}
