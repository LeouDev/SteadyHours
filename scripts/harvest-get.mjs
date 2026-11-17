// Read-only peek at the Harvest account in .env. Usage: node scripts/with-env.mjs node scripts/harvest-get.mjs company users ...
const h = { Authorization: `Bearer ${process.env.HARVEST_ACCESS_TOKEN}`, 'Harvest-Account-Id': process.env.HARVEST_ACCOUNT_ID, 'User-Agent': `Steadyhours Importer (${process.env.HARVEST_CONTACT})` }
for (const path of process.argv.slice(2)) {
  const r = await fetch(`https://api.harvestapp.com/v2/${path}`, { headers: h })
  console.log(`== ${path} (${r.status})`)
  console.log(JSON.stringify(await r.json(), null, 1).slice(0, 2500))
}
