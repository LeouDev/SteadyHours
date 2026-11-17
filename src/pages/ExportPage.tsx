import { useState } from 'react'
import { download, EXPORT_TABLES, fetchAll, toCsv, zip } from '../lib/export.ts'
import { Icon, PageHeader } from '../lib/ui.tsx'
import { useWs } from './AppLayout.tsx'
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
      <PageHeader eyebrow="Export" title={<>Take everything<br />with you</>}
        sub="Everything in this workspace, on every plan including the free archive. Money is in integer minor units (cents) with each row’s currency; dates are ISO 8601." />
      <div className="card lift rise flex max-w-2xl flex-col gap-4 p-6 sm:p-8">
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" disabled={!!status?.endsWith('…')} onClick={() => run('json')}><Icon name="export" size={16} /> Download JSON</button>
          <button className="btn-secondary" disabled={!!status?.endsWith('…')} onClick={() => run('csv')}>Download CSV (zip)</button>
        </div>
        <p aria-live="polite" className="text-sm text-muted">{status}</p>
        {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      </div>
      <DeleteWorkspace />
    </>
  )
}
