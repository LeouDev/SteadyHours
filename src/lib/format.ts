import { currencyExponent, fromMinor } from '../../supabase/functions/_shared/money.ts'

/** Minor units to a currency string without going through floats, e.g. 28890 USD -> "$288.90". */
export function money(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined) return '—'
  const digits = currencyExponent(currency)
  const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
  // Intl accepts decimal strings exactly (ES2023), so no float rounding sneaks in.
  return fmt.format(fromMinor(minor, currency) as unknown as number)
}

export function hours(h: number | string | null | undefined): string {
  if (h === null || h === undefined) return '—'
  return Number(h).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function entryHours(e: { source_hours: number | null; minutes: number }): number {
  return e.source_hours ?? e.minutes / 60
}

export const date = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—')
