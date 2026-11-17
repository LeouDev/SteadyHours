// What the Harvest import brings across, stated once and shown wherever we describe the import.
export const IMPORTED = [
  'Clients and their contacts',
  'Projects and tasks, with rates',
  'People',
  'Time entries',
  'Expenses',
  'Invoices with line items, taxes and discounts',
  'Estimate totals',
]

export const NOT_IMPORTED = [
  'Recurring invoice schedules and retainers',
  'Individual payment records (each invoice keeps its paid date and amount due)',
  'Estimate line items',
  'Start and end clock times (the hours are kept)',
]

export function ImportScope({ className = '' }: { className?: string }) {
  return (
    <div className={`grid gap-6 sm:grid-cols-2 ${className}`}>
      <div>
        <h3 className="text-sm font-semibold text-ink">What comes across</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-ink">
          {IMPORTED.map((t) => (
            <li key={t} className="flex gap-2"><span aria-hidden className="text-ok">✓</span>{t}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ink">What doesn’t</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          {NOT_IMPORTED.map((t) => (
            <li key={t} className="flex gap-2"><span aria-hidden>–</span>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
