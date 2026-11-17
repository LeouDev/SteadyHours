import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { hours, money } from '../lib/format.ts'
import { must, supabase } from '../lib/supabase.ts'
import {
  Callout, EmptyState, Icon, PageHeader, Pill, ResultBand, SectionTitle, SkeletonRows, StepFlow, YearChip, stagger, type StepState,
} from '../lib/ui.tsx'
import { useWs } from './AppLayout.tsx'

type HoursRow = { year: number; entries: number; hours: number; rounded_hours: number; billable_hours: number }
type InvRow = { year: number | null; currency: string; status: string; invoices: number; total_cents: number; due_cents: number }
type Mismatch = { id: string; number: string; currency: string; total_cents: number; items_cents: number; subtotal_cents: number; discount_cents: number; tax_cents: number; tax2_cents: number }
type LastImport = { status: string; counts: Record<string, number>; progress: { skipped?: string[] }; started_at: string; finished_at: string | null }

// Harvest record types as people call them; matches the import stages.
const TYPE_LABEL: Record<string, string> = {
  users: 'People', clients: 'Clients', contacts: 'Contacts', projects: 'Projects', tasks: 'Tasks',
  task_assignments: 'Task assignments', invoices: 'Invoices', estimates: 'Estimates', expenses: 'Expenses', time_entries: 'Time entries',
}
const STATUSES = [['draft', 'Draft'], ['sent', 'Open'], ['paid', 'Paid'], ['closed', 'Closed']] as const
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const listJoin = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

function duration(from: string, to: string | null) {
  if (!to) return ''
  const s = Math.max(1, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`
}

export function ReconcilePage() {
  const ws = useWs()
  const q = useQuery({
    queryKey: ['reconcile', ws.id],
    queryFn: async () => {
      const [h, inv, bad, last] = await Promise.all([
        supabase.from('reconciliation_hours').select('*').eq('workspace_id', ws.id).order('year', { ascending: false }),
        supabase.from('reconciliation_invoices').select('*').eq('workspace_id', ws.id).order('year', { ascending: false }).order('currency'),
        supabase.from('invoice_mismatches').select('*').eq('workspace_id', ws.id),
        supabase.from('imports').select('status, counts, progress, started_at, finished_at').eq('workspace_id', ws.id)
          .order('started_at', { ascending: false }).limit(1).maybeSingle(),
      ])
      const mismatches = must(bad) as Mismatch[]
      // Which year each mismatched invoice belongs to, so its row can say so.
      const years = mismatches.length
        ? must(await supabase.from('invoices').select('id, issue_date').eq('workspace_id', ws.id).in('id', mismatches.map((m) => m.id)))
        : []
      return {
        hours: must(h) as HoursRow[], invoices: must(inv) as InvRow[], mismatches, last: must(last) as LastImport | null,
        mismatchYears: new Map((years as { id: string; issue_date: string | null }[]).map((r) => [r.id, r.issue_date ? Number(r.issue_date.slice(0, 4)) : null])),
      }
    },
  })

  if (q.isLoading) {
    return (
      <>
        <PageHeader eyebrow="Reconciliation" title={<>Your totals,<br />year by year</>} />
        <SkeletonRows rows={5} />
      </>
    )
  }
  if (q.error) return <Callout tone="danger" role="alert" title="We couldn’t load the totals.">Refresh the page to try again.</Callout>
  const { hours: hrs, invoices, mismatches, last, mismatchYears } = q.data!
  const refused = (last?.progress.skipped ?? []).map((t) => TYPE_LABEL[t] ?? t)
  const invoicesRefused = last?.progress.skipped?.includes('invoices') ?? false

  if (!last && hrs.length === 0 && invoices.length === 0) {
    return (
      <>
        <PageHeader eyebrow="Reconciliation" title={<>Your totals,<br />year by year</>} />
        <EmptyState icon="reconcile" title="Nothing to reconcile yet">
          Import your Harvest account and the totals appear here, year by year. <Link to="../import" className="link">Start an import</Link>
        </EmptyState>
      </>
    )
  }

  // Years across hours and invoices, newest first.
  const years = [...new Set([...hrs.map((r) => r.year), ...invoices.map((r) => r.year).filter((y): y is number => y !== null)])].sort((a, b) => b - a)
  const hoursBy = new Map(hrs.map((r) => [r.year, r]))
  const invoicedBy = new Map<number, Map<string, { total: number; due: number; count: number }>>()
  for (const r of invoices) {
    if (r.year === null || r.status === 'draft') continue
    const byCur = invoicedBy.get(r.year) ?? new Map()
    const cur = byCur.get(r.currency) ?? { total: 0, due: 0, count: 0 }
    byCur.set(r.currency, { total: cur.total + r.total_cents, due: cur.due + r.due_cents, count: cur.count + r.invoices })
    invoicedBy.set(r.year, byCur)
  }
  const invoiceCountBy = new Map<number, number>()
  for (const r of invoices) if (r.year !== null) invoiceCountBy.set(r.year, (invoiceCountBy.get(r.year) ?? 0) + r.invoices)
  const mismatchCountBy = new Map<number, number>()
  for (const m of mismatches) {
    const y = mismatchYears.get(m.id)
    if (y) mismatchCountBy.set(y, (mismatchCountBy.get(y) ?? 0) + 1)
  }

  // Headline totals: all hours, and invoiced (excluding drafts) per currency, never converted.
  const totalHours = hrs.reduce((s, r) => s + Number(r.hours), 0)
  const totalEntries = hrs.reduce((s, r) => s + r.entries, 0)
  const invoicedByCurrency = new Map<string, number>()
  for (const r of invoices) if (r.status !== 'draft') invoicedByCurrency.set(r.currency, (invoicedByCurrency.get(r.currency) ?? 0) + r.total_cents)
  const totalInvoices = invoices.reduce((s, r) => s + r.invoices, 0)

  const running = last?.status === 'queued' || last?.status === 'running'
  const records = Object.values(last?.counts ?? {}).reduce((s, n) => s + n, 0)
  const importState: StepState = !last ? 'waiting' : running ? 'active' : last.status === 'failed' ? 'warn' : 'done'
  const needsLook = mismatches.length > 0 || refused.length > 0
  const reconcileState: StepState = importState !== 'done' ? 'waiting' : needsLook ? 'warn' : 'done'
  const reconcileDetail = mismatches.length
    ? `${plural(mismatches.length, 'invoice')} ${mismatches.length === 1 ? 'doesn’t' : 'don’t'} add up`
    : refused.length ? `${listJoin(refused)} not imported` : totalInvoices ? 'Every invoice adds up' : 'Totals ready to compare'

  // The headline states the result: the promise only when nothing needs attention.
  const attention = needsLook || last?.status === 'failed'
  const headline = attention ? <>Something here<br />needs a look.</> : running ? <>Your totals<br />are coming in.</> : <>Every hour.<br />Every cent.</>
  const eyebrow = !last ? 'Reconciliation' : running ? 'Import running' : last.status === 'failed' ? 'Import stopped' : 'Import complete'

  return (
    <>
      <PageHeader
        eyebrow={eyebrow}
        title={headline}
        sub="Compare these totals with Harvest’s Time and Invoices reports, year by year. Hours use Harvest’s exact decimals; money is added up per currency, never converted."
        action={<Link to="../export" className="btn-primary"><Icon name="export" size={16} /> Export everything</Link>}
      />

      <StepFlow className="rise" steps={[
        { label: 'Connect', detail: 'Harvest account linked', state: last ? 'done' : 'waiting' },
        {
          label: 'Import', state: importState,
          detail: running ? 'Still running' : last?.status === 'failed' ? 'Stopped before finishing' : last ? `${records.toLocaleString()} records in ${duration(last.started_at, last.finished_at)}` : undefined,
        },
        { label: 'Reconcile', detail: importState === 'done' ? reconcileDetail : undefined, state: reconcileState },
      ]} />

      {(refused.length > 0 || mismatches.length > 0 || (last && last.status !== 'succeeded')) && (
        <div className="mt-4 flex flex-col gap-3">
          {refused.length > 0 && (
            <Callout tone="warn" title={`Not imported: ${listJoin(refused)}`}>
              Harvest refused these for the token used in the last import, so the totals below leave them out. Run the import again
              with a Harvest Administrator’s token to bring them across. <Link to="../import" className="link">Go to Import</Link>
            </Callout>
          )}
          {mismatches.length > 0 && (
            <Callout tone="warn" title={`${plural(mismatches.length, 'invoice')} ${mismatches.length === 1 ? 'doesn’t' : 'don’t'} add up`}>
              Its lines, discount and taxes don’t sum to the total Harvest gave. It’s listed below; check it against Harvest before relying on that year’s total.
            </Callout>
          )}
          {last && last.status === 'failed' && (
            <Callout tone="danger" title="The last import stopped before finishing">These totals may be incomplete. Start the import again from the Import page.</Callout>
          )}
          {running && <Callout tone="info" title="An import is still running">These totals will change until it finishes.</Callout>}
        </div>
      )}

      <section aria-label="Totals" className="rise mt-6 flex flex-wrap gap-3 sm:gap-4"
        style={{ '--delay': '120ms', '--per': perRow(1 + invoicedByCurrency.size) } as React.CSSProperties}>
        <div className="card total-card flex flex-col gap-1 px-4 py-4 sm:px-6 sm:py-5">
          <span className="text-[13px] text-muted">Hours tracked</span>
          <span className="figure text-[26px] sm:text-[34px]">{hours(totalHours)}</span>
          <span className="text-[13px] text-muted">{plural(totalEntries, 'time entry', 'time entries')}</span>
        </div>
        {[...invoicedByCurrency].map(([cur, cents]) => (
          <div key={cur} className="card total-card flex flex-col gap-1 px-4 py-4 sm:px-6 sm:py-5">
            <span className="text-[13px] text-muted">Invoiced in {cur} <span className="sr-only">(excluding drafts)</span></span>
            <span className="figure text-[26px] sm:text-[34px]">{money(cents, cur)}</span>
            <span className="text-[13px] text-muted">Excluding drafts</span>
          </div>
        ))}
      </section>

      <SectionTitle sub="Hours by the date worked; invoices by issue date, excluding drafts.">Year by year</SectionTitle>
      <div className="overflow-x-auto">
        <table className="rows min-w-[720px]">
          <caption className="sr-only">Hours and invoiced totals for each year</caption>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col" className="num">Entries</th>
              <th scope="col" className="num">Hours</th>
              <th scope="col" className="num">Billable hours</th>
              <th scope="col" className="num">Invoiced</th>
              <th scope="col" className="num">Still due</th>
              <th scope="col">Invoices</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y, i) => {
              const h = hoursBy.get(y)
              const inv = [...(invoicedBy.get(y) ?? new Map())]
              const bad = mismatchCountBy.get(y) ?? 0
              const count = invoiceCountBy.get(y) ?? 0
              return (
                <tr key={y} className="row-rise" style={stagger(i)}>
                  <th scope="row"><YearChip>{y}</YearChip></th>
                  <td className="num text-muted">{h ? h.entries.toLocaleString() : '—'}</td>
                  <td className="num font-semibold">{h ? hours(h.hours) : '—'}</td>
                  <td className="num text-muted">{h ? hours(h.billable_hours) : '—'}</td>
                  <td className="num font-semibold">{inv.length ? inv.map(([c, v]) => <span key={c} className="block">{money(v.total, c)}</span>) : '—'}</td>
                  <td className="num text-muted">{inv.length ? inv.map(([c, v]) => <span key={c} className="block">{money(v.due, c)}</span>) : '—'}</td>
                  <td>
                    <span className="pop inline-block">
                      {bad > 0 ? <Pill tone="warn">{bad} {bad === 1 ? 'doesn’t' : 'don’t'} add up</Pill>
                        : invoicesRefused ? <Pill tone="neutral">Not imported</Pill>
                        : count > 0 ? <Pill tone="ok">Adds up</Pill>
                        : <Pill tone="neutral">None</Pill>}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {hrs.some((r) => Number(r.rounded_hours) !== Number(r.hours)) && (
        <p className="mt-1 text-[13px] text-muted">
          Harvest’s reports show rounded hours when time rounding is on. Rounded totals:{' '}
          {hrs.map((r) => `${r.year} ${hours(r.rounded_hours)}`).join(' · ')}.
        </p>
      )}

      {mismatches.length > 0 && (
        <>
          <SectionTitle sub="Lines − discount + taxes, compared with the total Harvest gave.">Invoices that don’t add up</SectionTitle>
          <div className="overflow-x-auto">
            <table className="rows min-w-[640px]">
              <caption className="sr-only">Invoices whose parts don’t sum to their total</caption>
              <thead><tr><th scope="col">Invoice</th><th scope="col" className="num">Lines − discount + taxes</th><th scope="col" className="num">Harvest total</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {mismatches.map((m, i) => (
                  <tr key={m.id} className="row-rise" style={stagger(i)}>
                    <th scope="row"><Link to={`../invoices/${m.id}`} className="link inline-flex min-h-11 items-center">{m.number}</Link></th>
                    <td className="num">{money(m.items_cents - m.discount_cents + m.tax_cents + m.tax2_cents, m.currency)}</td>
                    <td className="num font-semibold">{money(m.total_cents, m.currency)}</td>
                    <td><span className="pop inline-block"><Pill tone="warn">Doesn’t add up</Pill></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {invoices.length > 0 && (
        <>
          <SectionTitle sub="The same split as Harvest’s Invoices report: one row per year and currency.">Invoices by status</SectionTitle>
          <div className="overflow-x-auto">
            <table className="rows min-w-[760px]">
              <caption className="sr-only">Invoiced totals by year, currency and status</caption>
              <thead>
                <tr>
                  <th scope="col">Year</th><th scope="col">Currency</th>
                  {STATUSES.map(([, l]) => <th key={l} scope="col" className="num">{l}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...groupByYearCurrency(invoices)].map(([k, { year, currency, by }], i) => (
                  <tr key={k} className="row-rise" style={stagger(i)}>
                    <th scope="row">{year ? <YearChip>{year}</YearChip> : <span className="text-muted">No date</span>}</th>
                    <td className="font-medium">{currency}</td>
                    {STATUSES.map(([s]) => (
                      <td key={s} className="num">
                        {by[s] ? <><span className="font-semibold">{money(by[s].total_cents, currency)}</span><span className="block text-xs text-muted">{plural(by[s].invoices, 'invoice')}</span></> : <span className="text-muted">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {importState === 'done' && (
        <ResultBand className="rise mt-10" tone={needsLook ? 'warn' : 'accent'}>
          {mismatches.length > 0
            ? `${plural(mismatches.length, 'invoice')} ${mismatches.length === 1 ? 'needs' : 'need'} a look before you rely on these totals.`
            : refused.length > 0
              ? `Everything imported adds up, but ${listJoin(refused).toLowerCase()} ${refused.length === 1 ? 'was' : 'were'} not imported.`
              : totalInvoices > 0 ? 'Every imported invoice adds up, to the cent.' : `${plural(totalEntries, 'time entry', 'time entries')} imported, hour for hour.`}
        </ResultBand>
      )}
    </>
  )
}

/** Cards per row so rows split evenly: 4 → 2 + 2, 5 → 3 + 2 (widened), 6 → 3 + 3, at most 3 a row. */
function perRow(n: number) {
  return Math.ceil(n / Math.ceil(n / 3))
}

function groupByYearCurrency(rows: InvRow[]) {
  const groups = new Map<string, { year: number | null; currency: string; by: Record<string, InvRow> }>()
  for (const r of rows) {
    const k = `${r.year}|${r.currency}`
    if (!groups.has(k)) groups.set(k, { year: r.year, currency: r.currency, by: {} })
    groups.get(k)!.by[r.status] = r
  }
  return groups
}
