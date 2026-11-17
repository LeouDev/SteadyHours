import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { must, supabase } from './supabase.ts'

export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

export type Workspace = { id: string; name: string; role: 'owner' | 'admin' | 'member' }

/** The signed-in user's workspace (one per account in this slice). */
export function useWorkspace(userId: string | undefined) {
  return useQuery({
    queryKey: ['workspace', userId],
    enabled: !!userId,
    queryFn: async (): Promise<Workspace | null> => {
      const rows = must(await supabase.from('memberships')
        .select('role, workspace:workspaces(id, name)')
        .eq('user_id', userId!).eq('is_active', true).order('created_at').limit(1))
      const m = rows[0] as unknown as { role: Workspace['role']; workspace: { id: string; name: string } } | undefined
      return m ? { ...m.workspace, role: m.role } : null
    },
  })
}
