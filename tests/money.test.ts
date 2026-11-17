import { describe, expect, it } from 'vitest'
import { currencyExponent, fromMinor, toMinor } from '../supabase/functions/_shared/money.ts'

describe('toMinor', () => {
  it('converts exactly without float multiplication', () => {
    expect(toMinor(288.9, 'USD')).toEqual({ minor: 28890, exact: true })
    expect(toMinor(1426.56, 'EUR')).toEqual({ minor: 142656, exact: true })
    expect(toMinor(0.29, 'USD')).toEqual({ minor: 29, exact: true }) // 0.29 * 100 = 28.999999999999996 in floats
    expect(toMinor('1234567.89', 'GBP')).toEqual({ minor: 123456789, exact: true })
  })

  it('uses each currency’s minor-unit digits', () => {
    expect(currencyExponent('JPY')).toBe(0)
    expect(currencyExponent('KWD')).toBe(3)
    expect(toMinor(165000, 'JPY')).toEqual({ minor: 165000, exact: true })
    expect(toMinor(1.234, 'KWD')).toEqual({ minor: 1234, exact: true })
  })

  it('rounds half away from zero and reports it', () => {
    expect(toMinor(24.745, 'USD')).toEqual({ minor: 2475, exact: false })
    expect(toMinor(-12.345, 'USD')).toEqual({ minor: -1235, exact: false })
    expect(toMinor(24.744, 'USD')).toEqual({ minor: 2474, exact: false })
    expect(toMinor(0.5, 'JPY')).toEqual({ minor: 1, exact: false })
    expect(toMinor(1e-7, 'USD')).toEqual({ minor: 0, exact: false })
  })

  it('handles negatives and exponent notation', () => {
    expect(toMinor(-50, 'USD')).toEqual({ minor: -5000, exact: true })
    expect(toMinor(1e15, 'JPY')).toEqual({ minor: 1e15, exact: true })
    expect(() => toMinor(1e21, 'JPY')).toThrow(/out of range/) // never silently wrong
  })

  it('rejects non-numbers', () => {
    expect(() => toMinor('12,50', 'EUR')).toThrow()
    expect(() => toMinor('', 'EUR')).toThrow()
  })
})

describe('fromMinor', () => {
  it('formats back to a decimal string', () => {
    expect(fromMinor(28890, 'USD')).toBe('288.90')
    expect(fromMinor(5, 'USD')).toBe('0.05')
    expect(fromMinor(-5, 'USD')).toBe('-0.05')
    expect(fromMinor(165000, 'JPY')).toBe('165000')
    expect(fromMinor(1234, 'KWD')).toBe('1.234')
  })
})
