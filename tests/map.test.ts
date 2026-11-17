import { describe, expect, it } from 'vitest'
import * as m from '../supabase/functions/_shared/harvest/map.ts'
import { fixture } from './helpers.ts'

function ctx() {
  const warnings: string[] = []
  return { warnings, warn: (w: string) => warnings.push(w) }
}

describe('Harvest mapping', () => {
  it('maps users, keeping archived people inactive', () => {
    const c = ctx()
    const [rachel, dev] = fixture('users').users.map((u: unknown) => m.mapUser(c, u as never, 'GBP'))
    expect(rachel).toEqual({ source_id: 1001, name: 'Rachel Owner', email: 'rachel@example.com', is_active: true, default_rate_cents: 15000 })
    expect(dev).toMatchObject({ source_id: 1002, is_active: false, default_rate_cents: 9550 })
    expect(c.warnings).toEqual([])
  })

  it('maps archived clients and keeps each client’s currency', () => {
    const clients = fixture('clients').clients.map(m.mapClient)
    expect(clients.map((c: { currency: string }) => c.currency)).toEqual(['GBP', 'EUR', 'JPY', 'USD'])
    expect(clients.find((c: { source_id: number }) => c.source_id === 2004)).toMatchObject({ name: 'Old Client Inc', is_archived: true })
    expect(clients[0]).toMatchObject({ is_archived: false, address: '1 High St\nLondon' })
  })

  it('maps contacts, turning empty emails into null', () => {
    const contacts = fixture('contacts').contacts.map(m.mapContact)
    expect(contacts).toEqual([
      { source_id: 3001, client_source_id: 2001, name: 'Ada Ledger', email: 'ada@acme.example' },
      { source_id: 3002, client_source_id: 2004, name: 'Bo', email: null },
    ])
  })

  it('converts project and assignment rates in the client’s currency', () => {
    const c = ctx()
    const projects = fixture('projects').projects.map((p: never) => m.mapProject(c, p))
    expect(projects.find((p: { source_id: number }) => p.source_id === 4003)).toMatchObject({ hourly_rate_cents: 15000, code: null })
    expect(projects.find((p: { source_id: number }) => p.source_id === 4002)).toMatchObject({ hourly_rate_cents: 9875, code: null })
    expect(projects.find((p: { source_id: number }) => p.source_id === 4004)).toMatchObject({ is_archived: true, code: 'OLD-9' })
    const [a] = fixture('task_assignments').task_assignments
    expect(m.mapTaskAssignment(c, a, 'GBP')).toEqual({ source_id: 6001, project_source_id: 4001, task_source_id: 5001, is_billable: true, rate_cents: 12000 })
    expect(m.mapTaskAssignment(c, fixture('task_assignments').task_assignments[1], 'GBP').rate_cents).toBeNull()
    expect(c.warnings).toEqual([])
  })

  it('maps invoices: two taxes, discount, states, multiple currencies', () => {
    const c = ctx()
    const byNumber = new Map<string, ReturnType<typeof m.mapInvoice>[]>()
    for (const raw of fixture('invoices').invoices) {
      const r = m.mapInvoice(c, raw)
      byNumber.set(r.invoice.number, [...(byNumber.get(r.invoice.number) ?? []), r])
    }
    const [usd] = byNumber.get('INV-001')!
    expect(usd.invoice).toMatchObject({
      status: 'paid', currency: 'USD', subtotal_cents: 30000, discount_rate: 10, discount_cents: 3000,
      tax_rate: 5, tax_cents: 1350, tax2_rate: 2, tax2_cents: 540, total_cents: 28890, due_cents: 0,
    })
    expect(usd.items.map((i) => [i.amount_cents, i.taxed, i.taxed2])).toEqual([[25000, true, true], [5000, true, true]])

    const [jpy] = byNumber.get('INV-003')!
    expect(jpy.invoice).toMatchObject({ status: 'closed', currency: 'JPY', subtotal_cents: 150000, tax_cents: 15000, total_cents: 165000 })

    const [eur] = byNumber.get('INV-002')!
    expect(eur.items[1]).toMatchObject({ project_source_id: null, kind: 'Product', taxed: false, amount_cents: 27456 })

    // Harvest allows the same number twice; both survive the mapping.
    const dupes = byNumber.get('INV-004')!
    expect(dupes.map((d) => d.invoice.status).sort()).toEqual(['draft', 'sent'])
    expect(dupes.find((d) => d.invoice.status === 'sent')!.invoice).toMatchObject({ total_cents: 32472, due_cents: 12472, tax_rate: 8.25 })
    expect(dupes.find((d) => d.invoice.status === 'draft')!.items[0].quantity).toBe(1.5)
    expect(c.warnings).toEqual([])
  })

  it('every imported invoice total equals its lines plus taxes minus discount', () => {
    for (const raw of fixture('invoices').invoices) {
      const { invoice, items } = m.mapInvoice(ctx(), raw)
      const lines = items.reduce((s, i) => s + i.amount_cents, 0)
      expect(invoice.subtotal_cents).toBe(lines)
      expect(invoice.total_cents).toBe(lines - invoice.discount_cents + invoice.tax_cents + invoice.tax2_cents)
    }
  })

  it('warns, never silently fixes, when Harvest’s total does not add up', () => {
    const c = ctx()
    const raw = { ...fixture('invoices').invoices[1], amount: 324.73 }
    expect(m.mapInvoice(c, raw).invoice.total_cents).toBe(32473)
    expect(c.warnings).toHaveLength(1)
    expect(c.warnings[0]).toMatch(/INV-004.*32472.*32473/)
  })

  it('rejects unknown invoice states instead of guessing', () => {
    expect(() => m.mapInvoice(ctx(), { ...fixture('invoices').invoices[0], state: 'void' })).toThrow(/Unknown Harvest invoice state/)
  })

  it('maps estimates and expenses', () => {
    const c = ctx()
    expect(m.mapEstimate(c, fixture('estimates').estimates[0])).toEqual({
      source_id: 9001, client_source_id: 2002, number: 'EST-1', status: 'accepted', issue_date: '2023-12-01', currency: 'EUR', total_cents: 120050,
    })
    const [travel, billed] = fixture('expenses').expenses.map((e: never) => m.mapExpense(c, e))
    expect(travel).toMatchObject({ amount_cents: 4560, currency: 'GBP', category: 'Travel', invoice_source_id: null, is_billed: false })
    expect(billed).toMatchObject({ amount_cents: 5000, currency: 'USD', invoice_source_id: 7001, is_billed: true, user_source_id: 1002 })
  })

  it('maps time entries: invoiced, deleted users, decimal hours, running timers, billed without invoice', () => {
    const c = ctx()
    const entries = [...fixture('time_entries').time_entries, ...fixture('time_entries_2').time_entries]
    const currency: Record<number, string> = { 4001: 'GBP', 4002: 'EUR', 4003: 'JPY', 4004: 'USD' }
    const rows = entries.map((t) => m.mapTimeEntry(c, t, currency[t.project.id]))
    const by = (id: number) => rows.find((r) => r.source_id === id)!

    expect(by(11001)).toMatchObject({ invoice_source_id: 7001, is_billed: true, minutes: 600, source_hours: 10, rate_cents: 8000 })
    expect(by(11003)).toMatchObject({ invoice_source_id: 7003, minutes: 80, source_hours: 1.33, source_rounded_hours: 1.5, rate_cents: 15000 })
    // User 1099 is not in the users list; the engine creates an inactive placeholder for them.
    expect(by(11004)).toMatchObject({ user_source_id: 1099, minutes: 1, source_hours: 0.02, invoice_source_id: null, is_billed: false })
    expect(by(11005)).toMatchObject({ invoice_source_id: null, is_billed: true, is_billable: false, rate_cents: null })
    // Running timer: only the hours saved before it started (0), matching Harvest's reports.
    expect(by(11006)).toMatchObject({ is_running: false, source_hours: 0, source_rounded_hours: null, minutes: 0 })
    expect(c.warnings).toEqual([])
  })
})
