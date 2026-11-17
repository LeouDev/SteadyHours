// Runs a command with .env loaded and every .env value redacted from its output.
// node scripts/with-env.mjs <command> [args...]
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const vars = {}
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
  if (m && m[2].trim()) vars[m[1]] = m[2].trim()
}
const secrets = Object.values(vars).filter((v) => v.length >= 6).sort((a, b) => b.length - a.length)
const redact = (s) => secrets.reduce((out, v) => out.split(v).join('[redacted]'), s)
const [cmd, ...args] = process.argv.slice(2)
const r = spawnSync(cmd, args, { env: { ...process.env, ...vars }, encoding: 'utf8', input: '', maxBuffer: 64 * 1024 * 1024 })
process.stdout.write(redact(r.stdout ?? ''))
process.stderr.write(redact(r.stderr ?? ''))
process.exit(r.status ?? 1)
