// POST {action: 'start', workspace_id, account_id, token} -> {import_id}   (owner/admin JWT)
// POST {action: 'resume', import_id}                                        (owner/admin JWT, or service key from cron/self)
// The token is encrypted before storage and never logged or returned.

import { createClient } from '@supabase/supabase-js'
import { PRODUCT_NAME } from '../_shared/config.ts'
import { encryptToken, importKey } from '../_shared/crypto.ts'
import { checkHarvestAccess, HARVEST_API, PermanentError, runImport } from '../_shared/harvest/engine.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BASE_URL = Deno.env.get('HARVEST_API_BASE') ?? HARVEST_API
const USER_AGENT = `${PRODUCT_NAME} Importer (${Deno.env.get('HARVEST_CONTACT') ?? 'set HARVEST_CONTACT'})`
const BUDGET_MS = Number(Deno.env.get('IMPORT_BUDGET_MS') ?? 100_000)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const keyPromise = importKey(Deno.env.get('IMPORT_TOKEN_KEY') ?? '')

/** Run one time-boxed chunk; if work remains, hand off to a fresh invocation. */
async function runAndChain(importId: string) {
  try {
    const result = await runImport({ db: admin, importId, key: await keyPromise, userAgent: USER_AGENT, baseUrl: BASE_URL, budgetMs: BUDGET_MS })
    if (result === 'more') {
      await fetch(`${SUPABASE_URL}/functions/v1/harvest-import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resume', import_id: importId }),
      })
    }
  } catch (e) {
    // Lease expiry plus the scheduled job picks this up again.
    console.error(`import ${importId} chunk error: ${(e as Error).message}`)
  }
}

async function canManage(userId: string, workspaceId: string) {
  const { data } = await admin.from('memberships').select('role')
    .eq('workspace_id', workspaceId).eq('user_id', userId).eq('is_active', true).maybeSingle()
  return data?.role === 'owner' || data?.role === 'admin'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const bearer = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const isService = bearer === SERVICE_KEY
  let userId: string | null = null
  if (!isService) {
    const { data, error } = await admin.auth.getUser(bearer)
    if (error || !data.user) return json({ error: 'Not signed in' }, 401)
    userId = data.user.id
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  if (body.action === 'start') {
    const workspaceId = String(body.workspace_id ?? '')
    const accountId = String(body.account_id ?? '').trim()
    const token = String(body.token ?? '').trim()
    if (!userId || !(await canManage(userId, workspaceId))) return json({ error: 'Only owners and admins can import' }, 403)
    if (!/^\d{1,12}$/.test(accountId)) return json({ error: 'The account ID is a number, shown on Harvest’s Developers page.' }, 400)
    if (token.length < 10 || token.length > 500) return json({ error: 'That doesn’t look like a personal access token.' }, 400)

    try {
      await checkHarvestAccess({ baseUrl: BASE_URL, accountId, token, userAgent: USER_AGENT, fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })
    } catch (e) {
      return json({ error: e instanceof PermanentError ? e.message : 'Could not reach Harvest. Try again in a minute.' }, 400)
    }

    const { data: imp, error } = await admin.from('imports')
      .insert({ workspace_id: workspaceId, started_by: userId, source_account_id: accountId })
      .select('id').single()
    if (error) {
      if (error.code === '23505') return json({ error: 'An import is already running for this workspace.' }, 409)
      return json({ error: 'Could not start the import.' }, 500)
    }
    const { error: secretErr } = await admin.from('import_secrets')
      .insert({ import_id: imp.id, token_ciphertext: await encryptToken(await keyPromise, token) })
    if (secretErr) {
      await admin.from('imports').update({ status: 'failed', error: 'Could not store the token.' }).eq('id', imp.id)
      return json({ error: 'Could not start the import.' }, 500)
    }
    EdgeRuntime.waitUntil(runAndChain(imp.id))
    return json({ import_id: imp.id }, 202)
  }

  if (body.action === 'resume') {
    const importId = String(body.import_id ?? '')
    if (!isService) {
      const { data: imp } = await admin.from('imports').select('workspace_id').eq('id', importId).maybeSingle()
      if (!imp || !(await canManage(userId!, imp.workspace_id))) return json({ error: 'Not allowed' }, 403)
    }
    EdgeRuntime.waitUntil(runAndChain(importId))
    return json({ ok: true }, 202)
  }

  return json({ error: 'Unknown action' }, 400)
})
