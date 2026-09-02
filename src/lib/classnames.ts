/** Une clases condicionales descartando las falsas. */
export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export const inputClass =
  'w-full rounded-md border border-rule bg-paper px-3 py-2 text-sm text-ink transition placeholder:text-ink-3 hover:border-ink-3 focus:border-claret focus:outline-none focus:ring-2 focus:ring-claret/25'
