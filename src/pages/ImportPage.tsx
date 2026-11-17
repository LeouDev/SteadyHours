import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { STAGES, type Stage } from '../../supabase/functions/_shared/harvest/stages.ts'
import { ImportScope } from '../lib/scope.tsx'
import { must, supabase } from '../lib/supabase.ts'
import { Callout, Icon, PageHeader, Pill, ResultBand, RollingNumber, Skeleton, StepFlow, stagger, type StepState } from '../lib/ui.tsx'
import { useWs } from './AppLayout.tsx'

const LABELS: Record<Stage, string> = {
  users: 'People', clients: 'Clients', contacts: 'Contacts', projects: 'Projects', tasks: 'Tasks',
  task_assignments: 'Task assignments', invoices: 'Invoices', estimates: 'Estimates', expenses: 'Expenses', time_entries: 'Time entries',
}

type ImportRow = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  counts: Partial<Record<Stage, number>>
  progress: { stage?: number; skipped?: string[]; warnings?: number; warning_samples?: string[]; harvest_role?: string; runs?: number }
  error: string | null
  heartbeat_at: string | null
  started_at: string
  finished_at: string | null
}

const active = (i?: ImportRow | null) => i?.status === 'queued' || i?.status === 'running'

async function callImport(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('harvest-import', { body })
  if (error) {
    if (error instanceof FunctionsFetchError) throw new Error('We couldn’t reach the import service. Check your connection and try again.')
    const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
    throw new Error(detail?.error ?? 'The import service had a problem. Please try again in a minute.')
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
  const current = imp?.progress.stage ?? 0
  const importState: StepState = !imp ? 'waiting' : active(imp) ? 'active' : imp.status === 'failed' ? 'warn' : 'done'
  const records = Object.values(imp?.counts ?? {}).reduce((s, n) => s + (n ?? 0), 0)

  return (
    <>
      <PageHeader
        eyebrow="Import"
        title={<>Bring your Harvest<br />history across</>}
        sub="Running it again updates what changed and never duplicates anything."
      />

      {latest.isLoading ? <Skeleton className="h-[84px] w-full" /> : (
        <StepFlow className="rise" steps={[
          { label: 'Connect', detail: imp ? 'Harvest account linked' : 'Paste your token below', state: imp ? 'done' : 'active' },
          {
            label: 'Import', state: importState,
            detail: !imp ? undefined : active(imp)
              ? (imp.status === 'queued' ? 'Starting…' : `Importing ${LABELS[STAGES[current]]?.toLowerCase() ?? ''}…`)
              : imp.status === 'failed' ? 'Stopped before finishing' : `${records.toLocaleString()} records`,
          },
          {
            label: 'Reconcile', state: imp?.status === 'succeeded' ? 'active' : 'waiting',
            detail: imp?.status === 'succeeded' ? <Link to="../reconcile" className="link">Check the totals</Link> : undefined,
          },
        ]} />
      )}

      {imp && <Progress imp={imp} onResume={() => callImport({ action: 'resume', import_id: imp.id }).then(() => qc.invalidateQueries({ queryKey: ['import', ws.id] }))} />}
      {!latest.isLoading && !active(imp) && canImport && <StartForm onStarted={() => qc.invalidateQueries({ queryKey: ['import', ws.id] })} again={!!imp} />}
      {!canImport && <p className="mt-6 text-muted">Only the workspace owner or an admin can run an import.</p>}

      <details open={!latest.isLoading && !imp} className="card group mt-8 px-6 py-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
          What comes across, and what doesn’t
          <Icon name="chevron" className="text-muted transition-transform group-open:rotate-180" />
        </summary>
        <ImportScope className="mb-3 mt-2" />
      </details>
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
    <form onSubmit={submit} className="card rise mt-6 grid gap-8 p-6 md:grid-cols-[1fr_1.1fr] md:p-8" style={{ '--delay': '80ms' } as React.CSSProperties}>
      <div className="flex flex-col gap-4">
        <h2 className="display text-2xl" style={{ letterSpacing: '-0.02em' }}>{again ? 'Import again' : 'Connect your Harvest account'}</h2>
        <ol className="flex flex-col gap-3 text-sm">
          <li className="flex gap-3"><span className="chip !h-7 !min-w-7 shrink-0 !px-0 text-xs">1</span><span>In Harvest, go to <strong>id.getharvest.com/developers</strong> and choose <strong>Create new personal access token</strong>.</span></li>
          <li className="flex gap-3"><span className="chip !h-7 !min-w-7 shrink-0 !px-0 text-xs">2</span><span>Copy the token and the <strong>Account ID</strong> shown with it into these fields.</span></li>
        </ol>
        <div className="rounded-2xl bg-accent-soft p-4 text-sm">
          <p className="font-semibold text-ink">Use a token that belongs to a Harvest Administrator.</p>
          <p className="mt-1 text-muted">
            A Manager’s token gets people, invoices and estimates only if their Harvest permissions allow it. With any other role
            Harvest refuses people, invoices and estimates, and may limit time and expenses to what that person can see. Anything
            refused is listed on the Reconcile screen.
          </p>
        </div>
        <p className="flex gap-2 text-sm text-muted"><Icon name="lock" size={16} className="mt-0.5" />The token is encrypted while the import runs and deleted as soon as it finishes or stops.</p>
      </div>
      <div className="flex flex-col gap-4 md:pt-12">
        <div>
          <label htmlFor="account" className="block text-sm font-medium">Account ID</label>
          <input id="account" inputMode="numeric" required pattern="\d+" value={accountId} onChange={(e) => setAccountId(e.target.value.trim())} className="field mt-1.5" />
        </div>
        <div>
          <label htmlFor="token" className="block text-sm font-medium">Personal access token</label>
          <input id="token" type="password" required autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
            aria-invalid={start.error ? true : undefined} aria-describedby={start.error ? 'start-error' : undefined} className="field mt-1.5 font-mono" />
        </div>
        <button type="submit" disabled={start.isPending} className="btn-primary mt-1 self-start">
          {start.isPending ? 'Checking access…' : <>Start import <Icon name="arrow" size={15} /></>}
        </button>
        {start.error && <p id="start-error" role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{start.error.message}</p>}
      </div>
    </form>
  )
}

function Progress({ imp, onResume }: { imp: ImportRow; onResume: () => void }) {
  const current = imp.progress.stage ?? 0
  const stalled = active(imp) && imp.heartbeat_at && Date.now() - new Date(imp.heartbeat_at).getTime() > 3 * 60_000
  const skipped = new Set(imp.progress.skipped ?? [])
  const statusText = {
    queued: 'Starting your import…',
    running: `Importing ${LABELS[STAGES[current]]?.toLowerCase() ?? ''}…`,
    succeeded: 'Import finished',
    failed: 'The import stopped',
  }[imp.status]

  return (
    <section aria-labelledby="progress-heading" className="mt-8">
      <h2 id="progress-heading" aria-live="polite" className="display mb-4 text-2xl" style={{ letterSpacing: '-0.02em' }}>{statusText}</h2>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STAGES.map((s, i) => {
          const state = skipped.has(s) ? 'skipped' : imp.status === 'succeeded' || i < current ? 'done' : i === current && active(imp) ? 'now' : 'waiting'
          return (
            <li key={s} style={stagger(i)}
              className={`card row-rise flex flex-col gap-2 p-4 ${state === 'now' ? 'border-accent ring-2 ring-accent/20' : ''}`}>
              <span className="text-[13px] text-muted">{LABELS[s]}</span>
              {state === 'skipped'
                ? <span className="figure text-[28px] text-muted">—</span>
                : <RollingNumber value={imp.counts[s] ?? 0} className={`figure text-[28px] ${state === 'waiting' ? 'text-muted' : ''}`} />}
              <span className="pop">
                {state === 'done' && <Pill tone="ok">Done</Pill>}
                {state === 'now' && <Pill tone="accent">Importing</Pill>}
                {state === 'waiting' && <Pill tone="neutral">Waiting</Pill>}
                {state === 'skipped' && <Pill tone="warn">Refused</Pill>}
              </span>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 flex flex-col gap-3">
        {skipped.size > 0 && (
          <Callout tone="warn" title={`Harvest refused ${[...skipped].map((s) => LABELS[s as Stage]?.toLowerCase() ?? s).join(', ')}`}>
            They are not in your archive. Run the import again with a Harvest Administrator’s token to bring them across.
          </Callout>
        )}
        {imp.progress.harvest_role && imp.progress.harvest_role !== 'administrator' && skipped.size === 0 && (
          <Callout tone="info" title={`This token belongs to a Harvest ${imp.progress.harvest_role}`}>Harvest may show it less than an Administrator would.</Callout>
        )}
        {!!imp.progress.warnings && (
          <details className="card p-5 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-warn">
              {imp.progress.warnings} amount{imp.progress.warnings === 1 ? '' : 's'} needed attention
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{imp.progress.warning_samples?.map((w) => <li key={w}>{w}</li>)}</ul>
          </details>
        )}
        {imp.error && (
          <Callout tone={active(imp) ? 'warn' : 'danger'} role="alert" title={active(imp) ? 'A problem, retrying' : 'The import stopped'}>{imp.error}</Callout>
        )}
        {stalled && <button onClick={onResume} className="btn-secondary self-start">Resume import</button>}
      </div>

      {imp.status === 'succeeded' && (
        <div className="rise mt-6 flex flex-col gap-4">
          <ResultBand>Your Harvest history is here. Check the totals next.</ResultBand>
          <Link to="../reconcile" className="btn-primary self-start">Check the totals <Icon name="arrow" size={15} /></Link>
        </div>
      )}
    </section>
  )
}
