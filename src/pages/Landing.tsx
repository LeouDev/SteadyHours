import { Link } from 'react-router'
import { PRODUCT_NAME } from '../../supabase/functions/_shared/config.ts'
import { ImportScope } from '../lib/scope.tsx'
import { AuthForm, AuthShell } from './Auth.tsx'

export function Landing() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="font-semibold tracking-tight text-ink">{PRODUCT_NAME}</span>
        <Link to="/signin" className="text-sm text-muted hover:text-ink">Sign in</Link>
      </header>
      <main className="mx-auto max-w-5xl px-6 pb-20 pt-10 md:pt-20">
        <div className="grid gap-12 md:grid-cols-[1.2fr_1fr]">
          <section>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-ink md:text-5xl">Import your Harvest account</h1>
            <p className="mt-5 max-w-prose text-lg text-muted">
              Bring your clients, projects, time, expenses and invoices across in minutes. Check the totals year by
              year, then browse and export your history for free.
            </p>
            <ul className="mt-8 space-y-3 text-ink">
              {[
                'Invoices come across to the cent, with their taxes and discounts',
                'Totals by year to compare against Harvest’s own reports',
                'A read-only archive that stays free, with CSV and JSON export of everything imported',
              ].map((t) => (
                <li key={t} className="flex gap-3"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{t}</li>
              ))}
            </ul>
          </section>
          <section className="card p-6">
            <h2 className="text-lg font-semibold text-ink">Create your free account</h2>
            <p className="mb-5 mt-1 text-sm text-muted">No card needed. We’ll email you a link to confirm your address.</p>
            <AuthForm mode="signup" />
          </section>
        </div>
        <section className="card mt-12 p-6">
          <h2 className="mb-4 text-lg font-semibold text-ink">What the import brings across</h2>
          <ImportScope />
        </section>
      </main>
    </div>
  )
}

export function SignIn() {
  return (
    <AuthShell title="Sign in">
      <AuthForm mode="signin" />
      <p className="mt-6 text-sm text-muted">New here? <Link to="/" className="text-accent hover:underline">Create an account</Link></p>
    </AuthShell>
  )
}
