// Resumable, idempotent Harvest import. Runs inside the Edge Function and, in tests, in Node.
// Each page is upserted on (workspace_id, source_id), then counts and the next page URL are
// saved together, so a run stopped at any point continues from the last saved page.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '../crypto.ts'
import * as m from './map.ts'
import { STAGES, type Stage } from './stages.ts'

// deno-lint-ignore no-explicit-any
type Raw = Record<string, any>
type Row = Record<string, unknown>

export { STAGES }

export const HARVEST_API = 'https://api.harvestapp.com/v2'
const MAX_RUN_ATTEMPTS = 5
const WARNING_SAMPLES = 20

export class PermanentError extends Error {}
class TransientError extends Error {}
class SkipStage extends Error {}

export interface HarvestAccess {
  baseUrl: string
  accountId: string
  token: string
  userAgent: string
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  maxAttempts?: number
}

const backoff = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 30_000)

/** GET with retries: honours Retry-After on 429, backs off on 5xx and network errors. */
export async function harvestGet(h: HarvestAccess, url: string): Promise<Raw> {
  // Pagination links come from Harvest; never send the token anywhere else.
  if (new URL(url).origin !== new URL(h.baseUrl).origin) {
    throw new PermanentError('Harvest returned a pagination link to an unexpected host')
  }
  const maxAttempts = h.maxAttempts ?? 8
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      res = await h.fetch(url, {
        headers: {
          Authorization: `Bearer ${h.token}`,
          'Harvest-Account-Id': h.accountId,
          'User-Agent': h.userAgent,
          Accept: 'application/json',
        },
      })
    } catch (e) {
      if (attempt >= maxAttempts) throw new TransientError(`Network error calling Harvest: ${(e as Error).message}`)
      await h.sleep(backoff(attempt))
      continue
    }
    if (res.ok) return await res.json()
    const status = res.status
    const retryAfter = Number(res.headers.get('Retry-After'))
    await res.body?.cancel()
    const path = new URL(url).pathname
    if (status === 429 || status >= 500) {
      if (attempt >= maxAttempts) throw new TransientError(`Harvest returned ${status} for ${path} after ${attempt} attempts`)
      await h.sleep(status === 429 && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt))
      continue
    }
    if (status === 401) throw new PermanentError('Harvest rejected the access token (401). Check the token and the account ID.')
    if (status === 403) throw new SkipStage(`No permission for ${path} (403)`)
    throw new PermanentError(`Harvest returned ${status} for ${path}`)
  }
}

/** Quick credential check before an import is created. Returns the Harvest user's name. */
export async function checkHarvestAccess(h: HarvestAccess): Promise<string> {
  try {
    const me = await harvestGet({ ...h, maxAttempts: 3 }, `${h.baseUrl}/users/me`)
    return [me.first_name, me.last_name].filter(Boolean).join(' ')
  } catch (e) {
    if (e instanceof SkipStage) throw new PermanentError('Harvest refused access (403). Check the account ID.')
    throw e
  }
}

/** Maps Harvest source ids to our uuids per table, with placeholder rows for records Harvest no longer lists. */
class Store {
  private maps = new Map<string, Map<number, string>>()
  constructor(readonly db: SupabaseClient, private ws: string) {}

  map(table: string): Map<number, string> {
    let mp = this.maps.get(table)
    if (!mp) this.maps.set(table, (mp = new Map()))
    return mp
  }

  async upsert(table: string, rows: Row[], ignoreDuplicates = false): Promise<void> {
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000).map((r) => ({ ...r, workspace_id: this.ws }))
      const { data, error } = await this.db.from(table)
        .upsert(chunk, { onConflict: 'workspace_id,source_id', ignoreDuplicates })
        .select('id, source_id')
      if (error) throw new Error(`Saving ${table} failed: ${error.message}`)
      for (const r of data ?? []) this.map(table).set(Number(r.source_id), r.id)
    }
  }

  async resolve(table: string, ids: Iterable<number>): Promise<Map<number, string>> {
    const mp = this.map(table)
    const missing = [...new Set(ids)].filter((id) => !mp.has(id))
    for (let i = 0; i < missing.length; i += 200) {
      const { data, error } = await this.db.from(table).select('id, source_id')
        .eq('workspace_id', this.ws).in('source_id', missing.slice(i, i + 200))
      if (error) throw new Error(`Reading ${table} failed: ${error.message}`)
      for (const r of data ?? []) mp.set(Number(r.source_id), r.id)
    }
    return mp
  }

  /** Make sure every referenced record exists, inserting a placeholder for any Harvest no longer lists. */
  async ensure(table: string, placeholders: Map<number, Row>): Promise<Map<number, string>> {
    const mp = await this.resolve(table, placeholders.keys())
    const missing = [...placeholders].filter(([id]) => !mp.has(id)).map(([, row]) => row)
    if (missing.length) {
      await this.upsert(table, missing, true)
      await this.resolve(table, placeholders.keys())
    }
    return mp
  }

  async selectAll<T>(table: string, columns: string): Promise<T[]> {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.db.from(table).select(columns)
        .eq('workspace_id', this.ws).order('id').range(from, from + 999)
      if (error) throw new Error(`Reading ${table} failed: ${error.message}`)
      out.push(...(data as T[]))
      if (!data || data.length < 1000) return out
    }
  }
}

export interface RunOptions {
  db: SupabaseClient // service role
  importId: string
  key: CryptoKey
  userAgent: string
  baseUrl?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  budgetMs?: number
  now?: () => number
}

export type RunResult = 'done' | 'more' | 'retry' | 'failed' | 'busy'

interface Progress {
  stage: number
  next_url: string | null
  skipped: string[]
  warnings: number
  warning_samples: string[]
}

export async function runImport(o: RunOptions): Promise<RunResult> {
  const now = o.now ?? Date.now
  const start = now()
  const budget = o.budgetMs ?? 100_000
  const iso = (ms: number) => new Date(ms).toISOString()
  const db = o.db

  // Claim the import: only one worker at a time, and only once any previous lease has expired.
  const { data: imp, error: claimErr } = await db.from('imports')
    .update({ status: 'running', locked_until: iso(start + budget + 120_000), heartbeat_at: iso(start) })
    .eq('id', o.importId).in('status', ['queued', 'running'])
    .or(`locked_until.is.null,locked_until.lt."${iso(start)}"`)
    .select('*').maybeSingle()
  if (claimErr) throw new Error(`Claiming import failed: ${claimErr.message}`)
  if (!imp) return 'busy'

  const ws: string = imp.workspace_id
  const progress: Progress = { stage: 0, next_url: null, skipped: [], warnings: 0, warning_samples: [], ...imp.progress }
  const counts: Record<string, number> = { ...imp.counts }

  const save = async (extra: Row = {}) => {
    const { error } = await db.from('imports').update({
      counts, progress, heartbeat_at: iso(now()), locked_until: iso(now() + budget + 120_000), ...extra,
    }).eq('id', o.importId)
    if (error) throw new Error(`Saving progress failed: ${error.message}`)
  }
  const deleteSecret = () => db.from('import_secrets').delete().eq('import_id', o.importId)

  try {
    const { data: secret } = await db.from('import_secrets').select('token_ciphertext').eq('import_id', o.importId).maybeSingle()
    if (!secret) throw new PermanentError('The Harvest token is no longer stored. Start a new import.')
    const { data: wsRow, error: wsErr } = await db.from('workspaces').select('default_currency').eq('id', ws).single()
    if (wsErr) throw new Error(`Reading workspace failed: ${wsErr.message}`)
    const defaultCurrency: string = wsRow.default_currency

    const h: HarvestAccess = {
      baseUrl: o.baseUrl ?? HARVEST_API,
      accountId: imp.source_account_id,
      token: await decryptToken(o.key, secret.token_ciphertext),
      userAgent: o.userAgent,
      fetch: o.fetch ?? fetch,
      sleep: o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    }
    const ctx: m.MapCtx = {
      warn(msg) {
        progress.warnings++
        if (progress.warning_samples.length < WARNING_SAMPLES) progress.warning_samples.push(msg)
      },
    }
    const handlers = makeHandlers(new Store(db, ws), ctx, defaultCurrency)

    while (progress.stage < STAGES.length) {
      if (now() - start > budget) {
        await save({ locked_until: null })
        return 'more'
      }
      const stage = STAGES[progress.stage]
      const url = progress.next_url ?? `${h.baseUrl}/${stage}?per_page=2000`
      let page: Raw
      try {
        page = await harvestGet(h, url)
      } catch (e) {
        if (!(e instanceof SkipStage)) throw e
        progress.skipped.push(stage)
        progress.stage++
        progress.next_url = null
        await save()
        continue
      }
      const rows = (page[stage] ?? []) as Raw[]
      await handlers[stage](rows)
      counts[stage] = (counts[stage] ?? 0) + rows.length
      progress.next_url = page.links?.next ?? null
      if (!progress.next_url) progress.stage++
      await save({ attempts: 0, error: null })
    }

    await save({ status: 'succeeded', finished_at: iso(now()), locked_until: null, error: null })
    await deleteSecret()
    return 'done'
  } catch (e) {
    const message = (e as Error).message
    const attempts = (imp.attempts ?? 0) + 1
    if (e instanceof PermanentError || attempts >= MAX_RUN_ATTEMPTS) {
      await db.from('imports').update({
        counts, progress, status: 'failed', error: message, attempts, finished_at: iso(now()), locked_until: null,
      }).eq('id', o.importId)
      await deleteSecret()
      return 'failed'
    }
    // Transient: keep the token; the scheduled job resumes after the short lease.
    await db.from('imports').update({ counts, progress, error: message, attempts, locked_until: iso(now() + 60_000) })
      .eq('id', o.importId)
    return 'retry'
  }
}

function makeHandlers(store: Store, ctx: m.MapCtx, defaultCurrency: string): Record<Stage, (rows: Raw[]) => Promise<void>> {
  type R = { id: number; name?: string; code?: string | null; currency?: string }

  const ensureClients = (refs: R[]) =>
    store.ensure('clients', new Map(refs.map((c) => [c.id, {
      source_id: c.id, name: c.name ?? `Harvest client ${c.id}`, currency: c.currency ?? defaultCurrency, is_archived: true,
    }])))

  const ensurePeople = (refs: R[]) =>
    store.ensure('memberships', new Map(refs.map((u) => [u.id, {
      source_id: u.id, name: u.name ?? `Harvest user ${u.id}`, is_active: false,
    }])))

  const ensureTasks = (refs: R[]) =>
    store.ensure('tasks', new Map(refs.map((t) => [t.id, { source_id: t.id, name: t.name ?? `Harvest task ${t.id}` }])))

  /** Projects with their client, as embedded in time entries, expenses and invoice lines. */
  const ensureProjects = async (refs: { project: R; client: R }[]) => {
    const clients = await ensureClients(refs.map((r) => r.client))
    return store.ensure('projects', new Map(refs.map(({ project: p, client: c }) => [p.id, {
      source_id: p.id, name: p.name ?? `Harvest project ${p.id}`, code: p.code ?? null,
      client_id: clients.get(c.id), is_archived: true,
    }])))
  }

  let currencies: { project: Map<number, string>; client: Map<number, string> } | null = null
  const currencyFor = async (projectId: number, clientId?: number) => {
    if (!currencies) {
      const clientRows = await store.selectAll<{ id: string; source_id: number; currency: string }>('clients', 'id, source_id, currency')
      const byUuid = new Map(clientRows.map((c) => [c.id, c.currency]))
      const projectRows = await store.selectAll<{ source_id: number; client_id: string }>('projects', 'source_id, client_id')
      currencies = {
        client: new Map(clientRows.filter((c) => c.source_id != null).map((c) => [Number(c.source_id), c.currency])),
        project: new Map(projectRows.filter((p) => p.source_id != null).map((p) => [Number(p.source_id), byUuid.get(p.client_id)!])),
      }
    }
    return currencies.project.get(projectId) ?? (clientId !== undefined ? currencies.client.get(clientId) : undefined) ?? defaultCurrency
  }

  const req = (mp: Map<number, string>, id: number, what: string) => {
    const v = mp.get(id)
    if (!v) throw new Error(`Could not resolve ${what} ${id}`)
    return v
  }

  return {
    users: (rows) => store.upsert('memberships', rows.map((u) => m.mapUser(ctx, u, defaultCurrency))),

    clients: (rows) => store.upsert('clients', rows.map(m.mapClient)),

    contacts: async (rows) => {
      const clients = await ensureClients(rows.map((c) => c.client))
      await store.upsert('contacts', rows.map(m.mapContact).map(({ client_source_id, ...r }) => ({
        ...r, client_id: req(clients, client_source_id, 'client'),
      })))
    },

    projects: async (rows) => {
      const clients = await ensureClients(rows.map((p) => p.client))
      await store.upsert('projects', rows.map((p) => m.mapProject(ctx, p)).map(({ client_source_id, ...r }) => ({
        ...r, client_id: req(clients, client_source_id, 'client'),
      })))
    },

    tasks: (rows) => store.upsert('tasks', rows.map(m.mapTask)),

    task_assignments: async (rows) => {
      const projects = await store.resolve('projects', rows.map((a) => a.project.id))
      const tasks = await ensureTasks(rows.map((a) => a.task))
      const out: Row[] = []
      for (const a of rows) {
        const { project_source_id, task_source_id, ...r } = m.mapTaskAssignment(ctx, a, await currencyFor(a.project.id))
        const project_id = projects.get(project_source_id)
        if (!project_id) {
          ctx.warn(`task assignment ${a.id}: project ${project_source_id} not found, skipped`)
          continue
        }
        out.push({ ...r, project_id, task_id: req(tasks, task_source_id, 'task') })
      }
      await store.upsert('project_tasks', out)
    },

    invoices: async (rows) => {
      const clients = await ensureClients(rows.map((i) => ({ ...i.client, currency: i.currency })))
      const mapped = rows.map((i) => ({ raw: i, ...m.mapInvoice(ctx, i) }))
      await store.upsert('invoices', mapped.map(({ invoice: { client_source_id, ...r } }) => ({
        ...r, client_id: req(clients, client_source_id, 'client'),
      })))
      const invoices = store.map('invoices')
      const projects = await ensureProjects(mapped.flatMap(({ raw }) =>
        ((raw.line_items ?? []) as Raw[]).filter((li) => li.project).map((li) => ({ project: li.project, client: raw.client }))))
      const items = mapped.flatMap(({ invoice, items }) => items.map(({ project_source_id, ...li }) => ({
        ...li,
        invoice_id: req(invoices, invoice.source_id, 'invoice'),
        project_id: project_source_id === null ? null : req(projects, project_source_id, 'project'),
      })))
      await store.upsert('invoice_items', items)
      // Drop lines that were removed in Harvest since an earlier run, so totals keep adding up.
      const keep = new Set(items.map((li) => li.source_id))
      const invoiceIds = mapped.map(({ invoice }) => req(invoices, invoice.source_id, 'invoice'))
      for (let i = 0; i < invoiceIds.length; i += 100) {
        const { data, error } = await store.db.from('invoice_items').select('id, source_id')
          .in('invoice_id', invoiceIds.slice(i, i + 100))
        if (error) throw new Error(`Reading invoice_items failed: ${error.message}`)
        const stale = (data ?? []).filter((r) => !keep.has(Number(r.source_id))).map((r) => r.id)
        if (stale.length) {
          const { error: delErr } = await store.db.from('invoice_items').delete().in('id', stale)
          if (delErr) throw new Error(`Removing stale invoice lines failed: ${delErr.message}`)
        }
      }
    },

    estimates: async (rows) => {
      const clients = await ensureClients(rows.map((e) => ({ ...e.client, currency: e.currency })))
      await store.upsert('estimates', rows.map((e) => m.mapEstimate(ctx, e)).map(({ client_source_id, ...r }) => ({
        ...r, client_id: req(clients, client_source_id, 'client'),
      })))
    },

    expenses: async (rows) => {
      const projects = await ensureProjects(rows.map((e) => ({ project: e.project, client: e.client })))
      const people = await ensurePeople(rows.map((e) => e.user))
      const invoices = await store.resolve('invoices', rows.filter((e) => e.invoice).map((e) => e.invoice.id))
      await store.upsert('expenses', rows.map((e) => m.mapExpense(ctx, e)).map(
        ({ project_source_id, user_source_id, invoice_source_id, ...r }) => ({
          ...r,
          project_id: req(projects, project_source_id, 'project'),
          membership_id: req(people, user_source_id, 'user'),
          invoice_id: invoice_source_id === null ? null : invoices.get(invoice_source_id) ?? null,
        }),
      ))
    },

    time_entries: async (rows) => {
      const projects = await ensureProjects(rows.map((t) => ({ project: t.project, client: t.client })))
      const people = await ensurePeople(rows.map((t) => t.user))
      const tasks = await ensureTasks(rows.map((t) => t.task))
      const invoices = await store.resolve('invoices', rows.filter((t) => t.invoice).map((t) => t.invoice.id))
      const out: Row[] = []
      for (const t of rows) {
        const { user_source_id, project_source_id, task_source_id, invoice_source_id, ...r } =
          m.mapTimeEntry(ctx, t, await currencyFor(t.project.id, t.client?.id))
        out.push({
          ...r,
          membership_id: req(people, user_source_id, 'user'),
          project_id: req(projects, project_source_id, 'project'),
          task_id: req(tasks, task_source_id, 'task'),
          // An invoice we could not import (no permission) leaves the entry unlinked but still is_billed.
          invoice_id: invoice_source_id === null ? null : invoices.get(invoice_source_id) ?? null,
        })
      }
      await store.upsert('time_entries', out)
    },
  }
}
