import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export const HARVEST_BASE = process.env.FAKE_HARVEST_BASE ?? 'http://harvest.test/v2'
export const GOOD_TOKEN = 'test-token-123456'

const dir = new URL('./fixtures/harvest/', import.meta.url)

// deno-lint-ignore no-explicit-any
export function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`${name}.json`, dir), 'utf8').replaceAll('{{BASE}}', HARVEST_BASE))
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

/** In-memory Harvest API v2 serving the fixtures, with optional 429s and network failures. */
export function fakeHarvest(opts: { rateLimitOnce?: string[]; networkFailures?: number } = {}) {
  const calls: string[] = []
  const limited = new Set(opts.rateLimitOnce ?? [])
  let failures = opts.networkFailures ?? 0
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const headers = init?.headers as Record<string, string>
    calls.push(url.pathname + url.search)
    if (failures > 0) {
      failures--
      throw new TypeError('fetch failed')
    }
    if (headers.Authorization !== `Bearer ${GOOD_TOKEN}` || !headers['Harvest-Account-Id'] || !headers['User-Agent']) {
      return new Response('{"error":"invalid_token"}', { status: 401 })
    }
    const name = url.pathname.replace('/v2/', '')
    if (limited.delete(name)) return new Response('', { status: 429, headers: { 'Retry-After': '2' } })
    if (name === 'users/me') return json(fixture('users').users[0])
    if (name === 'time_entries' && url.searchParams.get('cursor')) return json(fixture('time_entries_2'))
    return json(fixture(name))
  }
  return { fetch: fetch as typeof globalThis.fetch, calls }
}

export function localStack(): Record<string, string> {
  try {
    return JSON.parse(execSync('supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString())
  } catch {
    throw new Error('Local Supabase stack is not running. Start it with `supabase start`.')
  }
}
