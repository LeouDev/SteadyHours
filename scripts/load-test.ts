// Load test on the local stack: imports the synthetic account from scripts/fake-harvest-load.ts
// through the real local Edge Function, then reports wall time, runs, peak database size and
// reconciliation against the generator's true totals.
// TRUTH_FILE=<same file as the server> node --experimental-strip-types scripts/load-test.ts
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { localStack } from '../tests/helpers.ts'

const env = localStack()
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const sql = (q: string) => execFileSync('docker', ['exec', 'supabase_db_SteadyHours', 'psql', '-U', 'postgres', '-tAc', q]).toString().trim()
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`

const email = `load-${Date.now()}@test.local`
const password = 'load-test-password'
const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
if (uErr) throw uErr
const sb = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } })
const { data: s } = await sb.auth.signInWithPassword({ email, password })
const { data: m } = await sb.from('memberships').select('workspace_id').eq('user_id', u.user.id).single()
const ws = m!.workspace_id

const baseline = Number(sql('select pg_database_size(current_database())'))
let peak = baseline
const t0 = Date.now()
const res = await fetch(`${env.API_URL}/functions/v1/harvest-import`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${s.session!.access_token}`, apikey: env.ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'start', workspace_id: ws, account_id: '123456', token: 'test-token-123456' }),
})
const started = await res.json()
if (res.status !== 202) throw new Error(`start failed: ${res.status} ${JSON.stringify(started)}`)
console.log(`started ${started.import_id}`)

let imp: Record<string, any> = {}
let lastPrint = 0
for (;;) {
  await new Promise((r) => setTimeout(r, 5000))
  peak = Math.max(peak, Number(sql('select pg_database_size(current_database())')))
  imp = (await admin.from('imports').select('*').eq('id', started.import_id).single()).data!
  const elapsed = Math.round((Date.now() - t0) / 1000)
  if (elapsed - lastPrint >= 30 || imp.status === 'succeeded' || imp.status === 'failed') {
    lastPrint = elapsed
    console.log(`${elapsed}s ${imp.status} stage ${imp.progress.stage} runs ${imp.progress.runs} entries ${imp.counts.time_entries ?? 0} ${imp.error ?? ''}`)
  }
  if (imp.status === 'succeeded' || imp.status === 'failed') break
  if (elapsed > 3600) throw new Error('gave up after an hour')
}
const wall = (new Date(imp.finished_at).getTime() - new Date(imp.started_at).getTime()) / 1000

const tables = sql(`select string_agg(relname || '=' || pg_size_pretty(pg_total_relation_size(c.oid)), ', ' order by pg_total_relation_size(c.oid) desc)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)
console.log('\n== Result')
console.log(`status ${imp.status}; wall time ${Math.floor(wall / 60)}m ${Math.round(wall % 60)}s (PRD target 15m); runs ${imp.progress.runs}`)
console.log(`counts ${JSON.stringify(imp.counts)}; refused ${JSON.stringify(imp.progress.skipped)}; warnings ${imp.progress.warnings}`)
console.log(`database: baseline ${mb(baseline)}, peak ${mb(peak)}, growth ${mb(peak - baseline)}`)
console.log(`tables: ${tables}`)

// Reconcile against the generator's true totals.
const truth = JSON.parse(readFileSync(process.env.TRUTH_FILE!, 'utf8'))
const { data: hours } = await sb.from('reconciliation_hours').select('year, entries, hours, billable_hours').eq('workspace_id', ws)
let hourDiffs = 0
for (const h of hours!) {
  const t = truth.hours[String(h.year)]
  const ok = t && t.entries === h.entries && Math.round(Number(h.hours) * 100) === t.hundredths && Math.round(Number(h.billable_hours) * 100) === t.billable
  if (!ok) { hourDiffs++; console.log('hours mismatch', h, t) }
}
const { data: inv } = await sb.from('reconciliation_invoices').select('year, currency, status, invoices, total_cents, due_cents').eq('workspace_id', ws)
let invDiffs = 0
for (const r of inv!) {
  const t = truth.invoices[`${r.year}|${r.currency}|${r.status}`]
  if (!t || t.invoices !== r.invoices || t.total_minor !== r.total_cents || t.due_minor !== r.due_cents) { invDiffs++; console.log('invoice mismatch', r, t) }
}
const { count: mismatches } = await sb.from('invoice_mismatches').select('*', { count: 'exact', head: true }).eq('workspace_id', ws)
console.log(`reconciliation: ${hours!.length} years of hours, ${hourDiffs} differ; ${inv!.length} year/currency/status invoice groups, ${invDiffs} differ; invoices not adding up: ${mismatches}`)
console.log(`groups in truth: hours ${Object.keys(truth.hours).length}, invoices ${Object.keys(truth.invoices).length}`)
