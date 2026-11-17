import { createClient } from '@supabase/supabase-js'

// Public URL and anon (publishable) key only. Row Level Security does the rest.
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)

/** Supabase returns { data, error }; React Query wants a throw. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}
