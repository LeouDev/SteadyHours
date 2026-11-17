// Local demo workspaces for screenshots (local stack only):
//  demo@test.local       imported fixtures; estimates refused; one invoice that doesn't add up
//  importing@test.local  an import part-way through, for the progress screen
// Password for both: demo-password-2026.  node --experimental-strip-types scripts/demo-data.ts
import { createClient } from '@supabase/supabase-js'
import { encryptToken, importKey } from '../supabase/functions/_shared/crypto.ts'
import { runImport } from '../supabase/functions/_shared/harvest/engine.ts'
import { fakeHarvest, GOOD_TOKEN, HARVEST_BASE, localStack } from '../tests/helpers.ts'

const env = localStack()
if (!/127\.0\.0\.1|localhost/.test(env.API_URL)) throw new Error('Local stack only')
const db = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const password = 'demo-password-2026'

async function freshUser(email: string) {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 })
  const old = list.users.find((u) => u.email === email)
  if (old) {
    const { data: m } = await db.from('memberships').select('workspace_id').eq('user_id', old.id)
    for (const r of m ?? []) await db.from('workspaces').delete().eq('id', r.workspace_id)
    await db.auth.admin.deleteUser(old.id)
  }
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const { data: m } = await db.from('memberships').select('workspace_id').eq('user_id', data.user.id).single()
  return { id: data.user.id, ws: m!.workspace_id as string }
}

const key = await importKey(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))

const demo = await freshUser('demo@test.local')
await db.from('workspaces').update({ name: 'Ledger & Line Studio' }).eq('id', demo.ws)
const { data: imp } = await db.from('imports').insert({ workspace_id: demo.ws, started_by: demo.id, source_account_id: '123456' }).select('id').single()
await db.from('import_secrets').insert({ import_id: imp!.id, token_ciphertext: await encryptToken(key, GOOD_TOKEN) })
const result = await runImport({ db, importId: imp!.id, key, userAgent: 'Demo', baseUrl: HARVEST_BASE, fetch: fakeHarvest({ forbid: ['estimates'] }).fetch, sleep: async () => {} })
// One invoice whose stored total no longer matches its lines, to show a mismatch.
const { data: inv } = await db.from('invoices').select('id, total_cents').eq('workspace_id', demo.ws).eq('number', 'INV-002').single()
await db.from('invoices').update({ total_cents: inv!.total_cents + 1 }).eq('id', inv!.id)
console.log('demo@test.local import:', result)

const importing = await freshUser('importing@test.local')
await db.from('workspaces').update({ name: 'Northwind Advisory' }).eq('id', importing.ws)
await db.from('imports').insert({
  workspace_id: importing.ws, started_by: importing.id, source_account_id: '123456', status: 'running',
  counts: { users: 14, clients: 63, contacts: 91, projects: 212, tasks: 38, task_assignments: 1406, invoices: 1184, estimates: 77, expenses: 2291, time_entries: 41200 },
  progress: { stage: 9, next_url: null, skipped: [], warnings: 0, warning_samples: [], runs: 4, harvest_role: 'administrator', company_currency: 'USD' },
  heartbeat_at: new Date().toISOString(),
  // Far-future lease so the scheduled job never picks this display-only import up.
  locked_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
})
console.log('importing@test.local: import in progress')
