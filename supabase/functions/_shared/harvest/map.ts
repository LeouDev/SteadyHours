// Pure mapping from Harvest API v2 records to our table rows.
// References to other Harvest records stay as *_source_id; the engine resolves them to uuids.

import { toMinor } from '../money.ts'

export type Ref = { id: number; name?: string; code?: string | null; currency?: string } | null | undefined

/** Collects amounts that had more precision than their currency allows. */
export interface MapCtx {
  warn(message: string): void
}

function minor(ctx: MapCtx, value: number | string | null | undefined, currency: string, what: string): number | null {
  if (value === null || value === undefined) return null
  const { minor, exact } = toMinor(value, currency)
  if (!exact) ctx.warn(`${what}: ${value} ${currency} rounded to ${minor} minor units`)
  return minor
}
const minor0 = (ctx: MapCtx, v: number | string | null | undefined, c: string, what: string) => minor(ctx, v, c, what) ?? 0

const fullName = (first?: string | null, last?: string | null) => [first, last].filter(Boolean).join(' ')

// deno-lint-ignore no-explicit-any
type Raw = Record<string, any>

export function mapUser(ctx: MapCtx, u: Raw, defaultCurrency: string) {
  return {
    source_id: u.id as number,
    name: fullName(u.first_name, u.last_name),
    email: (u.email as string | null) ?? null,
    is_active: u.is_active !== false,
    default_rate_cents: minor(ctx, u.default_hourly_rate, defaultCurrency, `user ${u.id} default_hourly_rate`),
  }
}

export function mapClient(c: Raw) {
  return {
    source_id: c.id as number,
    name: c.name as string,
    currency: c.currency as string,
    address: (c.address as string | null) ?? null,
    is_archived: c.is_active === false,
  }
}

export function mapContact(c: Raw) {
  return {
    source_id: c.id as number,
    client_source_id: c.client.id as number,
    name: fullName(c.first_name, c.last_name),
    email: (c.email as string | null) || null,
  }
}

export function mapProject(ctx: MapCtx, p: Raw) {
  return {
    source_id: p.id as number,
    client_source_id: p.client.id as number,
    name: p.name as string,
    code: (p.code as string | null) || null,
    is_billable: p.is_billable !== false,
    hourly_rate_cents: minor(ctx, p.hourly_rate, p.client.currency, `project ${p.id} hourly_rate`),
    is_archived: p.is_active === false,
  }
}

export function mapTask(t: Raw) {
  return {
    source_id: t.id as number,
    name: t.name as string,
    is_billable_default: t.billable_by_default !== false,
  }
}

export function mapTaskAssignment(ctx: MapCtx, a: Raw, currency: string) {
  return {
    source_id: a.id as number,
    project_source_id: a.project.id as number,
    task_source_id: a.task.id as number,
    is_billable: a.billable !== false,
    rate_cents: minor(ctx, a.hourly_rate, currency, `task assignment ${a.id} hourly_rate`),
  }
}

const INVOICE_STATUS: Record<string, string> = { draft: 'draft', open: 'sent', paid: 'paid', closed: 'closed' }

export function mapInvoice(ctx: MapCtx, i: Raw) {
  const cur = i.currency as string
  const items = ((i.line_items ?? []) as Raw[]).map((li) => ({
    source_id: li.id as number,
    project_source_id: (li.project?.id as number | undefined) ?? null,
    kind: (li.kind as string | null) ?? null,
    description: (li.description as string | null) ?? null,
    quantity: li.quantity ?? 1,
    unit_price_cents: minor0(ctx, li.unit_price, cur, `invoice ${i.number} line ${li.id} unit_price`),
    amount_cents: minor0(ctx, li.amount, cur, `invoice ${i.number} line ${li.id} amount`),
    taxed: li.taxed === true,
    taxed2: li.taxed2 === true,
  }))
  const status = INVOICE_STATUS[i.state]
  if (!status) throw new Error(`Unknown Harvest invoice state "${i.state}" on invoice ${i.id}`)
  const invoice = {
    source_id: i.id as number,
    client_source_id: i.client.id as number,
    number: String(i.number ?? i.id),
    status,
    subject: (i.subject as string | null) || null,
    issue_date: (i.issue_date as string | null) ?? null,
    due_date: (i.due_date as string | null) ?? null,
    currency: cur,
    // Harvest has no subtotal field: it is the sum of the line amounts.
    subtotal_cents: items.reduce((s, li) => s + li.amount_cents, 0),
    discount_rate: i.discount ?? null,
    discount_cents: minor0(ctx, i.discount_amount, cur, `invoice ${i.number} discount_amount`),
    tax_rate: i.tax ?? null,
    tax_cents: minor0(ctx, i.tax_amount, cur, `invoice ${i.number} tax_amount`),
    tax2_rate: i.tax2 ?? null,
    tax2_cents: minor0(ctx, i.tax2_amount, cur, `invoice ${i.number} tax2_amount`),
    total_cents: minor0(ctx, i.amount, cur, `invoice ${i.number} amount`),
    due_cents: minor0(ctx, i.due_amount, cur, `invoice ${i.number} due_amount`),
    paid_at: (i.paid_at as string | null) ?? null,
    notes: (i.notes as string | null) || null,
  }
  const expected = invoice.subtotal_cents - invoice.discount_cents + invoice.tax_cents + invoice.tax2_cents
  if (expected !== invoice.total_cents) {
    ctx.warn(`invoice ${invoice.number}: lines - discount + taxes = ${expected}, Harvest total = ${invoice.total_cents} (${cur} minor units)`)
  }
  return { invoice, items }
}

export function mapEstimate(ctx: MapCtx, e: Raw) {
  return {
    source_id: e.id as number,
    client_source_id: e.client.id as number,
    number: (e.number as string | null) ?? null,
    status: e.state as string,
    issue_date: (e.issue_date as string | null) ?? null,
    currency: e.currency as string,
    total_cents: minor0(ctx, e.amount, e.currency, `estimate ${e.number} amount`),
  }
}

export function mapExpense(ctx: MapCtx, e: Raw) {
  const cur = e.client.currency as string
  return {
    source_id: e.id as number,
    project_source_id: e.project.id as number,
    user_source_id: e.user.id as number,
    invoice_source_id: (e.invoice?.id as number | undefined) ?? null,
    spent_on: e.spent_date as string,
    amount_cents: minor0(ctx, e.total_cost, cur, `expense ${e.id} total_cost`),
    currency: cur,
    category: (e.expense_category?.name as string | undefined) ?? null,
    notes: (e.notes as string | null) || null,
    is_billable: e.billable !== false,
    is_billed: e.is_billed === true,
  }
}

/** `currency` is the project's client currency, used for billable_rate. */
export function mapTimeEntry(ctx: MapCtx, t: Raw, currency: string) {
  // Harvest's reports leave out time on a running timer, so take only what was saved before it
  // started; a re-import after the timer stops brings in the final hours.
  const running = t.is_running === true
  const sourceHours = running ? (t.hours_without_timer ?? 0) : (t.hours ?? 0)
  const hours = Number(sourceHours)
  return {
    source_id: t.id as number,
    user_source_id: t.user.id as number,
    project_source_id: t.project.id as number,
    task_source_id: t.task.id as number,
    invoice_source_id: (t.invoice?.id as number | undefined) ?? null,
    spent_on: t.spent_date as string,
    minutes: Math.round(hours * 60),
    source_hours: sourceHours,
    source_rounded_hours: running ? null : (t.rounded_hours ?? null),
    notes: (t.notes as string | null) || null,
    is_billable: t.billable !== false,
    // Harvest can mark time as invoiced without linking an invoice; keep that so it is never billed twice.
    is_billed: t.is_billed === true,
    rate_cents: minor(ctx, t.billable_rate, currency, `time entry ${t.id} billable_rate`),
    // The archive never imports a live timer.
    is_running: false,
  }
}
