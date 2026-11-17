// Decimal amounts <-> integer minor units, without floating-point arithmetic.

const exponents = new Map<string, number>()

/** ISO 4217 minor-unit digits (JPY 0, USD 2, KWD 3), from the platform's Intl data. */
export function currencyExponent(currency: string): number {
  let e = exponents.get(currency)
  if (e === undefined) {
    try {
      e = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
    } catch {
      e = 2
    }
    exponents.set(currency, e)
  }
  return e
}

/** Plain decimal string for a JSON number, expanding exponent notation (1e-7, 2.5e21). */
function plain(n: number): string {
  const s = String(n)
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/.exec(s)
  if (!m) return s
  const [, sign, int, frac = '', expStr] = m
  const exp = Number(expStr)
  const digits = int + frac
  const point = int.length + exp
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length)
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/**
 * Convert a decimal amount to integer minor units. Rounds half away from zero
 * when the source has more digits than the currency allows; `exact` says whether it did.
 */
export function toMinor(value: number | string, currency: string): { minor: number; exact: boolean } {
  const s = typeof value === 'number' ? plain(value) : value.trim()
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (m[2] === '' && !m[3])) throw new Error(`Not a decimal amount: ${JSON.stringify(value)}`)
  const [, sign, int = '', frac = ''] = m
  const exp = currencyExponent(currency)
  const kept = frac.slice(0, exp).padEnd(exp, '0')
  const rest = frac.slice(exp)
  let minor = BigInt((int || '0') + kept)
  if (rest !== '' && rest[0] >= '5') minor += 1n
  const result = Number(minor)
  if (!Number.isSafeInteger(result)) throw new Error(`Amount out of range: ${s}`)
  return { minor: sign === '-' && result !== 0 ? -result : result, exact: !/[1-9]/.test(rest) }
}

/** Minor units back to a decimal string, e.g. (28890, 'USD') -> '288.90'. */
export function fromMinor(minor: number, currency: string): string {
  const exp = currencyExponent(currency)
  const neg = minor < 0
  const digits = String(Math.abs(minor)).padStart(exp + 1, '0')
  const out = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`
  return neg ? `-${out}` : out
}
