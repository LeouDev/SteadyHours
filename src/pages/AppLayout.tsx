import { NavLink, Navigate, Outlet, useLocation, useOutletContext } from 'react-router'
import { PRODUCT_NAME } from '../../supabase/functions/_shared/config.ts'
import { supabase } from '../lib/supabase.ts'
import { Icon, Skeleton } from '../lib/ui.tsx'
import { useSession, useWorkspace, type Workspace } from '../lib/workspace.ts'
import { Footer } from './Legal.tsx'

const NAV = [
  ['import', 'Import', 'import'],
  ['reconcile', 'Reconcile', 'reconcile'],
  ['time', 'Time', 'time'],
  ['invoices', 'Invoices', 'invoices'],
  ['clients', 'Clients', 'clients'],
  ['projects', 'Projects', 'projects'],
  ['export', 'Export', 'export'],
] as const

export function AppLayout() {
  const session = useSession()
  const ws = useWorkspace(session?.user.id)
  const location = useLocation()
  if (session === undefined || ws.isLoading) return <ShellSkeleton />
  if (!session) return <Navigate to="/signin" replace />
  if (ws.error || !ws.data) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper p-6">
        <p role="alert" className="card max-w-md p-6 text-ink">We couldn’t load your workspace. Refresh the page, or sign in again.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">Skip to content</a>
      <aside className="border-b border-line bg-surface md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex flex-col gap-5 px-4 py-4 md:sticky md:top-0 md:h-screen md:gap-6 md:py-6">
        <div className="flex items-center justify-between gap-3 px-3">
          <span className="display text-[22px]" style={{ letterSpacing: '-0.02em' }}>{PRODUCT_NAME}</span>
          <SignOut className="md:hidden" />
        </div>
        <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:flex-col md:overflow-visible md:p-0">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex min-h-11 shrink-0 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors ${
                  isActive ? 'bg-accent-soft font-semibold text-accent' : 'text-muted hover:bg-raise hover:text-ink'}`}>
              <Icon name={icon} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden flex-col gap-2 border-t border-line px-3 pt-4 md:flex">
          <span className="eyebrow">Workspace</span>
          <span className="truncate text-sm font-medium" title={ws.data.name}>{ws.data.name}</span>
          <SignOut />
        </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" key={location.pathname} className="page-fade mx-auto w-full max-w-[1040px] flex-1 px-4 py-8 sm:px-8 md:py-10">
          <Outlet context={ws.data} />
        </main>
        <Footer />
      </div>
    </div>
  )
}

function SignOut({ className = '' }: { className?: string }) {
  return (
    <button onClick={() => supabase.auth.signOut()}
      className={`-ml-1 inline-flex min-h-11 items-center gap-2 rounded-xl px-1 text-sm text-muted hover:text-ink ${className}`}>
      <Icon name="signout" size={16} /> Sign out
    </button>
  )
}

function ShellSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex min-h-screen flex-col bg-paper md:flex-row">
      <div className="h-28 border-b border-line bg-surface md:h-screen md:w-60 md:border-b-0 md:border-r" />
      <div className="mx-auto w-full max-w-[1040px] px-8 py-10">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-12 w-2/3" />
        <Skeleton className="mt-8 h-24 w-full" />
      </div>
    </div>
  )
}

export const useWs = () => useOutletContext<Workspace>()
