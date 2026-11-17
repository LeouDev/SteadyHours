import { useState } from 'react'
import { download, EXPORT_TABLES, fetchAll, toCsv, zip } from '../lib/export.ts'
import { PageTitle, useWs } from './AppLayout.tsx'
import { DeleteWorkspace } from './DeleteWorkspace.tsx'

export function ExportPage() {
  const ws = useWs()
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(format: 'json' | 'csv') {
    setError(null)
    try {
      const data: Record<string, unknown[]> = {}
      for (const t of EXPORT_TABLES) {
        setStatus(`Reading ${t.replace('_', ' ')}…`)
        data[t] = await fetchAll(t, ws.id)
      }
      const stamp = new Date().toISOString().slice(0, 10)
      if (format === 'json') {
        download(`export-${stamp}.json`, JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2), 'application/json')
      } else {
        download(`export-${stamp}-csv.zip`, zip(Object.entries(data).map(([t, rows]) => ({ name: `${t}.csv`, text: toCsv(rows as Record<string, unknown>[]) }))), 'application/zip')
      }
      setStatus(`Done: ${Object.values(data).reduce((s, r) => s + r.length, 0).toLocaleString()} records exported.`)
    } catch (e) {
      setStatus(null)
      setError((e as Error).message)
    }
  }

  return (
    <>
      <PageTitle sub="Everything in this workspace, on every plan including the free archive. Money is in integer minor units (cents) with each row’s currency; dates are ISO 8601.">
        Export
      </PageTitle>
      <div className="card flex max-w-xl flex-wrap gap-3 p-6">
        <button className="btn-primary" disabled={!!status?.endsWith('…')} onClick={() => run('json')}>Download JSON</button>
        <button className="btn-secondary" disabled={!!status?.endsWith('…')} onClick={() => run('csv')}>Download CSV (zip)</button>
        <p aria-live="polite" className="w-full text-sm text-muted">{status}</p>
        {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
      </div>
      <DeleteWorkspace />
    </>
  )
}
