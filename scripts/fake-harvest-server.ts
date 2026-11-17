// Serves the Harvest fixtures over HTTP for running the real Edge Function locally.
// FAKE_HARVEST_BASE=http://host.docker.internal:54399/v2 node --experimental-strip-types scripts/fake-harvest-server.ts
import { createServer } from 'node:http'
import { fakeHarvest, HARVEST_BASE } from '../tests/helpers.ts'

const harvest = fakeHarvest({ rateLimitOnce: ['time_entries'] })
const port = Number(new URL(HARVEST_BASE).port || 54399)

createServer(async (req, res) => {
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [
    k === 'authorization' ? 'Authorization' : k === 'harvest-account-id' ? 'Harvest-Account-Id' : k === 'user-agent' ? 'User-Agent' : k, String(v),
  ]))
  const r = await harvest.fetch(new URL(req.url!, HARVEST_BASE).toString().replace(/\/v2\/v2\//, '/v2/'), { headers })
  console.log(r.status, req.method, req.url, 'UA:', headers['User-Agent'])
  res.writeHead(r.status, Object.fromEntries(r.headers))
  res.end(await r.text())
}).listen(port, '0.0.0.0', () => console.log(`fake Harvest on ${HARVEST_BASE}`))
