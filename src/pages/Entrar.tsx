import { useState } from 'react'
import { useSesion } from '../auth/SesionContext.tsx'
import { useAccion } from '../api/hooks.ts'
import { Button, Field, Panel } from '../components/ui.tsx'
import { inputClass } from '../lib/classnames.ts'

type Modo = 'entrar' | 'registro'

export default function Entrar() {
  const { entrar, registrar, necesitaPrimeraCuenta } = useSesion()
  const { ejecutar, enviando, error, setError } = useAccion()
  const [modo, setModo] = useState<Modo>(necesitaPrimeraCuenta ? 'registro' : 'entrar')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [invite, setInvite] = useState('')

  const esRegistro = modo === 'registro'

  async function enviar(event: React.FormEvent) {
    event.preventDefault()
    await ejecutar(async () => {
      if (esRegistro) await registrar({ email, name, password, invite })
      else await entrar(email, password)
    })
  }

  function cambiarModo(siguiente: Modo) {
    setModo(siguiente)
    setError(null)
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-sm flex-col justify-center py-10">
      <div className="mb-8 text-center">
        <div className="mb-4 flex items-center justify-center gap-2">
          <span aria-hidden className="h-5 w-1 rounded-full bg-claret" />
          <span className="display text-2xl font-semibold text-ink">Flashcards</span>
        </div>
        <h1 className="display text-xl font-medium text-ink">
          {necesitaPrimeraCuenta
            ? 'Crea la primera cuenta'
            : esRegistro
              ? 'Crear una cuenta'
              : 'Entrar a tu cuenta'}
        </h1>
        <p className="mt-1.5 text-sm text-ink-2">
          {necesitaPrimeraCuenta
            ? 'Este servidor esta recien instalado. La primera cuenta queda como administradora y es la que reparte las invitaciones.'
            : esRegistro
              ? 'Necesitas un codigo de invitacion de quien administra este servidor.'
              : 'Tus mazos y tu progreso te esperan donde los dejaste.'}
        </p>
      </div>

      <Panel className="p-6">
        <form onSubmit={enviar} className="space-y-4">
          {esRegistro && (
            <Field label="Como te llamas">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
              />
            </Field>
          )}

          <Field label="Email">
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus={!esRegistro}
              required
            />
          </Field>

          <Field
            label="Contraseña"
            hint={esRegistro ? 'Al menos 10 caracteres, con letras y numeros.' : undefined}
          >
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={esRegistro ? 'new-password' : 'current-password'}
              required
            />
          </Field>

          {esRegistro && !necesitaPrimeraCuenta && (
            <Field label="Codigo de invitacion">
              <input
                className={`${inputClass} font-mono tracking-wider uppercase`}
                value={invite}
                onChange={(e) => setInvite(e.target.value.toUpperCase())}
                placeholder="XXXX-XXXX-XXXX"
                required
              />
            </Field>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" className="w-full py-2.5" disabled={enviando}>
            {enviando ? 'Un momento' : esRegistro ? 'Crear cuenta' : 'Entrar'}
          </Button>
        </form>
      </Panel>

      {!necesitaPrimeraCuenta && (
        <p className="mt-5 text-center text-sm text-ink-2">
          {esRegistro ? '¿Ya tenes cuenta?' : '¿Tenes un codigo de invitacion?'}{' '}
          <button
            type="button"
            onClick={() => cambiarModo(esRegistro ? 'entrar' : 'registro')}
            className="rounded font-medium text-claret transition hover:underline"
          >
            {esRegistro ? 'Entrar' : 'Crear una cuenta'}
          </button>
        </p>
      )}
    </div>
  )
}
