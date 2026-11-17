// Shared interface pieces for the "calm ledger" design: icons, page headers, the step flow,
// the result band, status pills, skeletons and the rolling number used for live counts.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

// ---- Icons: inline stroke SVGs, decorative unless labelled ----
const PATHS: Record<string, ReactNode> = {
  import: <><path d="M9 2.5v8.5M5.6 7.8L9 11.2l3.4-3.4" /><path d="M3 12.5v2h12v-2" /></>,
  reconcile: <><circle cx="9" cy="9" r="7" /><path d="M5.8 9.2l2.2 2.2 4.2-4.6" /></>,
  clients: <><circle cx="6.8" cy="6.5" r="2.5" /><path d="M2.5 14.5c.5-2.4 2.2-3.6 4.3-3.6s3.8 1.2 4.3 3.6" /><path d="M12 4.3a2.4 2.4 0 010 4.5M13.5 11.2c1.2.5 1.9 1.6 2.1 3.3" /></>,
  projects: <path d="M2.5 5.5a1.5 1.5 0 011.5-1.5h3l1.5 1.8H14a1.5 1.5 0 011.5 1.5V13a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 13z" />,
  time: <><circle cx="9" cy="9" r="7" /><path d="M9 5v4l2.6 1.6" /></>,
  invoices: <><path d="M4.5 2.5h9v13l-2.2-1.4-2.3 1.4-2.3-1.4-2.2 1.4z" /><path d="M7 6.5h4M7 9.5h4" /></>,
  export: <><path d="M9 11V2.5M5.6 5.7L9 2.3l3.4 3.4" /><path d="M3 10.5v4h12v-4" /></>,
  check: <path d="M4 9.4l3.2 3.2L14 5.4" />,
  arrow: <path d="M2 7h17M14 2.5L19 7l-5 4.5" />,
  alert: <><path d="M9 2.8l7 12.4H2z" /><path d="M9 7.5v3.4M9 13.2v.1" /></>,
  minus: <path d="M5 9h8" />,
  chevron: <path d="M5 7l4 4 4-4" />,
  signout: <><path d="M7 3H4.5A1.5 1.5 0 003 4.5v9A1.5 1.5 0 004.5 15H7" /><path d="M11.5 12.5L15 9l-3.5-3.5M15 9H7" /></>,
  inbox: <><path d="M2.5 10l2-6h9l2 6v4.5h-13z" /><path d="M2.5 10h4l1 2h3l1-2h4" /></>,
  lock: <><rect x="3.5" y="8" width="11" height="7.5" rx="1.5" /><path d="M6 8V5.8a3 3 0 016 0V8" /></>,
}

export function Icon({ name, size = 18, className = '', label }: { name: keyof typeof PATHS | string; size?: number; className?: string; label?: string }) {
  const viewBox = name === 'arrow' ? '0 0 22 14' : '0 0 18 18'
  return (
    <svg width={name === 'arrow' ? size * 1.2 : size} height={name === 'arrow' ? size * 0.75 : size} viewBox={viewBox} fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      {PATHS[name]}
    </svg>
  )
}

// ---- Page header: small tracked label, serif headline, optional sub and action ----
export function PageHeader({ eyebrow, title, sub, action }: { eyebrow: string; title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="rise mb-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
      <div className="flex min-w-0 flex-col gap-2.5">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="display text-[40px] sm:text-[52px]">{title}</h1>
        {sub && <p className="max-w-2xl text-muted">{sub}</p>}
      </div>
      {action}
    </header>
  )
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-1 mt-10 flex flex-col gap-1">
      <h2 className="display text-2xl" style={{ letterSpacing: '-0.02em' }}>{children}</h2>
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </div>
  )
}

// ---- Step flow: Connect → Import → Reconcile ----
export type StepState = 'done' | 'active' | 'warn' | 'waiting'
export function StepFlow({ steps, className = '' }: { steps: { label: string; detail?: ReactNode; state: StepState }[]; className?: string }) {
  return (
    <ol aria-label="Import steps" className={`card lift flex flex-wrap items-center gap-x-5 gap-y-4 px-6 py-5 ${className}`}>
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-5" aria-current={s.state === 'active' ? 'step' : undefined}>
          {i > 0 && <span className="hidden text-accent sm:inline"><Icon name="arrow" size={18} /></span>}
          <span className="flex items-center gap-3">
            <StepMark state={s.state} n={i + 1} />
            <span className="flex flex-col leading-snug">
              <span className="font-semibold">{s.label}<span className="sr-only">: {STEP_WORD[s.state]}</span></span>
              {s.detail && <span className="text-[13px] text-muted">{s.detail}</span>}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}
const STEP_WORD: Record<StepState, string> = { done: 'done', active: 'in progress', warn: 'needs attention', waiting: 'not started' }
function StepMark({ state, n }: { state: StepState; n: number }) {
  const base = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full'
  if (state === 'done') return <span className={`${base} bg-ok-soft text-ok`}><Icon name="check" size={18} /></span>
  if (state === 'warn') return <span className={`${base} bg-warn-soft text-warn`}><Icon name="alert" size={18} /></span>
  if (state === 'active') {
    return (
      <span className={`${base} bg-accent-soft text-accent`}>
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
      </span>
    )
  }
  return <span className={`${base} border border-line-strong text-sm font-semibold text-muted`}>{n}</span>
}

// ---- Result band: an accent tag beside one serif statement ----
export function ResultBand({ children, tone = 'accent', className = '' }: { children: ReactNode; tone?: 'accent' | 'warn'; className?: string }) {
  return (
    <section aria-label="Result" className={`card lift flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5 ${className}`}>
      <span className={`inline-flex h-[34px] items-center rounded-[10px] px-3.5 text-[13px] font-semibold uppercase tracking-[0.08em] ${tone === 'warn' ? 'bg-warn text-paper' : 'bg-accent text-on-accent'}`}>
        Result
      </span>
      <p className="display text-[22px] sm:text-[26px]" style={{ letterSpacing: '-0.02em', lineHeight: 1.2 }}>{children}</p>
    </section>
  )
}

// ---- Status pills: colour, shape and words all differ, so none depends on colour alone ----
export type Tone = 'ok' | 'warn' | 'danger' | 'neutral' | 'accent'
const PILL_TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-paper text-muted ring-1 ring-line',
  accent: 'bg-accent-soft text-accent',
}
export function Pill({ tone, children, className = '' }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`pill ${PILL_TONE[tone]} ${className}`}>
      {tone === 'warn' || tone === 'danger'
        ? <Icon name="alert" size={13} />
        : <span aria-hidden className="h-2 w-2 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export const YearChip = ({ children }: { children: ReactNode }) => <span className="chip">{children}</span>

// ---- Callout: for refused record types, mismatches and errors ----
export function Callout({ tone, title, children, role = 'status' }: { tone: 'warn' | 'danger' | 'info'; title: ReactNode; children?: ReactNode; role?: 'status' | 'alert' }) {
  const tones = { warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger', info: 'bg-accent-soft text-accent' }
  return (
    <div role={role} className="card flex gap-4 p-5">
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tones[tone]}`}><Icon name={tone === 'info' ? 'reconcile' : 'alert'} /></span>
      <div className="min-w-0 text-sm">
        <p className="text-base font-semibold text-ink">{title}</p>
        {children && <div className="mt-1 text-muted">{children}</div>}
      </div>
    </div>
  )
}

// ---- Empty and loading states ----
export function EmptyState({ icon = 'inbox', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"><Icon name={icon} size={22} /></span>
      <p className="display text-xl" style={{ letterSpacing: '-0.01em' }}>{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  )
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-[52px]" style={{ opacity: 1 - i * 0.1 }} />)}
    </div>
  )
}

export const Skeleton = ({ className = '' }: { className?: string }) => <div aria-hidden className={`skeleton ${className}`} />

// ---- A number that rolls upward to its new value ----
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function useRollingNumber(target: number, duration = 700): number {
  const [shown, setShown] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (reduceMotion() || target <= from.current) {
      from.current = target
      setShown(target)
      return
    }
    const start = performance.now()
    const begin = from.current
    let frame = 0
    const tick = (t: number) => {
      const p = Math.min((t - start) / duration, 1)
      const eased = 1 - (1 - p) ** 3
      setShown(Math.round(begin + (target - begin) * eased))
      if (p < 1) frame = requestAnimationFrame(tick)
      else from.current = target
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      from.current = target
    }
  }, [target, duration])
  return shown
}

export function RollingNumber({ value, className = '' }: { value: number; className?: string }) {
  const shown = useRollingNumber(value)
  return <span className={className}>{shown.toLocaleString()}</span>
}

/** Inline style carrying a row's index for the staggered rise. */
export const stagger = (i: number) => ({ '--i': i }) as CSSProperties
