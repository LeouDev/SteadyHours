// Import order matters: later stages reference records from earlier ones.
export const STAGES = [
  'users', 'clients', 'contacts', 'projects', 'tasks', 'task_assignments',
  'invoices', 'estimates', 'expenses', 'time_entries',
] as const
export type Stage = (typeof STAGES)[number]
