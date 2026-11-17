import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { hours, money } from '../lib/format.ts'
import { must, supabase } from '../lib/supabase.ts'
import { Empty, PageTitle, useWs } from './AppLayout.tsx'

type HoursRow = { year: number; entries: number; hours: number; rounded_hours: number; billable_hours: number }
type InvRow = { year: number | null; currency: string; status: string; invoices: number; total_cents: number; due_cents: number }
// Harvest record types as people call them; matches the import stages.
const TYPE_LABEL: Record<string, string> = {
  users: 'People', clients: 'Clients', contacts: 'Contacts', projects: 'Projects', tasks: 'Tasks',
  task_assignments: 'Task assignments', invoices: 'Invoices', estimates: 'Estimates', expenses: 'Expenses', time_entries: 'Time entries',
}
const STATUSES = [['draft', 'Draft'], ['sent', 'Open'], ['paid', 'Paid'], ['closed', 'Closed']] as const

export function ReconcilePage() {
  const ws = useWs()
  const q = useQuery({
    queryKey: ['reconcile', ws.id],
    queryFn: async () => {
      const [h, inv, bad, last] = await Promise.all([
        supabase.from('reconciliation_hours').select('*').eq('workspace_id', ws.id).order('year'),
        supabase.from('reconciliation_invoices').select('*').eq('workspace_id', ws.id).order('year').order('currency'),
        supabase.from('invoice_mismatches').select('id, number, currency, total_cents, items_cents').eq('workspace_id', ws.id),
        supabase.from('imports').select('status, progress').eq('workspace_id', ws.id).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      return {
        hours: must(h) as HoursRow[], invoices: must(inv) as InvRow[], mismatches: must(bad),
        last: must(last) as { status: string; progress: { skipped?: string[] } } | null,
      }
    },
  })
  if (q.isLoading) return <p className="text-muted">Loading…</p>
  if (q.error) return <p role="alert" className="text-danger">{q.error.message}</p>
  const { hours: hrs, invoices, mismatches, last } = q.data!
  const refused = last?.progress.skipped ?? []

  // One row per year and currency, one column per status.
  const groups = new Map<string, { year: number | null; currency: string; by: Record<string, InvRow> }>()
  for (const r of invoices) {
    const k = `${r.year}|${r.currency}`
    if (!groups.has(k)) groups.set(k, { year: r.year, currency: r.currency, by: {} })
    groups.get(k)!.by[r.status] = r
  }

  return (
    <>
      <PageTitle sub="Compare these with Harvest’s Time report and Invoices report for each calendar year. Hours are summed from Harvest’s exact decimal hours; money is summed in whole minor units per currency, never converted.">
        Reconcile with Harvest
      </PageTitle>

      {refused.length > 0 && (
        <div role="alert" className="card mb-6 border-warn p-4 text-sm text-ink">
          <p className="font-semibold text-warn">Not imported: {refused.map((t) => TYPE_LABEL[t] ?? t).join(', ')}</p>
          <p className="mt-1">
            Harvest refused these for the token used in the last import, so the totals below leave them out. Run the
            import again with a Harvest Administrator’s token to bring them across.{' '}
            <Link to="../import" className="text-accent underline">Go to Import</Link>
          </p>
        </div>
      )}
      {last && last.status !== 'succeeded' && (
        <p className="card mb-6 p-4 text-sm text-muted">
          {last.status === 'failed'
            ? 'The last import stopped before finishing, so these totals may be incomplete.'
            : 'An import is still running; these totals will change until it finishes.'}
        </p>
      )}
      {mismatches.length > 0 && (
        <div role="alert" className="card mb-6 border-danger p-4 text-sm text-danger">
          {mismatches.length} invoice{mismatches.length === 1 ? '' : 's'} where lines, discount and taxes don’t add up to the total Harvest gave:{' '}
          {mismatches.map((m) => <Link key={m.id} to={`../invoices/${m.id}`} className="mr-2 underline">{m.number}</Link>)}
        </div>
      )}

      <h2 className="mb-3 font-semibold text-ink">Hours by year</h2>
      {hrs.length === 0 ? <Empty>No time entries yet. <Link to="../import" className="text-accent underline">Import from Harvest</Link>.</Empty> : (
        <div className="table-wrap mb-10">
          <table>
            <thead><tr><th>Year</th><th className="num">Entries</th><th className="num">Hours</th><th className="num">Rounded hours</th><th className="num">Billable hours</th></tr></thead>
            <tbody>
              {hrs.map((r) => (
                <tr key={r.year}><td>{r.year}</td><td className="num">{r.entries.toLocaleString()}</td><td className="num">{hours(r.hours)}</td>
                  <td className="num">{hours(r.rounded_hours)}</td><td className="num">{hours(r.billable_hours)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-muted">Rounded hours use Harvest’s time-rounding setting, which its reports show when rounding is on.</p>
        </div>
      )}

      <h2 className="mb-3 font-semibold text-ink">Invoiced by year (by issue date)</h2>
      {groups.size === 0 ? <Empty>No invoices imported.</Empty> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Year</th><th>Currency</th>{STATUSES.map(([, l]) => <th key={l} className="num">{l}</th>)}<th className="num">Total excl. drafts</th><th className="num">Still due</th></tr>
            </thead>
            <tbody>
              {[...groups.values()].map(({ year, currency, by }) => {
                const nonDraft = Object.values(by).filter((r) => r.status !== 'draft')
                return (
                  <tr key={`${year}${currency}`}>
                    <td>{year ?? 'No date'}</td><td>{currency}</td>
                    {STATUSES.map(([s]) => (
                      <td key={s} className="num">{by[s] ? <>{money(by[s].total_cents, currency)}<span className="block text-xs text-muted">{by[s].invoices} inv.</span></> : '—'}</td>
                    ))}
                    <td className="num font-medium">{money(nonDraft.reduce((a, r) => a + r.total_cents, 0), currency)}</td>
                    <td className="num">{money(nonDraft.reduce((a, r) => a + r.due_cents, 0), currency)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
