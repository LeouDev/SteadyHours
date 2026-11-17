// "Delete my workspace" on the local stack: only the owner, only with the exact name typed, and
// afterwards no row of that workspace is left in any table the API can see.
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { encryptToken, importKey } from '../supabase/functions/_shared/crypto.ts'
import { runImport } from '../supabase/functions/_shared/harvest/engine.ts'
import { fakeHarvest, GOOD_TOKEN, HARVEST_BASE, localStack } from './helpers.ts'

const env = localStack()
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const PASSWORD = 'correct-horse-battery-staple'
const VIEWS = new Set(['reconciliation_hours', 'reconciliation_invoices', 'invoice_mismatches'])

async function owner(tag: string) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@test.local`
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw error
  const client = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } })
  await client.auth.signInWithPassword({ email, password: PASSWORD })
  const { data: ws } = await service.from('workspaces').select('id, name').eq('id',
    (await service.from('memberships').select('workspace_id').eq('user_id', data.user.id).single()).data!.workspace_id).single()
  return { id: data.user.id, ws: ws!.id as string, name: ws!.name as string, client }
}

async function importFixtures(ws: string, userId: string, key: CryptoKey) {
  const { data: imp } = await service.from('imports').insert({ workspace_id: ws, started_by: userId, source_account_id: '123456' }).select('id').single()
  await service.from('import_secrets').insert({ import_id: imp!.id, token_ciphertext: await encryptToken(key, GOOD_TOKEN) })
  const r = await runImport({ db: service, importId: imp!.id, key, userAgent: 'Test', baseUrl: HARVEST_BASE, fetch: fakeHarvest().fetch, sleep: async () => {} })
  expect(r).toBe('done')
  return imp!.id as string
}

/** Every table the API exposes, from its OpenAPI description, so a new table is checked automatically. */
async function exposedTables(): Promise<string[]> {
  const r = await fetch(`${env.API_URL}/rest/v1/`, { headers: { apikey: env.SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, Accept: 'application/openapi+json' } })
  return Object.keys((await r.json()).definitions).filter((t) => !VIEWS.has(t))
}

async function rowsLeft(ws: string, importIds: string[]) {
  const left: Record<string, number> = {}
  for (const t of await exposedTables()) {
    const column = t === 'workspaces' ? 'id' : t === 'import_secrets' ? 'import_id' : 'workspace_id'
    const values = t === 'import_secrets' ? importIds : [ws]
    const { count, error } = await service.from(t).select('*', { count: 'exact', head: true }).in(column, values)
    if (error) throw new Error(`${t}: ${error.message}`)
    left[t] = count!
  }
  return left
}

describe('Delete my workspace', () => {
  let key: CryptoKey
  beforeAll(async () => {
    key = await importKey(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))
  })

  it('checks every exposed table (guards against a new table being missed)', async () => {
    const tables = await exposedTables()
    expect(tables).toEqual(expect.arrayContaining(['workspaces', 'memberships', 'clients', 'contacts', 'projects', 'tasks',
      'project_tasks', 'time_entries', 'expenses', 'invoices', 'invoice_items', 'estimates', 'imports', 'import_secrets', 'invitations']))
  })

  it('refuses a wrong confirmation and anyone but the owner', async () => {
    const a = await owner('del-guard')
    const b = await owner('del-other')
    const wrong = await a.client.rpc('delete_workspace', { ws: a.ws, confirmation: a.name.toUpperCase() })
    expect(wrong.error?.message).toMatch(/doesn’t match/)
    const notOwner = await b.client.rpc('delete_workspace', { ws: a.ws, confirmation: a.name })
    expect(notOwner.error?.message).toMatch(/Only the workspace owner/)
    // An admin of the workspace is not enough either.
    await service.from('memberships').insert({ workspace_id: a.ws, user_id: b.id, role: 'admin', name: 'B' })
    const admin = await b.client.rpc('delete_workspace', { ws: a.ws, confirmation: a.name })
    expect(admin.error?.message).toMatch(/Only the workspace owner/)
    const anon = await createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } }).rpc('delete_workspace', { ws: a.ws, confirmation: a.name })
    expect(anon.error).not.toBeNull()
    const { count } = await service.from('time_entries').select('*', { count: 'exact', head: true }).eq('workspace_id', a.ws)
    expect(count).toBe(0) // nothing imported here, but the workspace itself must still exist:
    expect((await service.from('workspaces').select('id').eq('id', a.ws)).data).toHaveLength(1)
  })

  it('removes every row of the workspace, its stored tokens and the owner’s login, and nothing else', async () => {
    const a = await owner('del-me')
    const keep = await owner('del-keep')
    const importIds = [await importFixtures(a.ws, a.id, key)]
    // A second import still holding its encrypted token, as if it were mid-run.
    const { data: running } = await service.from('imports').insert({ workspace_id: a.ws, started_by: a.id, source_account_id: '123456', status: 'running' }).select('id').single()
    await service.from('import_secrets').insert({ import_id: running!.id, token_ciphertext: await encryptToken(key, GOOD_TOKEN) })
    importIds.push(running!.id)
    await importFixtures(keep.ws, keep.id, key)

    const before = await rowsLeft(a.ws, importIds)
    expect(before).toMatchObject({ workspaces: 1, time_entries: 6, invoices: 5, import_secrets: 1 })
    const keepBefore = await rowsLeft(keep.ws, [])

    const { error } = await a.client.rpc('delete_workspace', { ws: a.ws, confirmation: a.name })
    expect(error).toBeNull()

    const after = await rowsLeft(a.ws, importIds)
    expect(Object.values(after).every((n) => n === 0), JSON.stringify(after)).toBe(true)
    const { data: user } = await service.auth.admin.getUserById(a.id)
    expect(user.user).toBeNull()
    // The other workspace is untouched.
    expect(await rowsLeft(keep.ws, [])).toEqual(keepBefore)
  })
})
