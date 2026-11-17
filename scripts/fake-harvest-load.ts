// A large synthetic Harvest account served over HTTP, for load-testing the importer.
// Enforces Harvest's documented limit (100 requests per 15 s, 429 + Retry-After) and adds latency
// that grows with page size. Writes the true per-year totals to TRUTH_FILE for reconciliation.
//
// LOAD_ENTRIES=100000 LOAD_INVOICES=2000 LOAD_PROJECTS=200 TRUTH_FILE=/tmp/truth.json \
//   FAKE_HARVEST_BASE=http://host.docker.internal:54399/v2 node --experimental-strip-types scripts/fake-harvest-load.ts
import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const BASE = process.env.FAKE_HARVEST_BASE ?? 'http://host.docker.internal:54399/v2'
const N_ENTRIES = Number(process.env.LOAD_ENTRIES ?? 100_000)
const N_INVOICES = Number(process.env.LOAD_INVOICES ?? 2000)
const N_PROJECTS = Number(process.env.LOAD_PROJECTS ?? 200)
const N_CLIENTS = 40
const N_USERS = 30
const N_TASKS = 12
const N_EXPENSES = 2000
const N_ESTIMATES = 100
const LATENCY_BASE_MS = Number(process.env.LOAD_LATENCY_MS ?? 300)
const LATENCY_PER_RECORD_MS = Number(process.env.LOAD_LATENCY_PER_RECORD_MS ?? 0.5)

// Deterministic PRNG so every run serves the same account.
let seed = 42
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
const ts = '2026-11-01T00:00:00Z'
const EXP: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0 }
const dec = (minor: number, cur: string) => minor / 10 ** EXP[cur]
const roundDiv = (n: number, d: number) => Math.sign(n) * Math.floor((Math.abs(n) * 2 + d) / (2 * d)) // half away from zero
const day = (y: number) => `${y}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`

const currencies = ['USD', 'USD', 'EUR', 'GBP', 'JPY']
const clients = Array.from({ length: N_CLIENTS }, (_, i) => ({
  id: 100_000 + i, name: `Client ${i}`, is_active: i % 7 !== 0, address: null, statement_key: `k${i}`,
  currency: currencies[i % currencies.length], created_at: ts, updated_at: ts,
}))
const users = Array.from({ length: N_USERS }, (_, i) => ({
  id: 200_000 + i, first_name: `Person`, last_name: `${i}`, email: `p${i}@example.com`, is_active: i % 5 !== 0,
  default_hourly_rate: 100 + i, cost_rate: 50, access_roles: [i === 0 ? 'administrator' : 'member'], created_at: ts, updated_at: ts,
}))
const tasks = Array.from({ length: N_TASKS }, (_, i) => ({
  id: 300_000 + i, name: `Task ${i}`, billable_by_default: i % 4 !== 0, default_hourly_rate: null, is_default: false, is_active: true, created_at: ts, updated_at: ts,
}))
const projects = Array.from({ length: N_PROJECTS }, (_, i) => {
  const c = clients[i % N_CLIENTS]
  const rate = c.currency === 'JPY' ? int(8, 20) * 1000 : int(60, 200) + int(0, 3) * 0.25
  return {
    id: 400_000 + i, name: `Project ${i}`, code: `P${i}`, is_active: i % 9 !== 0, is_billable: true, bill_by: 'Project',
    hourly_rate: rate, budget: null, client: { id: c.id, name: c.name, currency: c.currency }, created_at: ts, updated_at: ts,
  }
})
const contacts = Array.from({ length: 80 }, (_, i) => {
  const c = clients[i % N_CLIENTS]
  return { id: 500_000 + i, first_name: 'Contact', last_name: `${i}`, email: `c${i}@example.com`, title: null, client: { id: c.id, name: c.name }, created_at: ts, updated_at: ts }
})
const assignments = projects.flatMap((p, i) => [0, 1, 2].map((k) => {
  const t = tasks[(i + k) % N_TASKS]
  return { id: 600_000 + i * 3 + k, billable: t.billable_by_default, is_active: true, hourly_rate: p.hourly_rate, budget: null,
    project: { id: p.id, name: p.name, code: p.code }, task: { id: t.id, name: t.name }, created_at: ts, updated_at: ts }
}))

type Truth = { hours: Record<string, { entries: number; hundredths: number; billable: number }>; invoices: Record<string, { invoices: number; total_minor: number; due_minor: number }> }
const truth: Truth = { hours: {}, invoices: {} }
const STATES = ['paid', 'paid', 'paid', 'open', 'draft', 'closed']
const harvestState: Record<string, string> = { paid: 'paid', open: 'sent', draft: 'draft', closed: 'closed' }

const invoices = Array.from({ length: N_INVOICES }, (_, i) => {
  const p = projects[i % N_PROJECTS]
  const cur = p.client.currency
  const year = int(2019, 2026)
  const lines = Array.from({ length: int(1, 5) }, (_, k) => {
    const qtyH = int(25, 4000) // hundredths
    const unitMinor = Math.round(p.hourly_rate * 10 ** EXP[cur])
    const amount = roundDiv(qtyH * unitMinor, 100)
    return { id: 700_000 + i * 10 + k, kind: 'Service', description: `Line ${k}`, quantity: qtyH / 100, unit_price: dec(unitMinor, cur),
      amount: dec(amount, cur), amountMinor: amount, taxed: k % 3 !== 2, taxed2: k % 2 === 0, project: k === 4 ? null : { id: p.id, name: p.name, code: p.code } }
  })
  const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0)
  const discount = i % 5 === 0 ? 10 : null
  const tax = i % 3 === 0 ? 8.25 : i % 3 === 1 ? 20 : null
  const tax2 = i % 4 === 0 ? 2 : null
  const discountMinor = discount ? roundDiv(subtotal * discount * 100, 10_000) : 0
  const after = (sum: number) => (discount ? sum * (100 - discount) / 100 : sum)
  const taxMinor = tax ? Math.round(after(lines.filter((l) => l.taxed).reduce((s, l) => s + l.amountMinor, 0)) * tax / 100) : 0
  const tax2Minor = tax2 ? Math.round(after(lines.filter((l) => l.taxed2).reduce((s, l) => s + l.amountMinor, 0)) * tax2 / 100) : 0
  const total = subtotal - discountMinor + taxMinor + tax2Minor
  const state = STATES[i % STATES.length]
  const due = state === 'paid' ? 0 : state === 'open' && i % 2 ? Math.floor(total / 2) : total
  const issue = day(year)
  const key = `${year}|${cur}|${harvestState[state]}`
  truth.invoices[key] ??= { invoices: 0, total_minor: 0, due_minor: 0 }
  truth.invoices[key].invoices++
  truth.invoices[key].total_minor += total
  truth.invoices[key].due_minor += due
  return {
    id: 800_000 + i, client_key: `ck${i}`, number: String(1000 + i), purchase_order: '', amount: dec(total, cur), due_amount: dec(due, cur),
    tax, tax_amount: tax ? dec(taxMinor, cur) : null, tax2, tax2_amount: tax2 ? dec(tax2Minor, cur) : null,
    discount, discount_amount: dec(discountMinor, cur), subject: 'Services', notes: null, currency: cur, state,
    issue_date: issue, due_date: issue, paid_at: state === 'paid' ? `${issue}T12:00:00Z` : null, created_at: ts, updated_at: ts,
    client: { id: p.client.id, name: p.client.name }, line_items: lines.map(({ amountMinor: _, ...l }) => l),
  }
})
const invoicesByClient = new Map<number, typeof invoices>()
for (const inv of invoices) invoicesByClient.set(inv.client.id, [...(invoicesByClient.get(inv.client.id) ?? []), inv])

const timeEntries = Array.from({ length: N_ENTRIES }, (_, i) => {
  const p = projects[int(0, N_PROJECTS - 1)]
  const t = tasks[(p.id + int(0, 2)) % N_TASKS]
  const u = users[int(0, N_USERS - 1)]
  const year = int(2019, 2026)
  const h = int(1, 900) // hundredths of an hour
  const billable = t.billable_by_default
  const linked = billable && rnd() < 0.6 ? pick(invoicesByClient.get(p.client.id) ?? [null as never]) : null
  const k = String(year)
  truth.hours[k] ??= { entries: 0, hundredths: 0, billable: 0 }
  truth.hours[k].entries++
  truth.hours[k].hundredths += h
  if (billable) truth.hours[k].billable += h
  return {
    id: 1_000_000 + i, spent_date: day(year), hours: h / 100, hours_without_timer: h / 100, rounded_hours: h / 100, notes: `Work ${i}`,
    is_locked: !!linked, is_closed: false, approval_status: 'approved', is_billed: !!linked, timer_started_at: null, started_time: null, ended_time: null,
    is_running: false, billable, budgeted: true, billable_rate: billable ? p.hourly_rate : null, cost_rate: 50, created_at: ts, updated_at: ts,
    user: { id: u.id, name: `${u.first_name} ${u.last_name}` }, client: { id: p.client.id, name: p.client.name },
    project: { id: p.id, name: p.name, code: p.code }, task: { id: t.id, name: t.name },
    invoice: linked ? { id: linked.id, number: linked.number } : null, external_reference: null,
  }
}).sort((a, b) => (a.spent_date < b.spent_date ? 1 : -1))

const expenses = Array.from({ length: N_EXPENSES }, (_, i) => {
  const p = projects[i % N_PROJECTS]
  const u = users[i % N_USERS]
  return {
    id: 1_500_000 + i, spent_date: day(int(2019, 2026)), total_cost: p.client.currency === 'JPY' ? int(1, 50) * 100 : int(100, 50_000) / 100,
    units: 1, billable: true, is_billed: false, is_locked: false, notes: null, receipt: null, invoice: null,
    user: { id: u.id, name: `${u.first_name} ${u.last_name}` }, project: { id: p.id, name: p.name, code: p.code },
    client: { id: p.client.id, name: p.client.name, currency: p.client.currency }, expense_category: { id: 1, name: 'Travel' }, created_at: ts, updated_at: ts,
  }
})
const estimates = Array.from({ length: N_ESTIMATES }, (_, i) => {
  const c = clients[i % N_CLIENTS]
  return { id: 1_800_000 + i, number: `E${i}`, amount: c.currency === 'JPY' ? 120000 : 1234.5, currency: c.currency, state: 'accepted',
    issue_date: day(int(2019, 2026)), client: { id: c.id, name: c.name }, line_items: [], created_at: ts, updated_at: ts }
})

const data: Record<string, unknown[]> = {
  users, clients, contacts, projects, tasks, task_assignments: assignments, invoices, estimates, expenses, time_entries: timeEntries,
}
if (process.env.TRUTH_FILE) writeFileSync(process.env.TRUTH_FILE, JSON.stringify(truth, null, 1))

// Harvest's documented limit: 100 requests per 15 seconds.
const window: number[] = []
let served = 0
let limited = 0

createServer((req, res) => {
  const now = Date.now()
  while (window.length && window[0] <= now - 15_000) window.shift()
  if (window.length >= 100) {
    limited++
    res.writeHead(429, { 'Retry-After': String(Math.ceil((window[0] + 15_000 - now) / 1000)) })
    return res.end()
  }
  window.push(now)
  if (req.headers.authorization !== 'Bearer test-token-123456') {
    res.writeHead(401)
    return res.end('{"error":"invalid_token"}')
  }
  const url = new URL(req.url!, BASE)
  const name = url.pathname.replace(/^\/v2\//, '')
  let body: unknown
  let records = 1
  if (name === 'users/me') body = users[0]
  else if (name === 'company') body = { name: 'Load Test Co', currency: 'USD', wants_timestamp_timers: false }
  else if (data[name]) {
    const perPage = Math.min(Number(url.searchParams.get('per_page') ?? 2000), 2000)
    const offset = Number(url.searchParams.get('cursor') ?? 0)
    const rows = data[name].slice(offset, offset + perPage)
    records = rows.length
    const next = offset + perPage < data[name].length ? `${BASE}/${name}?cursor=${offset + perPage}&per_page=${perPage}` : null
    body = { [name]: rows, per_page: perPage, total_entries: data[name].length, links: { next } }
  } else {
    res.writeHead(404)
    return res.end()
  }
  served++
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }, LATENCY_BASE_MS + records * LATENCY_PER_RECORD_MS)
}).listen(Number(new URL(BASE).port), '0.0.0.0', () => {
  console.log(`load Harvest on ${BASE}: ${N_ENTRIES} entries, ${N_INVOICES} invoices, ${N_PROJECTS} projects`)
})
setInterval(() => console.log(`served ${served}, rate-limited ${limited}`), 30_000).unref?.()
