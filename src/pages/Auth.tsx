import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '../lib/supabase.ts'

/** Email + password, or a magic link. `mode` decides whether a new account may be created. */
export function AuthForm({ mode }: { mode: 'signup' | 'signin' }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [useLink, setUseLink] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const emailRedirectTo = `${window.location.origin}/app`
    try {
      if (useLink) {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: mode === 'signup' } })
        if (error) throw error
        setMessage({ kind: 'info', text: `Check ${email} for a sign-in link.` })
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } })
        if (error) throw error
        if (data.session) navigate('/app/import')
        else setMessage({ kind: 'info', text: `Check ${email} to confirm your address, then sign in.` })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate('/app')
      }
    } catch (err) {
      setMessage({ kind: 'error', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-ink">Work email</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1" />
      </div>
      {!useLink && (
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-ink">Password</label>
          <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className="field mt-1" />
        </div>
      )}
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? 'Working…' : useLink ? 'Email me a link' : mode === 'signup' ? 'Create free account' : 'Sign in'}
      </button>
      <button type="button" onClick={() => setUseLink(!useLink)} className="w-full text-sm text-accent underline-offset-2 hover:underline">
        {useLink ? 'Use a password instead' : 'Email me a sign-in link instead'}
      </button>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-sm text-danger' : 'text-sm text-muted'}>
          {message.text}
        </p>
      )}
    </form>
  )
}
