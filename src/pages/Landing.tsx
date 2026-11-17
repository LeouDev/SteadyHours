import { Link, useSearchParams } from 'react-router'
import { PRODUCT_NAME } from '../../supabase/functions/_shared/config.ts'
import { ImportScope } from '../lib/scope.tsx'
import { Icon, Pill, ResultBand, YearChip, stagger } from '../lib/ui.tsx'
import { AuthForm, AuthShell } from './Auth.tsx'
import { Footer } from './Legal.tsx'

// Illustration only: clearly labelled as an example on the page.
const EXAMPLE = [
  { year: 2026, money: '$136,714.25' },
  { year: 2025, money: '$158,120.00' },
  { year: 2024, money: '$163,975.25' },
  { year: 2023, money: '$168,310.00' },
]

export function Landing() {
  const [params] = useSearchParams()
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-5 sm:px-8">
        <span className="display text-2xl" style={{ letterSpacing: '-0.02em' }}>{PRODUCT_NAME}</span>
        <nav aria-label="Site" className="flex flex-wrap items-center gap-x-6 text-[15px]">
          <a href="#scope" className="inline-flex min-h-11 items-center hover:text-accent">What comes across</a>
          <Link to="/your-harvest-data" className="inline-flex min-h-11 items-center hover:text-accent">Your data</Link>
          <Link to="/signin" className="inline-flex min-h-11 items-center font-semibold hover:text-accent">Sign in</Link>
        </nav>
      </header>

      {params.get('deleted') && (
        <p role="status" className="mx-auto mb-2 max-w-[1120px] px-5 sm:px-8">
          <span className="pill bg-ok-soft text-ok">Your workspace, its data and your login have been deleted.</span>
        </p>
      )}

      <main>
        <div className="mx-auto grid max-w-[1120px] items-center gap-x-12 gap-y-12 px-5 pb-14 pt-8 sm:px-8 md:pt-12 lg:grid-cols-[1.12fr_1fr]">
          <section className="rise flex min-w-0 flex-col gap-6">
            <span className="eyebrow">Leaving Harvest</span>
            <h1 className="display text-[44px] leading-none sm:text-[60px] lg:text-[56px] xl:text-[62px]" style={{ letterSpacing: '-0.035em' }}>
              <span className="sm:whitespace-nowrap">Bring your history.</span><br />
              <span className="sm:whitespace-nowrap">Check every cent.</span>
            </h1>
            <p className="max-w-[30rem] text-lg text-muted">
              Import your clients, projects, time, expenses and invoices in minutes, then compare the totals with Harvest’s own reports, year by year.
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link to="/signup" className="btn-primary min-h-[52px] px-6 text-base">
                Import my Harvest account <Icon name="arrow" size={16} />
              </Link>
              <a href="#scope" className="link inline-flex min-h-11 items-center">See what comes across</a>
            </div>
            <p className="text-sm text-muted">Free archive. No card needed. Export everything whenever you like.</p>
          </section>

          <section aria-label="Example of the reconciliation screen" className="rise flex min-w-0 flex-col gap-4" style={{ '--delay': '150ms' } as React.CSSProperties}>
            <div className="card lift flex flex-wrap items-center gap-x-3.5 gap-y-2 self-start rounded-[18px] px-5 py-3.5 text-sm font-semibold">
              {['Connect', 'Import', 'Reconcile'].map((s, i) => (
                <span key={s} className="flex items-center gap-3.5">
                  {i > 0 && <span className="text-accent"><Icon name="arrow" size={14} /></span>}
                  <span className="flex items-center gap-2"><span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-ok-soft text-ok"><Icon name="check" size={14} /></span>{s}</span>
                </span>
              ))}
            </div>
            <div className="overflow-hidden rounded-[22px] border border-line-strong bg-surface" style={{ boxShadow: 'var(--shadow-window)' }}>
              <div className="flex items-center gap-3.5 border-b border-line bg-raise px-4 py-3.5">
                <span aria-hidden className="flex gap-1.5">{[0, 1, 2].map((d) => <span key={d} className="h-2.5 w-2.5 rounded-full bg-line-strong" />)}</span>
                <span className="text-[13px] text-muted">Reconciliation · example</span>
              </div>
              <div className="flex flex-col gap-4 p-6">
                <div>
                  <span className="text-[13px] text-muted">Invoiced, 2023 to 2026</span>
                  <p className="figure text-[38px]">$627,119.50</p>
                </div>
                <ul className="flex flex-col gap-2.5">
                  {EXAMPLE.map((r, i) => (
                    <li key={r.year} style={stagger(i + 4)} className="row-rise flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-[14px] border border-line px-3.5 py-3">
                      <YearChip>{r.year}</YearChip>
                      <span className="flex flex-[1_1_120px] flex-col leading-tight">
                        <span className="font-semibold">{r.money}</span>
                        <span className="text-xs text-muted">Lines, taxes and discounts checked</span>
                      </span>
                      <span className="pop"><Pill tone="ok">Adds up</Pill></span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>

        <div className="mx-auto max-w-[1120px] px-5 sm:px-8">
          <ResultBand className="rise">Invoices come across to the cent, with every tax and discount.</ResultBand>

          <section aria-label="Why it works" className="mt-6 grid gap-4 sm:grid-cols-3">
            {[
              ['Exact, and checkable', 'Invoices arrive with their line items, taxes and discounts. Totals by year sit ready to compare with Harvest’s reports.'],
              ['Honest about the gaps', 'Recurring schedules, individual payments and estimate line items don’t come across. We say so before you start.'],
              ['Yours to take away', 'The archive stays free, and a full CSV or JSON export is one click.'],
            ].map(([t, d], i) => (
              <div key={t} className="card row-rise flex flex-col gap-1.5 px-6 py-5" style={stagger(i)}>
                <h2 className="font-semibold">{t}</h2>
                <p className="text-[15px] text-muted">{d}</p>
              </div>
            ))}
          </section>

          <section id="scope" aria-labelledby="scope-heading" className="card mb-16 mt-12 scroll-mt-6 p-6 sm:p-8">
            <h2 id="scope-heading" className="display mb-5 text-2xl" style={{ letterSpacing: '-0.02em' }}>What the import brings across</h2>
            <ImportScope />
          </section>
        </div>
      </main>
      <Footer />
    </div>
  )
}

export function SignUp() {
  return (
    <AuthShell eyebrow="Free account" title="Create your account">
      <p className="-mt-2 mb-5 text-sm text-muted">No card needed. We’ll email you a link to confirm your address.</p>
      <AuthForm mode="signup" />
      <p className="mt-6 text-sm text-muted">Already have an account? <Link to="/signin" className="link">Sign in</Link></p>
    </AuthShell>
  )
}

export function SignIn() {
  return (
    <AuthShell eyebrow="Welcome back" title="Sign in">
      <AuthForm mode="signin" />
      <p className="mt-6 text-sm text-muted">New here? <Link to="/signup" className="link">Create an account</Link></p>
    </AuthShell>
  )
}
