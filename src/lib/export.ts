import { supabase } from './supabase.ts'

export { toCsv, zip } from './files.ts'

export const EXPORT_TABLES = [
  'workspaces', 'memberships', 'clients', 'contacts', 'projects', 'tasks', 'project_tasks',
  'time_entries', 'expenses', 'invoices', 'invoice_items', 'estimates', 'imports',
] as const

type Row = Record<string, unknown>

/** Every row of a table in this workspace, 1000 at a time (the API's page limit). */
export async function fetchAll(table: string, workspaceId: string): Promise<Row[]> {
  const out: Row[] = []
  const column = table === 'workspaces' ? 'id' : 'workspace_id'
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').eq(column, workspaceId).order('id').range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
