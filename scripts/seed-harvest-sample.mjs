// Creates sample data in the Harvest account from .env, for the live import test.
// No emails: invoices are marked sent with event_type "send" (Harvest docs: does not send),
// payments use send_thank_you: false. No new Harvest users (seats). Refuses to run twice.
// Usage: node scripts/with-env.mjs node scripts/seed-harvest-sample.mjs
const API = 'https://api.harvestapp.com/v2'
const headers = {
  Authorization: `Bearer ${process.env.HARVEST_ACCESS_TOKEN}`,
  'Harvest-Account-Id': process.env.HARVEST_ACCOUNT_ID,
  'User-Agent': `Steadyhours Importer (${process.env.HARVEST_CONTACT})`,
  'Content-Type': 'application/json',
}

async function call(method, path, body) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${API}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
    if (r.status === 429 && attempt < 5) {
      await new Promise((ok) => setTimeout(ok, (Number(r.headers.get('Retry-After')) || 2) * 1000))
      continue
    }
    const text = await r.text()
    if (!r.ok) throw new Error(`${method} /${path} -> ${r.status}: ${text.slice(0, 400)}`)
    return text ? JSON.parse(text) : null
  }
}
const post = (p, b) => call('POST', p, b)
const patch = (p, b) => call('PATCH', p, b)
const get = (p) => call('GET', p)

const existing = await get('clients?per_page=2000')
if (existing.clients.some((c) => c.name.startsWith('Sample '))) {
  console.log('Sample data already exists; not creating it again.')
  process.exit(0)
}

const me = await get('users/me')
const tasks = Object.fromEntries((await get('tasks')).tasks.map((t) => [t.name, t.id]))
const categories = Object.fromEntries((await get('expense_categories')).expense_categories.map((c) => [c.name, c.id]))

// Clients and a contact
const acme = await post('clients', { name: 'Sample Acme', currency: 'USD', address: '1 High St\nSpringfield' })
const kyoto = await post('clients', { name: 'Sample Kyoto KK', currency: 'JPY' })
const oldco = await post('clients', { name: 'Sample Old Co', currency: 'USD' })
await post('contacts', { client_id: acme.id, first_name: 'Ada', last_name: 'Ledger', email: 'ada@example.com', title: 'CFO' })

// Projects, with this user and tasks assigned
async function project(client, name, code, hourly_rate, taskSpecs) {
  const p = await post('projects', { client_id: client.id, name, code, is_billable: true, bill_by: 'Project', budget_by: 'none', hourly_rate })
  await post(`projects/${p.id}/user_assignments`, { user_id: me.id }).catch((e) => {
    if (!/422/.test(e.message)) throw e // already assigned
  })
  for (const [task, billable] of taskSpecs) await post(`projects/${p.id}/task_assignments`, { task_id: tasks[task], billable })
  return p
}
const web = await project(acme, 'Sample Website', 'SMP-1', 120.5, [['Programming', true], ['Business Development', false]])
const loc = await project(kyoto, 'Sample Localisation', 'SMP-2', 15000, [['Design', true]])
const legacy = await project(oldco, 'Sample Legacy', 'SMP-3', 80, [['Programming', true]])

// Time across two years, with awkward durations (1:20, 0:01)
const time = (p, task, spent_date, hours, notes) =>
  post('time_entries', { project_id: p.id, task_id: tasks[task], spent_date, hours, notes })
await time(legacy, 'Programming', '2025-03-10', 10, 'Legacy support')
await time(web, 'Programming', '2025-06-02', 1.3333, 'Build (1h20m)')
await time(web, 'Programming', '2025-06-03', 2.75, 'Build')
await time(web, 'Business Development', '2025-06-04', 1, 'Pitch (non-billable)')
await time(loc, 'Design', '2025-09-15', 8, 'Translation design')
await time(web, 'Programming', '2026-02-02', 0.0167, 'One minute')
await time(web, 'Programming', '2026-02-03', 3.5, 'Build')
await time(loc, 'Design', '2026-03-02', 4.25, 'Translation design')
await time(web, 'Programming', '2026-11-10', 2, 'Unbilled work')

// Expenses
await post('expenses', { project_id: web.id, expense_category_id: categories.Lodging, spent_date: '2025-06-05', total_cost: 245.6, notes: 'Hotel' })
await post('expenses', { project_id: legacy.id, expense_category_id: categories.Meals, spent_date: '2025-03-11', total_cost: 50, notes: 'Client lunch' })

// Invoices
const fromTime = (client, p, from, to, extra, withExpenses = false) => post('invoices', {
  client_id: client.id, issue_date: to, payment_term: 'net 30', subject: `${p.name} ${from.slice(0, 7)}`,
  line_items_import: {
    project_ids: [p.id],
    time: { summary_type: 'detailed', from, to },
    ...(withExpenses ? { expenses: { summary_type: 'detailed', from, to } } : {}),
  },
  ...extra,
})
const markSent = (inv) => post(`invoices/${inv.id}/messages`, { event_type: 'send' })
const pay = (inv, amount, paid_date) => post(`invoices/${inv.id}/payments`, { amount, paid_date, send_thank_you: false })

// A: USD, discount + two taxes + one untaxed line, fully paid
let a = await fromTime(acme, web, '2025-06-01', '2025-06-30', { tax: 8.25, tax2: 2, discount: 10 }, true)
a = await patch(`invoices/${a.id}`, { line_items: [{ kind: 'Service', description: 'Setup fee (untaxed)', quantity: 1, unit_price: 50, taxed: false, taxed2: false }] })
await markSent(a)
await pay(a, a.amount, '2025-07-15')

// B: JPY, tax, partly paid
const b = await fromTime(kyoto, loc, '2025-09-01', '2025-09-30', { tax: 10 })
await markSent(b)
await pay(b, 50000, '2025-10-20')

// C: USD, time + expenses, sent then closed (written off)
const c = await fromTime(oldco, legacy, '2025-03-01', '2025-03-31', {}, true)
await markSent(c)
await post(`invoices/${c.id}/messages`, { event_type: 'close' })

// D: USD free-form draft, rounding case (3 x 99.99 at 8.25%)
await post('invoices', {
  client_id: acme.id, issue_date: '2026-04-01', payment_term: 'upon receipt', tax: 8.25, subject: 'Draft retainer',
  line_items: [{ kind: 'Service', description: 'Retainer', quantity: 3, unit_price: 99.99, taxed: true, project_id: web.id }],
})

// E: JPY, paid in full
const e = await fromTime(kyoto, loc, '2026-03-01', '2026-03-31', {})
await markSent(e)
await pay(e, e.amount, '2026-04-10')

// Estimate
await post('estimates', {
  client_id: acme.id, issue_date: '2026-01-15', tax: 5, subject: 'Phase 2',
  line_items: [{ kind: 'Service', description: 'Phase 2 build', quantity: 1, unit_price: 1200.5, taxed: true }],
})

// Running timer (left running), then archive the old client and its project
await post('time_entries', { project_id: web.id, task_id: tasks.Programming, spent_date: new Date().toISOString().slice(0, 10), notes: 'Running timer' })
await patch(`projects/${legacy.id}`, { is_active: false })
await patch(`clients/${oldco.id}`, { is_active: false })

// Harvest's own numbers, for comparison with the import
const invoices = (await get('invoices?per_page=2000')).invoices.filter((i) => i.client.name.startsWith('Sample '))
console.log('Invoices as Harvest computed them:')
for (const i of invoices.reverse()) {
  console.log(` ${i.number} ${i.currency} ${i.state} issued ${i.issue_date}: lines ${i.line_items.map((l) => `${l.quantity}x${l.unit_price}=${l.amount}${l.taxed ? 'T' : ''}${l.taxed2 ? 'T2' : ''}`).join(' + ')}; discount ${i.discount_amount}; tax ${i.tax_amount}; tax2 ${i.tax2_amount}; total ${i.amount}; due ${i.due_amount}`)
}
for (const year of [2025, 2026]) {
  const r = await get(`reports/time/clients?from=${year}0101&to=${year}1231`)
  const total = r.results.reduce((s, x) => s + x.total_hours, 0)
  const billable = r.results.reduce((s, x) => s + x.billable_hours, 0)
  console.log(`Harvest time report ${year}: total_hours ${total}, billable_hours ${billable}`, r.results.map((x) => `${x.client_name}: ${x.total_hours}h`).join('; '))
}
