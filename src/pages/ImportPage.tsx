import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { STAGES, type Stage } from '../../supabase/functions/_shared/harvest/stages.ts'
import { must, supabase } from '../lib/supabase.ts'
import { PageTitle, useWs } from './AppLayout.tsx'

const LABELS: Record<Stage, string> = {
  users: 'People', clients: 'Clients', contacts: 'Contacts', projects: 'Projects', tasks: 'Tasks',
  task_assignments: 'Task assignments', invoices: 'Invoices', estimates: 'Estimates', expenses: 'Expenses', time_entries: 'Time entries',
}

type ImportRow = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  counts: Partial<Record<Stage, number>>
  progress: { stage?: number; skipped?: string[]; warnings?: number; warning_samples?: string[] }
  error: string | null
  heartbeat_at: string | null
  started_at: string
  finished_at: string | null
}

const active = (i?: ImportRow | null) => i?.status === 'queued' || i?.status === 'running'

async function callImport(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('harvest-import', { body })
  if (error) {
    const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
    throw new Error(detail?.error ?? error.message)
  }
  return data
}

export function ImportPage() {
  const ws = useWs()
  const qc = useQueryClient()
  const latest = useQuery({
    queryKey: ['import', ws.id],
    queryFn: async () => must(await supabase.from('imports').select('*').eq('workspace_id', ws.id)
      .order('started_at', { ascending: false }).limit(1).maybeSingle()) as ImportRow | null,
    refetchInterval: (q) => (active(q.state.data) ? 1500 : false),
  })
  const imp = latest.data
  const canImport = ws.role === 'owner' || ws.role === 'admin'

  return (
    <>
      <PageTitle sub="Everything comes across: people, clients, contacts, projects, tasks, time, expenses, invoices and estimates. Running it again updates what changed and never duplicates.">
        Import from Harvest
      </PageTitle>
      {imp && <Progress imp={imp} onResume={() => callImport({ action: 'resume', import_id: imp.id }).then(() => qc.invalidateQueries({ queryKey: ['import', ws.id] }))} />}
      {!active(imp) && canImport && <StartForm onStarted={() => qc.invalidateQueries({ queryKey: ['import', ws.id] })} again={!!imp} />}
      {!canImport && <p className="text-muted">Only owners and admins can run an import.</p>}
    </>
  )
}

function StartForm({ onStarted, again }: { onStarted: () => void; again: boolean }) {
  const ws = useWs()
  const [accountId, setAccountId] = useState('')
  const [token, setToken] = useState('')
  const start = useMutation({
    mutationFn: () => callImport({ action: 'start', workspace_id: ws.id, account_id: accountId, token }),
    onSuccess: () => {
      setToken('')
      onStarted()
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    start.mutate()
  }

  return (
    <form onSubmit={submit} className="card mt-6 max-w-xl space-y-4 p-6">
      <h2 className="font-semibold text-ink">{again ? 'Import again' : 'Connect your Harvest account'}</h2>
      <p className="text-sm text-muted">
        In Harvest, open the Developers page at id.getharvest.com/developers and create a personal access token.
        That page shows the token and your account ID. The token is encrypted while the import runs and deleted when it finishes.
      </p>
      <div>
        <label htmlFor="account" className="block text-sm font-medium text-ink">Account ID</label>
        <input id="account" inputMode="numeric" required pattern="\d+" value={accountId} onChange={(e) => setAccountId(e.target.value.trim())} className="field mt-1" />
      </div>
      <div>
        <label htmlFor="token" className="block text-sm font-medium text-ink">Personal access token</label>
        <input id="token" type="password" required autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="field mt-1 font-mono" />
      </div>
      <button type="submit" disabled={start.isPending} className="btn-primary">{start.isPending ? 'Checking access…' : 'Start import'}</button>
      {start.error && <p role="alert" className="text-sm text-danger">{start.error.message}</p>}
    </form>
  )
}

function Progress({ imp, onResume }: { imp: ImportRow; onResume: () => void }) {
  const current = imp.progress.stage ?? 0
  const stalled = active(imp) && imp.heartbeat_at && Date.now() - new Date(imp.heartbeat_at).getTime() > 3 * 60_000
  const skipped = new Set(imp.progress.skipped ?? [])
  const statusText = {
    queued: 'Starting…',
    running: `Importing ${LABELS[STAGES[current]]?.toLowerCase() ?? ''}…`,
    succeeded: 'Import finished',
    failed: 'Import failed',
  }[imp.status]

  return (
    <section aria-live="polite" className="card max-w-xl p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-semibold text-ink">{statusText}</h2>
        {imp.status === 'succeeded' && <Link to="../reconcile" className="btn-primary">Check the totals</Link>}
      </div>
      <dl className="mt-4 divide-y divide-line text-sm">
        {STAGES.map((s, i) => {
          const state = skipped.has(s) ? 'skipped' : imp.status === 'succeeded' || i < current ? 'done' : i === current && active(imp) ? 'now' : 'waiting'
          return (
            <div key={s} className="flex items-center justify-between py-2">
              <dt className={state === 'waiting' ? 'text-muted' : 'text-ink'}>
                {state === 'now' && <span aria-hidden className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />}
                {LABELS[s]}
              </dt>
              <dd className="tabular-nums text-ink">
                {state === 'skipped' ? <span className="text-warn">No permission</span> : (imp.counts[s] ?? 0).toLocaleString()}
              </dd>
            </div>
          )
        })}
      </dl>
      {skipped.size > 0 && (
        <p className="mt-4 text-sm text-warn">Harvest refused some record types for this token. An administrator’s token imports everything.</p>
      )}
      {!!imp.progress.warnings && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-warn">{imp.progress.warnings} amount{imp.progress.warnings === 1 ? '' : 's'} needed attention</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{imp.progress.warning_samples?.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}
      {imp.error && <p role="alert" className="mt-4 text-sm text-danger">{imp.error}{active(imp) && ' Retrying automatically.'}</p>}
      {stalled && <button onClick={onResume} className="btn-secondary mt-4">Resume import</button>}
    </section>
  )
}
