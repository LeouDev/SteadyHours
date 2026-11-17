import { Link } from 'react-router'
import { PRODUCT_NAME } from '../../supabase/functions/_shared/config.ts'
import { AuthForm } from './Auth.tsx'

export function Landing() {
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="font-semibold tracking-tight text-ink">{PRODUCT_NAME}</span>
        <Link to="/signin" className="text-sm text-muted hover:text-ink">Sign in</Link>
      </header>
      <main className="mx-auto grid max-w-5xl gap-12 px-6 pb-20 pt-10 md:grid-cols-[1.2fr_1fr] md:pt-20">
        <section>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight text-ink md:text-5xl">Import your Harvest account</h1>
          <p className="mt-5 max-w-prose text-lg text-muted">
            Bring every client, project, time entry and invoice across in minutes. Check the totals year by year,
            then browse and export your full history for free.
          </p>
          <ul className="mt-8 space-y-3 text-ink">
            {[
              'Invoices come across to the cent, with every tax and discount line',
              'Totals by year to compare against Harvest’s own reports',
              'A read-only archive that stays free, with full CSV and JSON export',
            ].map((t) => (
              <li key={t} className="flex gap-3"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{t}</li>
            ))}
          </ul>
        </section>
        <section className="card p-6">
          <h2 className="text-lg font-semibold text-ink">Create your free account</h2>
          <p className="mb-5 mt-1 text-sm text-muted">No card needed. Your workspace is ready as soon as you sign up.</p>
          <AuthForm mode="signup" />
        </section>
      </main>
    </div>
  )
}

export function SignIn() {
  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6">
      <div className="card w-full max-w-sm p-6">
        <Link to="/" className="text-sm font-semibold text-ink">{PRODUCT_NAME}</Link>
        <h1 className="mb-5 mt-4 text-xl font-semibold text-ink">Sign in</h1>
        <AuthForm mode="signin" />
        <p className="mt-6 text-sm text-muted">New here? <Link to="/" className="text-accent hover:underline">Create an account</Link></p>
      </div>
    </div>
  )
}
