import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { date, entryHours, hours, money } from '../lib/format.ts'
import { must, supabase } from '../lib/supabase.ts'
import { Empty, PageTitle, useWs } from './AppLayout.tsx'

const PAGE = 100

/** All clients/projects/people for filter dropdowns (small tables; one request each). */
function useLookups(wsId: string) {
  return useQuery({
    queryKey: ['lookups', wsId],
    queryFn: async () => {
      const [c, p, m] = await Promise.all([
        supabase.from('clients').select('id, name, currency, is_archived').eq('workspace_id', wsId).order('name'),
        supabase.from('projects').select('id, name, client_id, is_archived').eq('workspace_id', wsId).order('name'),
        supabase.from('memberships').select('id, name, is_active').eq('workspace_id', wsId).order('name'),
      ])
      return { clients: must(c), projects: must(p), people: must(m) }
    },
  })
}

function Pager({ page, count, onPage }: { page: number; count: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(count / PAGE))
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-muted">
      <span>{count.toLocaleString()} total</span>
      <span className="flex items-center gap-2">
        <button className="btn-secondary" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page + 1} of {pages}</span>
        <button className="btn-secondary" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </div>
  )
}

function Status({ archived }: { archived: boolean }) {
  return archived ? <span className="badge">Archived</span> : <span className="badge badge-ok">Active</span>
}

export function ClientsPage() {
  const ws = useWs()
  const q = useQuery({
    queryKey: ['clients', ws.id],
    queryFn: async () => must(await supabase.from('clients')
      .select('id, name, currency, address, is_archived, contacts(name, email), projects(count)')
      .eq('workspace_id', ws.id).order('is_archived').order('name')),
  })
  return (
    <>
      <PageTitle>Clients</PageTitle>
      {q.error && <p role="alert" className="text-danger">{q.error.message}</p>}
      {q.data?.length === 0 && <Empty>No clients yet.</Empty>}
      {!!q.data?.length && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Currency</th><th>Contacts</th><th className="num">Projects</th><th>Status</th></tr></thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`../projects?client=${c.id}`} className="font-medium text-ink hover:underline">{c.name}</Link>
                    {c.address && <span className="block whitespace-pre-line text-xs text-muted">{c.address}</span>}</td>
                  <td>{c.currency}</td>
                  <td className="text-sm">{c.contacts.map((p: { name: string; email: string | null }) => <span key={p.name + p.email} className="block">{p.name}{p.email && <span className="text-muted"> · {p.email}</span>}</span>)}</td>
                  <td className="num">{(c.projects as unknown as { count: number }[])[0]?.count ?? 0}</td>
                  <td><Status archived={c.is_archived} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

export function ProjectsPage() {
  const ws = useWs()
  const [params, setParams] = useSearchParams()
  const clientId = params.get('client') ?? ''
  const lookups = useLookups(ws.id)
  const q = useQuery({
    queryKey: ['projects', ws.id, clientId],
    queryFn: async () => {
      let req = supabase.from('projects')
        .select('id, name, code, is_billable, hourly_rate_cents, is_archived, client:clients(name, currency)')
        .eq('workspace_id', ws.id).order('is_archived').order('name')
      if (clientId) req = req.eq('client_id', clientId)
      return must(await req)
    },
  })
  return (
    <>
      <PageTitle>Projects</PageTitle>
      <div className="mb-4 max-w-xs">
        <label htmlFor="pclient" className="block text-sm font-medium text-ink">Client</label>
        <select id="pclient" className="field mt-1" value={clientId} onChange={(e) => setParams(e.target.value ? { client: e.target.value } : {})}>
          <option value="">All clients</option>
          {lookups.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {q.error && <p role="alert" className="text-danger">{q.error.message}</p>}
      {q.data?.length === 0 && <Empty>No projects.</Empty>}
      {!!q.data?.length && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Project</th><th>Client</th><th>Code</th><th className="num">Hourly rate</th><th>Billable</th><th>Status</th></tr></thead>
            <tbody>
              {q.data.map((p) => {
                const client = p.client as unknown as { name: string; currency: string }
                return (
                  <tr key={p.id}>
                    <td><Link to={`../time?project=${p.id}`} className="font-medium text-ink hover:underline">{p.name}</Link></td>
                    <td>{client.name}</td><td className="text-muted">{p.code ?? ''}</td>
                    <td className="num">{money(p.hourly_rate_cents, client.currency)}</td>
                    <td>{p.is_billable ? 'Yes' : 'No'}</td><td><Status archived={p.is_archived} /></td>
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

export function TimePage() {
  const ws = useWs()
  const [params, setParams] = useSearchParams()
  const f = { from: params.get('from') ?? '', to: params.get('to') ?? '', client: params.get('client') ?? '', project: params.get('project') ?? '', person: params.get('person') ?? '' }
  const page = Number(params.get('page') ?? 0)
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    if (k !== 'page') next.delete('page')
    setParams(next)
  }
  const lookups = useLookups(ws.id)
  const q = useQuery({
    queryKey: ['time', ws.id, f, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let req = supabase.from('time_entries')
        .select('id, spent_on, minutes, source_hours, notes, is_billable, is_billed, rate_cents, project:projects!inner(name, client_id, client:clients(name, currency)), task:tasks(name), person:memberships(name), invoice:invoices(id, number)', { count: 'exact' })
        .eq('workspace_id', ws.id)
      if (f.from) req = req.gte('spent_on', f.from)
      if (f.to) req = req.lte('spent_on', f.to)
      if (f.project) req = req.eq('project_id', f.project)
      if (f.client) req = req.eq('projects.client_id', f.client)
      if (f.person) req = req.eq('membership_id', f.person)
      const { data, error, count } = await req.order('spent_on', { ascending: false }).order('id').range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw new Error(error.message)
      return { rows: data, count: count ?? 0 }
    },
  })
  const projects = lookups.data?.projects.filter((p) => !f.client || p.client_id === f.client) ?? []

  return (
    <>
      <PageTitle>Time entries</PageTitle>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label htmlFor="f-from" className="text-sm font-medium text-ink">From<input id="f-from" type="date" className="field mt-1" value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label htmlFor="f-to" className="text-sm font-medium text-ink">To<input id="f-to" type="date" className="field mt-1" value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
        <label htmlFor="f-client" className="text-sm font-medium text-ink">Client
          <select id="f-client" className="field mt-1" value={f.client} onChange={(e) => set('client', e.target.value)}>
            <option value="">All</option>{lookups.data?.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label htmlFor="f-project" className="text-sm font-medium text-ink">Project
          <select id="f-project" className="field mt-1" value={f.project} onChange={(e) => set('project', e.target.value)}>
            <option value="">All</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        <label htmlFor="f-person" className="text-sm font-medium text-ink">Person
          <select id="f-person" className="field mt-1" value={f.person} onChange={(e) => set('person', e.target.value)}>
            <option value="">All</option>{lookups.data?.people.map((p) => <option key={p.id} value={p.id}>{p.name || 'Unnamed'}{p.is_active ? '' : ' (inactive)'}</option>)}
          </select></label>
      </div>
      {q.error && <p role="alert" className="text-danger">{q.error.message}</p>}
      {q.data?.count === 0 && <Empty>No time entries match.</Empty>}
      {!!q.data?.count && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Person</th><th>Client / project</th><th>Task</th><th>Notes</th><th className="num">Hours</th><th className="num">Rate</th><th>Billing</th></tr></thead>
            <tbody>
              {q.data.rows.map((e) => {
                const project = e.project as unknown as { name: string; client: { name: string; currency: string } }
                const invoice = e.invoice as unknown as { id: string; number: string } | null
                return (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap">{date(e.spent_on)}</td>
                    <td>{(e.person as unknown as { name: string }).name}</td>
                    <td><span className="block text-xs text-muted">{project.client.name}</span>{project.name}</td>
                    <td>{(e.task as unknown as { name: string }).name}</td>
                    <td className="max-w-xs text-sm text-muted">{e.notes}</td>
                    <td className="num">{hours(entryHours(e))}</td>
                    <td className="num">{e.is_billable ? money(e.rate_cents, project.client.currency) : '—'}</td>
                    <td className="text-sm">
                      {invoice ? <Link to={`../invoices/${invoice.id}`} className="text-accent hover:underline">{invoice.number}</Link>
                        : e.is_billed ? 'Billed' : e.is_billable ? <span className="text-muted">Unbilled</span> : <span className="text-muted">Non-billable</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pager page={page} count={q.data.count} onPage={(p) => set('page', String(p))} />
        </div>
      )}
    </>
  )
}

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', sent: 'Open', paid: 'Paid', void: 'Void', closed: 'Closed' }

export function InvoicesPage() {
  const ws = useWs()
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const q = useQuery({
    queryKey: ['invoices', ws.id, status, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let req = supabase.from('invoices')
        .select('id, number, status, issue_date, due_date, currency, total_cents, due_cents, client:clients(name)', { count: 'exact' })
        .eq('workspace_id', ws.id)
      if (status) req = req.eq('status', status)
      const { data, error, count } = await req.order('issue_date', { ascending: false, nullsFirst: false }).order('number', { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1)
      if (error) throw new Error(error.message)
      return { rows: data, count: count ?? 0 }
    },
  })
  return (
    <>
      <PageTitle>Invoices</PageTitle>
      <div className="mb-4 max-w-xs">
        <label htmlFor="istatus" className="block text-sm font-medium text-ink">Status</label>
        <select id="istatus" className="field mt-1" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>
          <option value="">All</option>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {q.error && <p role="alert" className="text-danger">{q.error.message}</p>}
      {q.data?.count === 0 && <Empty>No invoices.</Empty>}
      {!!q.data?.count && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Number</th><th>Client</th><th>Issued</th><th>Status</th><th className="num">Total</th><th className="num">Due</th></tr></thead>
            <tbody>
              {q.data.rows.map((i) => (
                <tr key={i.id}>
                  <td><Link to={i.id} className="font-medium text-ink hover:underline">{i.number}</Link></td>
                  <td>{(i.client as unknown as { name: string }).name}</td>
                  <td className="whitespace-nowrap">{date(i.issue_date)}</td>
                  <td><span className={`badge ${i.status === 'paid' ? 'badge-ok' : ''}`}>{STATUS_LABEL[i.status]}</span></td>
                  <td className="num">{money(i.total_cents, i.currency)}</td>
                  <td className="num">{i.due_cents ? money(i.due_cents, i.currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} count={q.data.count} onPage={setPage} />
        </div>
      )}
    </>
  )
}

type InvoiceDetail = {
  number: string; status: string; subject: string | null; notes: string | null; currency: string
  issue_date: string | null; due_date: string | null; paid_at: string | null
  subtotal_cents: number; discount_rate: number | null; discount_cents: number; tax_rate: number | null; tax_cents: number
  tax2_rate: number | null; tax2_cents: number; total_cents: number; due_cents: number
  client: { name: string; address: string | null }
  invoice_items: { id: string; kind: string; description: string; quantity: number; unit_price_cents: number; amount_cents: number; taxed: boolean; taxed2: boolean; project: { name: string } | null }[]
  time_entries: { count: number }[]
}

export function InvoicePage() {
  const ws = useWs()
  const { id } = useParams()
  const q = useQuery({
    queryKey: ['invoice', ws.id, id],
    queryFn: async () => must(await supabase.from('invoices')
      .select('*, client:clients(name, address), invoice_items(id, kind, description, quantity, unit_price_cents, amount_cents, taxed, taxed2, project:projects(name)), time_entries(count)')
        .eq('workspace_id', ws.id).eq('id', id!).order('source_id', { referencedTable: 'invoice_items' }).single()) as unknown as InvoiceDetail,
  })
  if (q.isLoading) return <p className="text-muted">Loading…</p>
  if (q.error) return <p role="alert" className="text-danger">{q.error.message}</p>
  const i = q.data!
  const c = i.currency
  const client = i.client
  const rate = (r: number | null) => (r === null ? '' : ` (${Number(r)}%)`)

  return (
    <>
      <Link to=".." relative="path" className="text-sm text-muted hover:text-ink">← Invoices</Link>
      <div className="card mt-3 max-w-4xl p-6">
        <div className="flex flex-wrap justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Invoice {i.number}</h1>
            <p className="mt-1 text-muted">{client.name}</p>
            {i.subject && <p className="mt-1 text-sm text-muted">{i.subject}</p>}
          </div>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Status</dt><dd>{STATUS_LABEL[i.status]}</dd>
            <dt className="text-muted">Issued</dt><dd>{date(i.issue_date)}</dd>
            <dt className="text-muted">Due</dt><dd>{date(i.due_date)}</dd>
            {i.paid_at && <><dt className="text-muted">Paid</dt><dd>{new Date(i.paid_at).toLocaleDateString()}</dd></>}
            <dt className="text-muted">Time entries</dt><dd>{i.time_entries[0]?.count ?? 0}</dd>
          </dl>
        </div>
        <div className="table-wrap mt-6 border-0 shadow-none">
          <table>
            <thead><tr><th>Kind</th><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Amount</th><th>Taxed</th></tr></thead>
            <tbody>
              {i.invoice_items.map((li) => (
                <tr key={li.id}>
                  <td>{li.kind}</td>
                  <td>{li.project && <span className="block text-xs text-muted">{li.project.name}</span>}<span className="whitespace-pre-line">{li.description}</span></td>
                  <td className="num">{Number(li.quantity)}</td><td className="num">{money(li.unit_price_cents, c)}</td>
                  <td className="num">{money(li.amount_cents, c)}</td>
                  <td className="text-sm text-muted">{[li.taxed && 'Tax', li.taxed2 && 'Tax 2'].filter(Boolean).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto mt-4 grid max-w-xs grid-cols-[1fr_auto] gap-y-1 text-sm">
          <dt className="text-muted">Subtotal</dt><dd className="num">{money(i.subtotal_cents, c)}</dd>
          {!!i.discount_cents && <><dt className="text-muted">Discount{rate(i.discount_rate)}</dt><dd className="num">−{money(i.discount_cents, c)}</dd></>}
          {!!i.tax_cents && <><dt className="text-muted">Tax{rate(i.tax_rate)}</dt><dd className="num">{money(i.tax_cents, c)}</dd></>}
          {!!i.tax2_cents && <><dt className="text-muted">Tax 2{rate(i.tax2_rate)}</dt><dd className="num">{money(i.tax2_cents, c)}</dd></>}
          <dt className="border-t border-line pt-1 font-semibold text-ink">Total ({c})</dt><dd className="num border-t border-line pt-1 font-semibold">{money(i.total_cents, c)}</dd>
          <dt className="text-muted">Amount due</dt><dd className="num">{money(i.due_cents, c)}</dd>
        </dl>
        {i.notes && <p className="mt-6 whitespace-pre-line text-sm text-muted">{i.notes}</p>}
      </div>
    </>
  )
}
