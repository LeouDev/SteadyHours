// Runs against the local Supabase stack (`supabase start`). Uses the service role only
// from this Node process, as the Edge Function does; user checks go through the anon key.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { encryptToken, importKey } from '../supabase/functions/_shared/crypto.ts'
import { runImport, type RunResult } from '../supabase/functions/_shared/harvest/engine.ts'
import { fakeHarvest, GOOD_TOKEN, HARVEST_BASE, localStack } from './helpers.ts'

const env = localStack()
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const PASSWORD = 'correct-horse-battery-staple'
const TABLES = ['memberships', 'clients', 'contacts', 'projects', 'tasks', 'project_tasks', 'invoices',
  'invoice_items', 'estimates', 'expenses', 'time_entries'] as const
const EXPECTED = {
  memberships: 4, // owner login + 2 Harvest users + 1 placeholder for the user Harvest no longer lists
  clients: 4, contacts: 2, projects: 4, tasks: 2, project_tasks: 5, invoices: 5,
  invoice_items: 7, estimates: 1, expenses: 2, time_entries: 6,
}

let key: CryptoKey

async function newUser(tag: string) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@test.local`
  const { data, error } = await service.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true })
  if (error) throw error
  const { data: m } = await service.from('memberships').select('workspace_id, role').eq('user_id', data.user.id).single()
  expect(m!.role).toBe('owner')
  const client = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } })
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signInErr) throw signInErr
  return { id: data.user.id, ws: m!.workspace_id as string, client }
}

async function createImport(ws: string, userId: string, token = GOOD_TOKEN) {
  const { data, error } = await service.from('imports')
    .insert({ workspace_id: ws, started_by: userId, source_account_id: '123456' }).select('id').single()
  if (error) throw error
  await service.from('import_secrets').insert({ import_id: data.id, token_ciphertext: await encryptToken(key, token) })
  return data.id as string
}

function run(importId: string, harvest: ReturnType<typeof fakeHarvest>, extra: Partial<Parameters<typeof runImport>[0]> = {}) {
  return runImport({
    db: service, importId, key, userAgent: 'Test (test@example.com)', baseUrl: HARVEST_BASE,
    fetch: harvest.fetch, sleep: async () => {}, ...extra,
  })
}

async function runToEnd(importId: string, harvest: ReturnType<typeof fakeHarvest>, extra = {}) {
  const results: RunResult[] = []
  for (let i = 0; i < 50; i++) {
    const r = await run(importId, harvest, extra)
    results.push(r)
    if (r !== 'more') return results
  }
  throw new Error('import never finished')
}

async function rowCounts(ws: string) {
  const out: Record<string, number> = {}
  for (const t of TABLES) {
    const { count, error } = await service.from(t).select('*', { count: 'exact', head: true }).eq('workspace_id', ws)
    if (error) throw error
    out[t] = count!
  }
  return out
}

async function getImport(id: string) {
  const { data } = await service.from('imports').select('*').eq('id', id).single()
  const { count } = await service.from('import_secrets').select('*', { count: 'exact', head: true }).eq('import_id', id)
  return { ...data, secrets: count }
}

describe('Harvest import against the local database', () => {
  let a: Awaited<ReturnType<typeof newUser>>
  let b: Awaited<ReturnType<typeof newUser>>

  beforeAll(async () => {
    key = await importKey(btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))))
    a = await newUser('owner-a')
    b = await newUser('owner-b')

    // First import: one page per run (forces resume from saved progress) and a 429 on clients.
    const harvest = fakeHarvest({ rateLimitOnce: ['clients'] })
    const sleeps: number[] = []
    let t = Date.now()
    const id = await createImport(a.ws, a.id)
    const results = await runToEnd(id, harvest, {
      budgetMs: 1500, now: () => (t += 1000), sleep: async (ms: number) => { sleeps.push(ms) },
    })
    expect(results.at(-1)).toBe('done')
    expect(results.filter((r) => r === 'more').length).toBeGreaterThan(5)
    expect(sleeps).toEqual([2000]) // Retry-After: 2
    expect(harvest.calls.filter((c) => c.startsWith('/v2/clients'))).toHaveLength(2)
  })

  it('imports every record type with the expected row counts', async () => {
    expect(await rowCounts(a.ws)).toEqual(EXPECTED)
  })

  it('running the same import again leaves row counts unchanged', async () => {
    const id = await createImport(a.ws, a.id)
    expect(await runToEnd(id, fakeHarvest())).toEqual(['done'])
    expect(await rowCounts(a.ws)).toEqual(EXPECTED)
    const imp = await getImport(id)
    expect(imp.counts).toMatchObject({ users: 2, clients: 4, invoices: 5, time_entries: 6 })
  })

  it('deletes the stored token when the import finishes', async () => {
    const { data } = await service.from('imports').select('id, status').eq('workspace_id', a.ws)
    for (const imp of data!) {
      expect(imp.status).toBe('succeeded')
      expect((await getImport(imp.id)).secrets).toBe(0)
    }
  })

  it('invoice totals equal the sum of line items plus taxes minus discount', async () => {
    const { data: invoices } = await service.from('invoices')
      .select('number, currency, subtotal_cents, discount_cents, tax_cents, tax2_cents, total_cents, invoice_items(amount_cents)')
      .eq('workspace_id', a.ws)
    expect(invoices).toHaveLength(5)
    for (const i of invoices!) {
      const lines = i.invoice_items.reduce((s: number, li: { amount_cents: number }) => s + li.amount_cents, 0)
      expect(i.subtotal_cents).toBe(lines)
      expect(i.total_cents).toBe(lines + i.tax_cents + i.tax2_cents - i.discount_cents)
    }
    const totals = Object.fromEntries(invoices!.map((i) => [`${i.number}/${i.currency}/${i.total_cents}`, true]))
    expect(Object.keys(totals).sort()).toEqual(['INV-001/USD/28890', 'INV-002/EUR/142656', 'INV-003/JPY/165000', 'INV-004/GBP/18000', 'INV-004/GBP/32472'])
    const { data: mismatches } = await a.client.from('invoice_mismatches').select('*').eq('workspace_id', a.ws)
    expect(mismatches).toEqual([])
  })

  it('links invoiced time, keeps billed-without-invoice time billed, and adds placeholders', async () => {
    const { data: entries } = await service.from('time_entries')
      .select('source_id, invoice_id, is_billed, membership:memberships(name, is_active, user_id)').eq('workspace_id', a.ws)
    const by = new Map(entries!.map((e) => [e.source_id, e]))
    expect(by.get(11001)!.invoice_id).not.toBeNull()
    expect(by.get(11005)).toMatchObject({ invoice_id: null, is_billed: true })
    expect(by.get(11004)!.membership).toEqual({ name: 'Former Contractor', is_active: false, user_id: null })
  })

  it('reconciliation sums Harvest’s exact hours and invoice totals per year', async () => {
    const { data: hours } = await a.client.from('reconciliation_hours').select('year, entries, hours, rounded_hours').eq('workspace_id', a.ws).order('year')
    expect(hours).toEqual([
      { year: 2023, entries: 1, hours: 10, rounded_hours: 10 },
      { year: 2024, entries: 2, hours: 9.33, rounded_hours: 9.5 },
      { year: 2025, entries: 3, hours: 2.52, rounded_hours: 2.75 }, // running timer counts its saved hours (0)
    ])
    const { data: inv } = await a.client.from('reconciliation_invoices').select('year, currency, status, total_cents').eq('workspace_id', a.ws).order('year').order('status')
    expect(inv).toEqual([
      { year: 2023, currency: 'USD', status: 'paid', total_cents: 28890 },
      { year: 2024, currency: 'JPY', status: 'closed', total_cents: 165000 },
      { year: 2024, currency: 'EUR', status: 'paid', total_cents: 142656 },
      { year: 2025, currency: 'GBP', status: 'draft', total_cents: 18000 },
      { year: 2025, currency: 'GBP', status: 'sent', total_cents: 32472 },
    ])
  })

  it('a user in one workspace cannot read or change another workspace’s rows', async () => {
    for (const t of TABLES) {
      const { data, error } = await b.client.from(t).select('id').eq('workspace_id', a.ws)
      expect(error, t).toBeNull()
      expect(data, t).toEqual([])
    }
    for (const v of ['reconciliation_hours', 'reconciliation_invoices', 'invoice_mismatches', 'imports']) {
      const { data } = await b.client.from(v).select('*').eq('workspace_id', a.ws)
      expect(data, v).toEqual([])
    }
    const { data: ws } = await b.client.from('workspaces').select('id')
    expect(ws).toEqual([{ id: b.ws }])
    const { data: secrets, error: secretsErr } = await b.client.from('import_secrets').select('*')
    expect(secrets ?? []).toEqual([])
    expect(secretsErr).not.toBeNull()

    const { error: insertErr } = await b.client.from('clients').insert({ workspace_id: a.ws, name: 'x', currency: 'USD' })
    expect(insertErr).not.toBeNull()
    const { data: updated } = await b.client.from('invoices').update({ notes: 'hacked' }).eq('workspace_id', a.ws).select('id')
    expect(updated ?? []).toEqual([])
    const { data: deleted } = await b.client.from('time_entries').delete().eq('workspace_id', a.ws).select('id')
    expect(deleted ?? []).toEqual([])
    expect(await rowCounts(a.ws)).toEqual(EXPECTED)
  })

  it('the owner can read their own archive but cannot write on the free archive plan', async () => {
    const { data } = await a.client.from('time_entries').select('id').eq('workspace_id', a.ws)
    expect(data).toHaveLength(6)
    const { error } = await a.client.from('clients').insert({ workspace_id: a.ws, name: 'New', currency: 'USD' })
    expect(error).not.toBeNull()
    const { data: changed } = await a.client.from('workspaces').update({ name: 'Renamed' }).eq('id', a.ws).select('id')
    expect(changed ?? []).toEqual([])
    const { error: planErr } = await a.client.from('workspaces').update({ plan: 'pro' }).eq('id', a.ws)
    expect(planErr?.message).toMatch(/permission denied/)
  })

  it('fails permanently on a rejected token and deletes it', async () => {
    const c = await newUser('bad-token')
    const id = await createImport(c.ws, c.id, 'wrong-token-000000')
    expect(await run(id, fakeHarvest())).toBe('failed')
    const imp = await getImport(id)
    expect(imp).toMatchObject({ status: 'failed', secrets: 0 })
    expect(imp.error).toMatch(/401/)
    expect(imp.error).not.toContain('wrong-token')
  })

  it('resumes after a transient failure once the lease expires', async () => {
    const c = await newUser('flaky')
    const id = await createImport(c.ws, c.id)
    // More network failures than one request retries: the run stops and keeps its token.
    const harvest = fakeHarvest({ networkFailures: 8 })
    expect(await run(id, harvest)).toBe('retry')
    expect(await getImport(id)).toMatchObject({ status: 'running', secrets: 1, attempts: 1 })
    expect(await run(id, harvest)).toBe('busy') // lease still held
    await service.from('imports').update({ locked_until: new Date(Date.now() - 1000).toISOString() }).eq('id', id)
    expect(await runToEnd(id, harvest)).toEqual(['done'])
    expect(await rowCounts(c.ws)).toEqual(EXPECTED)
    expect(await getImport(id)).toMatchObject({ status: 'succeeded', secrets: 0, attempts: 0 })
  })

  it('allows only one active import per workspace', async () => {
    const c = await newUser('single')
    await createImport(c.ws, c.id)
    const { error } = await service.from('imports').insert({ workspace_id: c.ws, source_account_id: '1' })
    expect(error?.code).toBe('23505')
  })
})

// Keep the SupabaseClient type referenced for editors.
export type { SupabaseClient }
