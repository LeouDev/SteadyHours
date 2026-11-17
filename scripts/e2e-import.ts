// End-to-end: real signup, real Edge Function, fake Harvest server (scripts/fake-harvest-server.ts).
import { createClient } from '@supabase/supabase-js'
import { localStack } from '../tests/helpers.ts'

const env = localStack()
const sb = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } })
const email = `e2e-${Date.now()}@test.local`
const { data: signup, error: signupErr } = await sb.auth.signUp({ email, password: 'correct-horse-battery' })
if (signupErr || !signup.session) throw new Error(`signup failed: ${signupErr?.message}`)
const { data: ws } = await sb.from('memberships').select('workspace_id, role').single()
console.log('signup -> workspace', ws)

const invoke = async (body: object) => {
  const res = await fetch(`${env.API_URL}/functions/v1/harvest-import`, {
    method: 'POST', headers: { Authorization: `Bearer ${signup.session!.access_token}`, apikey: env.ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

console.log('bad token  ->', await invoke({ action: 'start', workspace_id: ws!.workspace_id, account_id: '123456', token: 'not-the-right-token' }))
console.log('bad acct   ->', await invoke({ action: 'start', workspace_id: ws!.workspace_id, account_id: 'abc', token: 'test-token-123456' }))
console.log('other ws   ->', await invoke({ action: 'start', workspace_id: crypto.randomUUID(), account_id: '123456', token: 'test-token-123456' }))
const started = await invoke({ action: 'start', workspace_id: ws!.workspace_id, account_id: '123456', token: 'test-token-123456' })
console.log('start      ->', started)
console.log('second     ->', await invoke({ action: 'start', workspace_id: ws!.workspace_id, account_id: '123456', token: 'test-token-123456' }))

for (let i = 0; i < 60; i++) {
  const { data } = await sb.from('imports').select('status, counts, progress, error').eq('id', started.body.import_id).single()
  if (data?.status === "succeeded" || data?.status === "failed") {
    console.log('final      ->', JSON.stringify(data))
    break
  }
  await new Promise((r) => setTimeout(r, 500))
}
const { data: hours } = await sb.from('reconciliation_hours').select('year, hours').order('year')
console.log('hours      ->', JSON.stringify(hours))
