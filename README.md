# Steadyhours: Harvest importer and free archive (slice 1)

The product name is a placeholder. It is set in one place: `supabase/functions/_shared/config.ts`.

This slice: sign up (password or magic link), import a Harvest account, check the totals per year,
browse a read-only archive, export everything as CSV or JSON. Spec: PRD section 11 (11.6 schema, 11.7 architecture).

## Layout

| Path | What |
|---|---|
| `supabase/migrations/` | Schema, Row Level Security, signup trigger, reconciliation views, pg_cron job |
| `supabase/functions/harvest-import/` | Edge Function: starts and resumes imports |
| `supabase/functions/_shared/harvest/map.ts` | Pure Harvest → table mapping (unit-tested) |
| `supabase/functions/_shared/harvest/engine.ts` | Resumable, idempotent import loop with rate-limit backoff |
| `supabase/functions/_shared/money.ts` | Decimal ↔ integer minor units, no floats |
| `src/` | React app: landing, auth, import progress, reconciliation, archive, export |
| `tests/` | Unit tests, database tests against the local stack, Harvest-shaped fixtures |

## Run locally

Needs Node 22+, the Supabase CLI and a Docker runtime. With Colima, the project's volume must be shared
with the VM or Edge Functions fail with "failed to determine entrypoint":

```bash
colima start --cpu 4 --memory 6 --mount "$HOME:w" --mount "/Volumes/Mac Storage:w"
```

```bash
npm install
supabase start
supabase db reset
```

Create `.env.local` from `.env.example` with the local API URL and anon key from `supabase status`.
Create `supabase/functions/.env` (git-ignored):

```
IMPORT_TOKEN_KEY=<32 random bytes, base64: openssl rand -base64 32>
HARVEST_CONTACT=<a URL or email Harvest can reach you at; sent in the User-Agent>
# Only for testing against the fixture server:
# HARVEST_API_BASE=http://host.docker.internal:54399/v2
```

```bash
npm run functions:serve
npm run dev
```

Optional: `./scripts/local-cron-secrets.sh` lets pg_cron resume stalled imports locally.

## Tests

```bash
npm test
```

- `tests/money.test.ts`: minor-unit conversion (JPY 0 digits, KWD 3, rounding, float traps).
- `tests/map.test.ts`: mapping of fixture JSON: currencies, two taxes plus discount, archived clients, a user missing from the users list, invoiced time, time billed without an invoice, a duplicate invoice number.
- `tests/db.test.ts` (needs `supabase start`): full import resumed one page per run with a 429 in the middle; the same import run twice leaves row counts unchanged; invoice totals equal lines + taxes − discount; cross-workspace reads and writes are blocked; the free plan is read-only in the database; a bad token fails and is deleted; a transient failure resumes after the lease expires.
- `tests/files.test.ts`: CSV quoting and a ZIP checked with the system `unzip`.

End to end through the real Edge Function, with a fake Harvest serving the fixtures:

```bash
npm run harvest:fake
npm run e2e
```

## Deploying

1. `supabase link --project-ref <ref>` then `supabase db push`.
2. `supabase secrets set IMPORT_TOKEN_KEY=... HARVEST_CONTACT=...`, then `supabase functions deploy harvest-import`.
3. In the SQL editor, give pg_cron what it needs to resume stalled imports:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<service role key>', 'import_cron_key');
   ```
4. Auth: set the Site URL and redirect URLs to the front end's domain; turn on email confirmation.
5. Front end: `npm run build`, host `dist/` as a single-page app (all paths → `index.html`) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## How the import works

- The function checks the token with `GET /v2/users/me`, encrypts it (AES-256-GCM, `IMPORT_TOKEN_KEY`) into
  `import_secrets` (no policies: service role only), and starts a time-boxed run (100 s by default).
- Stages run in order: users, clients, contacts, projects, tasks, task assignments, invoices (with lines),
  estimates, expenses, time entries. Each page is 2,000 records; it follows Harvest's `links.next` and only
  if that link is on Harvest's own host.
- Every row upserts on `(workspace_id, source_id)`. After each page, counts and the next URL are saved together.
  When the time box ends, the function calls itself to continue; if a run dies, pg_cron resumes it after the
  lease expires (checked every minute).
- 429: waits for `Retry-After`. 5xx and network errors: exponential backoff. 401 or other 4xx: fails at once.
  403 on a record type: skipped and shown on the progress screen (non-admin tokens). Five failed runs: fails.
- The token is deleted on success or permanent failure. It is never logged or returned.
