import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { supabase } from '../lib/supabase.ts'
import { PRODUCT_NAME } from '../../supabase/functions/_shared/config.ts'

// Where links in auth emails land. The /auth screen finishes sign-in or explains a bad link.
const callbackUrl = () => `${window.location.origin}/auth`

/** Centred card used by sign-in and the other account screens. */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6">
      <div className="card w-full max-w-sm p-6">
        <Link to="/" className="text-sm font-semibold text-ink">{PRODUCT_NAME}</Link>
        <h1 className="mb-5 mt-4 text-xl font-semibold text-ink">{title}</h1>
        {children}
      </div>
    </div>
  )
}

/** Supabase Auth errors in plain words. */
function plain(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? ''
  const status = (err as { status?: number })?.status
  if (/invalid login credentials/i.test(msg)) return 'That email and password don’t match an account.'
  if (/email not confirmed/i.test(msg)) return 'Confirm your email address first. Use the link we sent you, or request a new one below.'
  if (/already registered|already been registered/i.test(msg)) return 'There’s already an account for this email. Sign in instead.'
  if (/signups not allowed for otp|user not found/i.test(msg)) return 'No account uses this email yet. Create one first.'
  if (status === 429 || /rate limit/i.test(msg)) return 'Too many emails were sent just now. Wait a minute, then try again.'
  if (/password/i.test(msg)) return msg
  return 'Something went wrong. Please try again.'
}

type Msg = { kind: 'error' | 'info'; text: string } | null

function Message({ msg }: { msg: Msg }) {
  if (!msg) return null
  return (
    <p role={msg.kind === 'error' ? 'alert' : 'status'} className={msg.kind === 'error' ? 'text-sm text-danger' : 'text-sm text-muted'}>
      {msg.text}
    </p>
  )
}

/** Email + password, or a magic link. `mode` decides whether a new account may be created. */
export function AuthForm({ mode }: { mode: 'signup' | 'signin' }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [useLink, setUseLink] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Msg>(null)
  const [unconfirmed, setUnconfirmed] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    setUnconfirmed(false)
    const emailRedirectTo = callbackUrl()
    try {
      if (useLink) {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo, shouldCreateUser: mode === 'signup' } })
        if (error) throw error
        navigate(`/check-email?kind=link&email=${encodeURIComponent(email)}`)
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo } })
        if (error) throw error
        // An existing address comes back with no identities (Supabase hides whether it exists).
        if (data.user && data.user.identities?.length === 0) throw new Error('already registered')
        if (data.session) navigate('/app/import')
        else navigate(`/check-email?kind=signup&email=${encodeURIComponent(email)}`)
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        navigate('/app')
      }
    } catch (err) {
      setUnconfirmed(/email not confirmed/i.test((err as Error).message ?? ''))
      setMessage({ kind: 'error', text: plain(err) })
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
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-ink">Password</label>
            {mode === 'signin' && <Link to="/forgot-password" className="text-sm text-accent hover:underline">Forgot password?</Link>}
          </div>
          <input id="password" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} className="field mt-1" />
          {mode === 'signup' && <p className="mt-1 text-xs text-muted">At least 8 characters.</p>}
        </div>
      )}
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? 'Working…' : useLink ? 'Email me a link' : mode === 'signup' ? 'Create free account' : 'Sign in'}
      </button>
      <button type="button" onClick={() => setUseLink(!useLink)} className="w-full text-sm text-accent underline-offset-2 hover:underline">
        {useLink ? 'Use a password instead' : 'Email me a sign-in link instead'}
      </button>
      <Message msg={message} />
      {unconfirmed && <Link to={`/check-email?kind=signup&email=${encodeURIComponent(email)}`} className="text-sm text-accent hover:underline">Send the confirmation link again</Link>}
    </form>
  )
}

/** After sign-up or a magic-link request: where the email went, and a resend button. */
export function CheckEmail() {
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const kind = params.get('kind') === 'link' ? 'link' : 'signup'
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  async function resend() {
    setBusy(true)
    setMsg(null)
    const { error } = kind === 'signup'
      ? await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: callbackUrl() } })
      : await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callbackUrl(), shouldCreateUser: false } })
    setBusy(false)
    setMsg(error ? { kind: 'error', text: plain(error) } : { kind: 'info', text: 'Sent. It can take a minute to arrive.' })
  }

  return (
    <AuthShell title="Check your email">
      <p className="text-ink">
        We sent a link to <strong className="break-all">{email || 'your email address'}</strong>.{' '}
        {kind === 'signup' ? 'Open it to confirm your address and finish creating your account.' : 'Open it to sign in.'}
      </p>
      <p className="mt-3 text-sm text-muted">Nothing there? Check spam, or send it again. Links expire after an hour.</p>
      <div className="mt-5 space-y-3">
        <button className="btn-secondary w-full" disabled={busy || !email} onClick={resend}>{busy ? 'Sending…' : 'Send the link again'}</button>
        <Message msg={msg} />
        <p className="text-sm text-muted">Wrong address? <Link to="/" className="text-accent hover:underline">Start again</Link></p>
      </div>
    </AuthShell>
  )
}

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
    setBusy(false)
    // Same answer whether or not the address has an account, so this can't be used to probe for users.
    setMsg(error ? { kind: 'error', text: plain(error) } : { kind: 'info', text: `If ${email} has an account, a link to reset the password is on its way.` })
  }

  return (
    <AuthShell title="Reset your password">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-ink">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1" />
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Sending…' : 'Email me a reset link'}</button>
        <Message msg={msg} />
        <p className="text-sm text-muted"><Link to="/signin" className="text-accent hover:underline">Back to sign in</Link></p>
      </form>
    </AuthShell>
  )
}

/** Reads an error Supabase put on a redirect (expired or reused link), from the hash or query. */
function linkError(): string | null {
  const p = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1))
  const code = p.get('error_code') ?? p.get('error')
  if (!code) return null
  return /expired/i.test(code + (p.get('error_description') ?? ''))
    ? 'This link has expired. Links work once and for an hour.'
    : 'This link can’t be used any more. It may have been opened already.'
}

/** Waits for the session a link in an email sets up (supabase-js reads it from the URL). */
function useLinkSession() {
  const [state, setState] = useState<'waiting' | 'ready' | 'failed'>(linkError() ? 'failed' : 'waiting')
  useEffect(() => {
    if (state === 'failed') return
    const { data } = supabase.auth.onAuthStateChange((_e, s) => s && setState('ready'))
    supabase.auth.getSession().then(({ data: d }) => d.session && setState('ready'))
    const t = setTimeout(() => setState((s) => (s === 'waiting' ? 'failed' : s)), 8000)
    return () => {
      data.subscription.unsubscribe()
      clearTimeout(t)
    }
  }, [state])
  return state
}

export function ResetPassword() {
  const navigate = useNavigate()
  const state = useLinkSession()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setMsg({ kind: 'error', text: plain(error) })
    else navigate('/app')
  }

  if (state === 'failed') {
    return (
      <AuthShell title="Reset your password">
        <p role="alert" className="text-danger">{linkError() ?? 'This reset link isn’t valid any more.'}</p>
        <Link to="/forgot-password" className="btn-primary mt-5 w-full">Send a new link</Link>
      </AuthShell>
    )
  }
  return (
    <AuthShell title="Choose a new password">
      {state === 'waiting' ? <p className="text-muted">Checking your link…</p> : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-ink">New password</label>
            <input id="password" type="password" required minLength={8} autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} className="field mt-1" />
            <p className="mt-1 text-xs text-muted">At least 8 characters.</p>
          </div>
          <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? 'Saving…' : 'Save password and continue'}</button>
          <Message msg={msg} />
        </form>
      )}
    </AuthShell>
  )
}

/** Landing spot for confirmation and magic links: signs in, or explains why the link failed. */
export function AuthCallback() {
  const navigate = useNavigate()
  const state = useLinkSession()
  useEffect(() => {
    if (state === 'ready') navigate('/app/import', { replace: true })
  }, [state, navigate])

  if (state !== 'failed') return <AuthShell title="Signing you in…"><p className="text-muted">One moment.</p></AuthShell>
  return (
    <AuthShell title="That link didn’t work">
      <p role="alert" className="text-danger">{linkError() ?? 'We couldn’t sign you in with that link.'}</p>
      <p className="mt-3 text-sm text-muted">Sign in to get a new one. If you just confirmed your email, you can sign in with your password.</p>
      <Link to="/signin" className="btn-primary mt-5 w-full">Go to sign in</Link>
    </AuthShell>
  )
}
