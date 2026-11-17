// Launch-gate numbers from the hosted database (counts only). Usage: node scripts/gate.mjs
// Reads SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD from .env; prints no secret.
import { spawnSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n').map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]))
const ref = env.SUPABASE_PROJECT_REF
const pooler = readFileSync('supabase/.temp/pooler-url', 'utf8').trim()
const url = pooler.replace(`postgres.${ref}@`, `postgres.${ref}:${encodeURIComponent(env.SUPABASE_DB_PASSWORD)}@`)
const dir = mkdtempSync(join(tmpdir(), 'gate-'))
for (const sql of ['select * from internal.gate_summary', 'select * from internal.gate_workspaces']) {
  const file = join(dir, 'q.sql')
  writeFileSync(file, sql, { mode: 0o600 })
  const r = spawnSync('supabase', ['db', 'query', '--db-url', url, '-f', file], { encoding: 'utf8', env: { ...process.env, ...env } })
  unlinkSync(file)
  if (r.status) {
    console.error('query failed (check SUPABASE_DB_PASSWORD and that the project is linked)')
    process.exit(1)
  }
  console.table(JSON.parse(r.stdout).rows)
}
