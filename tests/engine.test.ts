import { describe, expect, it } from 'vitest'
import { checkHarvestAccess, MESSAGES } from '../supabase/functions/_shared/harvest/engine.ts'
import { fakeHarvest, GOOD_TOKEN, HARVEST_BASE } from './helpers.ts'

const access = (overrides: Record<string, unknown> = {}) => ({
  baseUrl: HARVEST_BASE, accountId: '123456', token: GOOD_TOKEN, userAgent: 'Test (test@example.com)',
  fetch: fakeHarvest().fetch, sleep: async () => {}, ...overrides,
})

describe('credential check messages', () => {
  it('returns the name and Harvest role', async () => {
    expect(await checkHarvestAccess(access())).toEqual({ name: 'Rachel Owner', role: 'administrator' })
  })
  it('says plainly when the token is wrong', async () => {
    await expect(checkHarvestAccess(access({ token: 'not-a-real-token-000' }))).rejects.toThrow(MESSAGES.badToken)
  })
  it('says plainly when the account ID is wrong', async () => {
    await expect(checkHarvestAccess(access({ accountId: '999' }))).rejects.toThrow(MESSAGES.badAccount)
  })
  it('says plainly when Harvest cannot be reached', async () => {
    await expect(checkHarvestAccess(access({ fetch: fakeHarvest({ networkFailures: 10 }).fetch }))).rejects.toThrow(MESSAGES.unreachable)
  })
  it('says plainly when Harvest keeps rate limiting', async () => {
    const limited = (async () => new Response('', { status: 429, headers: { 'Retry-After': '1' } })) as typeof fetch
    await expect(checkHarvestAccess(access({ fetch: limited }))).rejects.toThrow(MESSAGES.rateLimited)
  })
  it('never puts the token in a message', async () => {
    const err = await checkHarvestAccess(access({ token: 'secret-token-abcdef' })).catch((e) => e as Error)
    expect(String(err)).not.toContain('secret-token-abcdef')
  })
})
