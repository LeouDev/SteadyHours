// Live test against the hosted project: imports the real Harvest account twice through the
// deployed Edge Function, then prints counts and per-year totals to compare with Harvest's reports.
// Reads secrets from .env (node --env-file=.env). Never prints a key or token.
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'

const REF = process.env.SUPABASE_PROJECT_REF ?? (() => { throw new Error('Missing SUPABASE_PROJECT_REF in .env') })()
const need = (k: string) => {
  const v = process.env[k]?.trim()
  if (!v) throw new Error(`Missing ${k} in .env`)
  return v
}
const url = `https://${REF}.supabase.co`
const keys = JSON.parse(execFileSync('supabase', ['projects', 'api-keys', '--project-ref', REF, '--reveal', '-o', 'json'],
  { env: process.env, stdio: ['ignore', 'pipe', 'ignore'] }).toString()) as { name: string; api_key: string }[]
const key = (name: string) => keys.find((k) => k.name === name)?.api_key ?? (() => { throw new Error(`No ${name} key`) })()
const admin = createClient(url, key('service_role'), { auth: { persistSession: false } })
const sb = createClient(url, key('anon'), { auth: { persistSession: false } })

const email = need('LIVE_TEST_EMAIL')
const password = need('LIVE_TEST_PASSWORD')
let signin = await sb.auth.signInWithPassword({ email, password })
if (signin.error && process.argv.includes('--create-login')) {
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`Could not create the test login: ${error.message}`)
  signin = await sb.auth.signInWithPassword({ email, password })
}
if (signin.error) throw new Error(`Sign-in failed: ${signin.error.message}`)
const { data: m } = await sb.from('memberships').select('workspace_id').eq('user_id', signin.data.user!.id).single()
const ws = m!.workspace_id as string

const TABLES = ['memberships', 'clients', 'contacts', 'projects', 'tasks', 'project_tasks', 'invoices', 'invoice_items', 'estimates', 'expenses', 'time_entries']
async function rowCounts() {
  const out: Record<string, number> = {}
  for (const t of TABLES) out[t] = (await admin.from(t).select('*', { count: 'exact', head: true }).eq('workspace_id', ws)).count!
  return out
}

async function runImport(label: string) {
  const t0 = Date.now()
  const res = await fetch(`${url}/functions/v1/harvest-import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signin.data.session!.access_token}`, apikey: key('anon'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'start', workspace_id: ws, account_id: need('HARVEST_ACCOUNT_ID'), token: need('HARVEST_ACCESS_TOKEN') }),
  })
  const body = await res.json()
  if (res.status !== 202) throw new Error(`${label}: start returned ${res.status}: ${body.error ?? JSON.stringify(body)}`)
  let last = ''
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000))
    const { data } = await admin.from('imports').select('status, counts, progress, error').eq('id', body.import_id).single()
    const line = `${data!.status} stage ${data!.progress.stage ?? 0} ${JSON.stringify(data!.counts)}`
    if (line !== last) console.log(`[${label} ${Math.round((Date.now() - t0) / 1000)}s] ${line}`)
    last = line
    if (data!.status === 'succeeded' || data!.status === 'failed') {
      const { count } = await admin.from('import_secrets').select('*', { count: 'exact', head: true }).eq('import_id', body.import_id)
      console.log(`[${label}] finished in ${Math.round((Date.now() - t0) / 1000)}s; runs: ${data!.progress.runs}; error: ${data!.error ?? "none"}; skipped: ${JSON.stringify(data!.progress.skipped)}; stored token rows left: ${count}`)
      console.log(`[${label}] warnings: ${data!.progress.warnings ?? 0}`, data!.progress.warning_samples ?? [])
      return data!.status
    }
  }
}

if ((await runImport('first')) !== 'succeeded') process.exit(1)
const first = await rowCounts()
console.log('row counts after first import:', first)
// --once: a single import (e.g. when testing resumption, where each run waits for the scheduled job).
if (!process.argv.includes('--once')) {
  if ((await runImport('second')) !== 'succeeded') process.exit(1)
  const second = await rowCounts()
  console.log('row counts unchanged after second import:', JSON.stringify(first) === JSON.stringify(second), second)
}

const { data: hours } = await sb.from('reconciliation_hours').select('year, entries, hours, rounded_hours, billable_hours').eq('workspace_id', ws).order('year')
console.table(hours)
const { data: inv } = await sb.from('reconciliation_invoices').select('year, currency, status, invoices, total_cents, due_cents').eq('workspace_id', ws).order('year').order('currency').order('status')
console.table(inv)
const { data: bad } = await sb.from('invoice_mismatches').select('number, currency, items_cents, subtotal_cents, discount_cents, tax_cents, tax2_cents, total_cents').eq('workspace_id', ws)
console.log(`invoices whose lines + taxes - discount != total: ${bad!.length}`)
if (bad!.length) console.table(bad)
