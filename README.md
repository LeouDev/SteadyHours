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

Load test (100,000 time entries, 2,000 invoices, 200 projects; the fake server enforces Harvest's
100 requests per 15 s and writes the true totals for reconciliation):

```bash
TRUTH_FILE=/tmp/truth.json FAKE_HARVEST_BASE=http://host.docker.internal:54399/v2 node --experimental-strip-types scripts/fake-harvest-load.ts
```

```bash
TRUTH_FILE=/tmp/truth.json node --experimental-strip-types scripts/load-test.ts
```

## Deploying

1. `supabase link --project-ref <ref>` then `supabase db push`.
2. `supabase secrets set IMPORT_TOKEN_KEY=... HARVEST_CONTACT=... IMPORT_INTERNAL_SECRET=<64 random hex chars>`, then
   `supabase functions deploy harvest-import`.
3. In the SQL editor, give pg_cron what it needs to resume stalled imports:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<service role key>', 'import_cron_key');
   select vault.create_secret('<same value as IMPORT_INTERNAL_SECRET>', 'import_internal_secret');
   ```
4. Auth (Authentication → URL Configuration): Site URL = the front end's URL; Redirect URLs = `<that URL>/**`.
   Email confirmation stays on. Supabase's built-in email only reaches your own team at about 2 emails an
   hour, so real sign-ups need custom SMTP (Authentication → SMTP Settings).
5. Front end on Vercel, built locally so no source or `.env` file is uploaded:
   `vercel pull --environment=production`, `vercel build --prod`, `vercel deploy --prebuilt --prod`.
   The project needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (public values) and `vercel.json`
   sends every app path to `index.html`.

### Import settings (function secrets)

| Secret | Default | Purpose |
|---|---|---|
| `IMPORT_TOKEN_KEY` | (required) | AES key for the Harvest token while an import runs |
| `HARVEST_CONTACT` | (required) | URL or email in the User-Agent Harvest requires |
| `IMPORT_INTERNAL_SECRET` | (required) | Shared with Vault `import_internal_secret`; proves a call came from the function or pg_cron |
| `IMPORT_RECORDS_PER_RUN` | 10000 | Records one run processes before handing off; keeps a run inside the 2 s CPU limit |
| `IMPORT_BUDGET_MS` | 100000 | Wall-clock limit per run |
| `HARVEST_PAGE_SIZE` | 2000 | Testing only: smaller pages force more hand-offs |
| `IMPORT_SELF_CHAIN` | on | Testing only: `off` leaves every continuation to pg_cron |

## Launch gate

`node scripts/gate.mjs` prints sign-ups, imports started, completed and failed, and record counts per
workspace from the hosted database. It reads `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` from `.env`.
The same numbers are in the views `internal.gate_summary` and `internal.gate_workspaces` (SQL editor only;
app users cannot read them). They hold counts, never names, emails or workspace contents.

## CI

`.github/workflows/test.yml` starts a local Supabase stack and runs `npm test` and `npm run build` on every push.

## How the import works

- The function checks the token with `GET /v2/users/me`, encrypts it (AES-256-GCM, `IMPORT_TOKEN_KEY`) into
  `import_secrets` (no policies: service role only), and starts a time-boxed run (100 s by default).
- Stages run in order: users, clients, contacts, projects, tasks, task assignments, invoices (with lines),
  estimates, expenses, time entries. Each page is 2,000 records; it follows Harvest's `links.next` and only
  if that link is on Harvest's own host.
- First it reads `GET /v2/company` and makes the account's currency the workspace default.
- Every row upserts on `(workspace_id, source_id)`. After each page, counts and the next URL are saved together.
  After 10,000 records (or the wall-clock budget) a run hands off to a fresh invocation; each run renews a
  2-minute lease, and if a run dies pg_cron resumes the import once the lease lapses (checked every minute).
- 429: waits for `Retry-After`. 5xx and network errors: exponential backoff. 401: "token not accepted".
  404 on `users/me`: "no account with that ID". 403 on a record type: skipped, shown on Import and Reconcile.
  Five failed runs in a row: stops. Messages people see are plain; technical detail goes to the function log only.
- The token is deleted on success or permanent failure. It is never logged or returned.
