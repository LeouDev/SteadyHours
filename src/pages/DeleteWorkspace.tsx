import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '../lib/supabase.ts'
import { useWs } from './AppLayout.tsx'

/** Owner-only, permanent: the name must be typed exactly before the button works. */
export function DeleteWorkspace() {
  const ws = useWs()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (ws.role !== 'owner') return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('delete_workspace', { ws: ws.id, confirmation: typed })
    setBusy(false)
    if (error) return setError(error.message.startsWith('The name') || error.message.startsWith('Only') ? error.message : 'The workspace couldn’t be deleted. Please try again.')
    // The login is gone too; clear the local session and leave.
    await supabase.auth.signOut({ scope: 'local' })
    navigate('/?deleted=1', { replace: true })
  }

  return (
    <section aria-labelledby="delete-heading" className="card mt-10 max-w-xl border-danger/40 p-6">
      <h2 id="delete-heading" className="font-semibold text-danger">Delete this workspace</h2>
      <p className="mt-2 text-sm text-ink">
        This permanently deletes the workspace, everything imported into it, any import in progress and its stored
        Harvest token, and your login. It can’t be undone. Download an export first if you want to keep a copy.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label htmlFor="confirm-name" className="block text-sm text-ink">
          Type <strong className="select-all">{ws.name}</strong> to confirm
        </label>
        <input id="confirm-name" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} className="field" />
        <button type="submit" disabled={busy || typed !== ws.name}
          className="inline-flex items-center justify-center rounded-lg bg-danger px-4 py-2 font-medium text-on-danger hover:opacity-90 disabled:opacity-40">
          {busy ? 'Deleting…' : 'Delete workspace permanently'}
        </button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </form>
    </section>
  )
}
