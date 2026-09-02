import { useCallback, useEffect, useState } from 'react'

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'flashcards-theme'

function read(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function apply(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

/**
 * Tema con tres estados. `system` no marca el documento, de modo que manda
 * prefers-color-scheme; light y dark lo fuerzan.
 */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(read)

  useEffect(() => {
    apply(theme)
  }, [theme])

  const update = useCallback((next: Theme) => {
    setTheme(next)
    try {
      if (next === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      // Modo privado o almacenamiento bloqueado: el tema vale para esta sesion.
    }
  }, [])

  return [theme, update]
}
