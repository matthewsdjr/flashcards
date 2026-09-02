import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import Decks from './pages/Decks.tsx'
import DeckDetail from './pages/DeckDetail.tsx'
import Import from './pages/Import.tsx'
import Study from './pages/Study.tsx'
import Stats from './pages/Stats.tsx'
import Settings from './pages/Settings.tsx'
import Entrar from './pages/Entrar.tsx'
import Cuentas from './pages/Cuentas.tsx'
import { cx } from './lib/classnames.ts'
import { useTheme, type Theme } from './lib/theme.ts'
import { ProveedorSesion, useSesion } from './auth/SesionContext.tsx'
import { Spinner } from './components/ui.tsx'

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
  const { usuario, salir } = useSesion()

  const nav = [
    { to: '/', label: 'Mazos', end: true },
    { to: '/importar', label: 'Importar', end: false },
    { to: '/estadisticas', label: 'Progreso', end: false },
    { to: '/ajustes', label: 'Ajustes', end: false },
    ...(usuario?.isAdmin ? [{ to: '/cuentas', label: 'Cuentas', end: false }] : []),
  ]

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
          <div className="ml-auto flex items-center gap-3 sm:order-last">
            <ThemeToggle />
            <div className="flex items-center gap-2 border-l border-rule pl-3">
              <span className="hidden max-w-32 truncate text-sm text-ink-2 sm:inline">
                {usuario?.name}
              </span>
              <button
                onClick={() => void salir()}
                className="rounded text-sm font-medium text-ink-2 transition hover:text-claret"
              >
                Salir
              </button>
            </div>
          </div>

          <nav className="order-last flex w-full flex-wrap items-center gap-5 text-sm sm:order-none sm:-mb-3.5 sm:w-auto">
            {nav.map((item) => (
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
          <Route path="/cuentas" element={<Cuentas />} />
        </Routes>
      </main>
    </div>
  )
}

function Puerta() {
  const { usuario, cargando } = useSesion()
  if (cargando) return <Spinner label="Cargando" />
  return usuario ? <Shell /> : <Entrar />
}

export default function App() {
  // HashRouter evita configurar reescrituras en el servidor.
  return (
    <HashRouter>
      <ProveedorSesion>
        <Puerta />
      </ProveedorSesion>
    </HashRouter>
  )
}
