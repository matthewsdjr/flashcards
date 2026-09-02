import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import Decks from './pages/Decks'
import DeckDetail from './pages/DeckDetail'
import Import from './pages/Import'
import Study from './pages/Study'
import Stats from './pages/Stats'
import Settings from './pages/Settings'
import { cx } from './lib/classnames'

const NAV = [
  { to: '/', label: 'Mazos', end: true },
  { to: '/importar', label: 'Importar', end: false },
  { to: '/estadisticas', label: 'Estadisticas', end: false },
  { to: '/ajustes', label: 'Ajustes', end: false },
]

function Shell() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-md bg-indigo-600 text-sm text-white"
            >
              F
            </span>
            Flashcards
          </NavLink>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cx(
                    'rounded-lg px-3 py-1.5 font-medium transition',
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">
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
