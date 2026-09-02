import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import Decks from './pages/Decks'
import DeckDetail from './pages/DeckDetail'
import Import from './pages/Import'
import Study from './pages/Study'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import { cx } from './lib/classnames'
import { useTheme, type Theme } from './lib/theme'

const NAV = [
  { to: '/', label: 'Mazos', end: true },
  { to: '/importar', label: 'Importar', end: false },
  { to: '/estadisticas', label: 'Progreso', end: false },
  { to: '/ajustes', label: 'Ajustes', end: false },
]

const THEMES: { value: Theme; label: string; title: string }[] = [
  { value: 'light', label: 'Claro', title: 'Tema claro' },
  { value: 'system', label: 'Auto', title: 'Seguir al sistema' },
  { value: 'dark', label: 'Oscuro', title: 'Tema oscuro' },
]

function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  return (
    <div
      className="flex items-center rounded-md border border-rule bg-paper p-0.5"
      role="group"
      aria-label="Tema"
    >
      {THEMES.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          aria-pressed={theme === option.value}
          onClick={() => setTheme(option.value)}
          className={cx(
            'rounded px-2 py-1 text-xs font-medium transition',
            theme === option.value ? 'bg-panel text-ink' : 'text-ink-3 hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Shell() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-rule bg-paper">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-3.5">
          <NavLink to="/" className="flex items-baseline gap-2">
            {/* El lomo claret, el mismo detalle que lleva la ficha en estudio. */}
            <span aria-hidden className="h-4 w-1 self-center rounded-full bg-claret" />
            <span className="display text-lg font-semibold text-ink">Flashcards</span>
          </NavLink>

          {/* En movil el selector de tema sube junto al logo y la navegacion baja. */}
          <div className="ml-auto sm:order-last">
            <ThemeToggle />
          </div>

          <nav className="order-last flex w-full items-center gap-5 text-sm sm:order-none sm:-mb-3.5 sm:w-auto">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'border-b-2 pb-1 font-medium transition sm:pb-3.5',
                    isActive
                      ? 'border-claret text-ink'
                      : 'border-transparent text-ink-2 hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-10">
        <Routes>
          <Route path="/" element={<Decks />} />
          <Route path="/mazo/:deckId" element={<DeckDetail />} />
          <Route path="/importar" element={<Import />} />
          <Route path="/estudiar/:deckId" element={<Study />} />
          <Route path="/estadisticas" element={<Stats />} />
          <Route path="/ajustes" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  // HashRouter evita configurar reescrituras en GitHub Pages y en nginx.
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}
