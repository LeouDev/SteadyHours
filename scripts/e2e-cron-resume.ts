// Simulates a worker that died mid-import, then waits for pg_cron to resume it.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { encryptToken, importKey } from '../supabase/functions/_shared/crypto.ts'
import { localStack } from '../tests/helpers.ts'

const env = localStack()
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const fnEnv = Object.fromEntries(readFileSync('supabase/functions/.env', 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s)))
const { data: u } = await admin.auth.admin.createUser({ email: `cron-${Date.now()}@test.local`, password: 'correct-horse-battery', email_confirm: true })
const { data: m } = await admin.from('memberships').select('workspace_id').eq('user_id', u.user!.id).single()
// Stopped after projects (stage 4), lease expired a minute ago.
const { data: imp } = await admin.from('imports').insert({
  workspace_id: m!.workspace_id, source_account_id: '123456', status: 'running',
  progress: { stage: 4, next_url: null, skipped: [], warnings: 0, warning_samples: [] },
  counts: { users: 2, clients: 4, contacts: 2, projects: 4 }, locked_until: new Date(Date.now() - 60_000).toISOString(),
}).select('id').single()
await admin.from('import_secrets').insert({ import_id: imp!.id, token_ciphertext: await encryptToken(await importKey(fnEnv.IMPORT_TOKEN_KEY), 'test-token-123456') })
console.log('stalled import', imp!.id, '- waiting for pg_cron (up to 90s)')
const t0 = Date.now()
for (;;) {
  const { data } = await admin.from('imports').select('status, counts, error').eq('id', imp!.id).single()
  if (data!.status === 'succeeded' || data!.status === 'failed' || Date.now() - t0 > 90_000) {
    console.log(`after ${Math.round((Date.now() - t0) / 1000)}s:`, JSON.stringify(data))
    break
  }
  await new Promise((r) => setTimeout(r, 2000))
}
