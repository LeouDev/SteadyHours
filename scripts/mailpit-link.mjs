// Local testing only: prints the newest auth link Mailpit received for an address.
// node scripts/mailpit-link.mjs someone@test.local
import { execSync } from 'node:child_process'
const { MAILPIT_URL } = JSON.parse(execSync('supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }))
const email = process.argv[2]
for (let i = 0; i < 20; i++) {
  const list = await (await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()
  const m = list.messages?.[0]
  if (m) {
    const full = await (await fetch(`${MAILPIT_URL}/api/v1/message/${m.ID}`)).json()
    const link = /href="([^"]+)"/.exec(full.HTML)?.[1]?.replaceAll('&amp;', '&')
    console.log(JSON.stringify({ subject: m.Subject, link }))
    process.exit(0)
  }
  await new Promise((r) => setTimeout(r, 500))
}
console.error('no mail for', email)
process.exit(1)
