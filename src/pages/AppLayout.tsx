import { NavLink, Navigate, Outlet, useOutletContext } from 'react-router'
import { PRODUCT_NAME } from '../../supabase/functions/_shared/config.ts'
import { supabase } from '../lib/supabase.ts'
import { Footer } from './Legal.tsx'
import { useSession, useWorkspace, type Workspace } from '../lib/workspace.ts'

const NAV = [
  ['import', 'Import'],
  ['reconcile', 'Reconcile'],
  ['clients', 'Clients'],
  ['projects', 'Projects'],
  ['time', 'Time'],
  ['invoices', 'Invoices'],
  ['export', 'Export'],
] as const

export function AppLayout() {
  const session = useSession()
  const ws = useWorkspace(session?.user.id)
  if (session === undefined || ws.isLoading) return <p className="p-8 text-muted">Loading…</p>
  if (!session) return <Navigate to="/signin" replace />
  if (ws.error || !ws.data) return <p role="alert" className="p-8 text-danger">Could not load your workspace. {ws.error?.message}</p>

  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <span className="font-semibold text-ink">{PRODUCT_NAME}</span>
          <nav aria-label="Main" className="-mx-1 flex flex-wrap gap-1 text-sm">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to}
                className={({ isActive }) => `rounded-md px-2.5 py-1.5 ${isActive ? 'bg-accent-soft font-medium text-ink' : 'text-muted hover:text-ink'}`}>
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted">
            <span className="hidden sm:inline">{ws.data.name}</span>
            <button onClick={() => supabase.auth.signOut()} className="hover:text-ink">Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Outlet context={ws.data} />
      </main>
      <Footer />
    </div>
  )
}

export const useWs = () => useOutletContext<Workspace>()

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{children}</h1>
      {sub && <p className="mt-1 max-w-3xl text-muted">{sub}</p>}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="card p-6 text-muted">{children}</p>
}
