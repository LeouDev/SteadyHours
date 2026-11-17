// Plain-language pages drafted from what the code actually does. Items marked "Lawyer to check"
// need legal review before launch; nothing here has been reviewed by a lawyer yet.
import { Link } from 'react-router'
import { OPERATOR, PRODUCT_NAME } from '../../supabase/functions/_shared/config.ts'

const UPDATED = '17 November 2026'

export function Footer() {
  return (
    <footer className="border-t border-line bg-paper">
      <nav aria-label="Legal" className="mx-auto flex max-w-[1120px] flex-wrap items-center gap-x-6 gap-y-1 px-5 py-5 text-sm text-muted sm:px-8">
        <Link to="/your-harvest-data" className="inline-flex min-h-11 items-center hover:text-ink">How we handle your Harvest token and data</Link>
        <Link to="/privacy" className="inline-flex min-h-11 items-center hover:text-ink">Privacy policy</Link>
        <Link to="/terms" className="inline-flex min-h-11 items-center hover:text-ink">Terms</Link>
        <span className="inline-flex min-h-11 items-center sm:ml-auto">{PRODUCT_NAME} is not affiliated with Harvest.</span>
      </nav>
    </footer>
  )
}

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto max-w-3xl px-5 py-5 sm:px-6">
        <Link to="/" className="display inline-flex min-h-11 items-center text-2xl" style={{ letterSpacing: '-0.02em' }}>{PRODUCT_NAME}</Link>
      </header>
      <main className="page-fade mx-auto max-w-3xl px-5 pb-16 sm:px-6">
        <span className="eyebrow">Last updated {UPDATED} · draft, not yet reviewed by a lawyer</span>
        <h1 className="display mt-3 text-[40px] sm:text-[48px]">{title}</h1>
        <div className="card mt-8 space-y-4 p-6 text-[15px] leading-relaxed sm:p-8">{children}</div>
      </main>
      <Footer />
    </div>
  )
}

/** Marks a statement that needs legal review before launch. */
function Check({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn"><strong>Lawyer to check:</strong> {children}</p>
}

const H = ({ children }: { children: React.ReactNode }) => <h2 className="display pt-4 text-2xl" style={{ letterSpacing: '-0.02em' }}>{children}</h2>
const Who = () => (
  <p>
    {PRODUCT_NAME} is run by {OPERATOR.name}, based in {OPERATOR.country}. Contact: {OPERATOR.email}.
  </p>
)

export function HarvestData() {
  return (
    <Page title="How we handle your Harvest token and data">
      <p>This page describes exactly what the importer does with your Harvest personal access token and the data it reads.</p>

      <H>Your token</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>You paste the token on the Import screen. It travels over HTTPS to our import service, which first checks it with one request to Harvest.</li>
        <li>It is then encrypted with AES-256-GCM, using a key kept as a server secret, and stored in a table that no user account can read.</li>
        <li>It is used only to <em>read</em> from Harvest’s API (api.harvestapp.com). The importer never creates, changes or deletes anything in Harvest, and only follows page links that point back to Harvest.</li>
        <li>It is deleted as soon as the import finishes. It is also deleted if the import stops for good: when Harvest rejects the token, after five failed attempts in a row, or when you delete your workspace. While an import is retrying after a temporary error, the encrypted token is kept until the retry succeeds or the import stops.</li>
        <li>It is never written to logs, never shown back to you, and never sent anywhere except Harvest.</li>
        <li>You can revoke the token in Harvest at any time; we suggest doing so once your import is complete.</li>
      </ul>

      <H>What we import</H>
      <p>
        Clients and their contacts, projects and tasks with rates, people, time entries, expenses, invoices with line
        items, taxes and discounts, and estimate totals. We do not import recurring invoice schedules, retainers,
        individual payment records, estimate line items, or start and end clock times.
      </p>

      <H>Where it is kept and who can see it</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>Imported data is stored in a Supabase Postgres database in Singapore (AWS ap-southeast-1).</li>
        <li>Inside {PRODUCT_NAME}, only people with a login in your workspace can read it. The database enforces this for every table.</li>
        <li>
          The operator can access the database to run and repair the service. We look at a workspace’s contents only to
          fix a problem you report, or when the law requires it. Our own usage figures are counts only (sign-ups,
          imports, numbers of records per workspace), never the contents.
        </li>
      </ul>
      <Check>Confirm the operator-access statement matches how you will actually run support, and whether the region needs to be disclosed as an international transfer for your users.</Check>

      <H>Keeping and deleting it</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>Your data stays until you delete your workspace. You can export all of it as CSV or JSON at any time, on the free plan too.</li>
        <li>“Delete this workspace” (Export page, owners only) removes the workspace, everything imported, any import in progress with its token, and your login, in one step. It cannot be undone.</li>
        <li>Copies can remain in the database provider’s backups until those backups expire.</li>
      </ul>
      <Check>State the backup retention period for the Supabase plan in use, and how deletion requests sent by email are handled and how fast.</Check>
      <Who />
    </Page>
  )
}

export function Privacy() {
  return (
    <Page title="Privacy policy">
      <Who />
      <Check>Name the legal entity and its registration details, and confirm which laws apply (for example the Philippine Data Privacy Act, the EU/UK GDPR for users there, US state laws). Decide whether a data protection officer must be named.</Check>

      <H>What we collect</H>
      <ul className="list-disc space-y-2 pl-6">
        <li><strong>Your account:</strong> your email address and a password (stored only as a hash by our authentication provider), plus sign-in records such as times and IP addresses.</li>
        <li><strong>Your Harvest data:</strong> the records you choose to import, which can include your clients’ and colleagues’ names and email addresses. See <Link to="/your-harvest-data" className="text-accent underline">how we handle your Harvest token and data</Link>.</li>
        <li><strong>Technical logs:</strong> our hosting and database providers keep request and error logs, which include IP addresses. Import logs record import IDs and error messages, never your token.</li>
      </ul>

      <H>Why we use it</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>To run your account and send the emails it needs: confirming your address, sign-in links and password resets.</li>
        <li>To import, show and export your data when you ask us to.</li>
        <li>To keep the service working and secure, and to count sign-ups and imports.</li>
      </ul>
      <p>We do not sell your data, show ads, or use tracking or analytics tools. The app sets no cookies; it keeps your sign-in session in your browser’s local storage.</p>
      <Check>Set out the legal basis for each purpose (for example contract, legitimate interest) as the applicable laws require.</Check>

      <H>Who processes it for us</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>Supabase: the database and sign-in, in Singapore, and the import service, which runs on Supabase’s edge network and may process data in other regions while an import runs.</li>
        <li>Vercel: hosts the website.</li>
        <li>Harvest: the source you import from, at your request and with your token.</li>
        <li>An email delivery provider for account emails (to be confirmed).</li>
      </ul>
      <Check>List the providers’ legal names and countries, confirm data processing agreements are in place with each, and cover international transfers.</Check>

      <H>How long we keep it</H>
      <p>Until you delete your workspace, which also deletes your login. Provider logs and backups expire on their own schedules.</p>
      <Check>State concrete retention periods for logs and backups, and what happens to inactive free accounts.</Check>

      <H>Your rights</H>
      <p>
        You can export everything at any time and delete your workspace yourself. For any other request, such as access,
        correction or objection, email {OPERATOR.email}.
      </p>
      <Check>List the rights users have under the applicable laws, the response deadline, and how to complain to a regulator (for example the Philippine National Privacy Commission).</Check>

      <H>Changes</H>
      <p>If we change this policy, we will update the date above and tell account holders by email about important changes.</p>
    </Page>
  )
}

export function Terms() {
  return (
    <Page title="Terms">
      <Who />
      <Check>Name the contracting entity, governing law and venue, and confirm these terms are enforceable where your users are.</Check>

      <H>The service</H>
      <p>
        {PRODUCT_NAME} imports data from your Harvest account and gives you a read-only archive with export. The archive
        is free. {PRODUCT_NAME} is not affiliated with or endorsed by Harvest; “Harvest” is a trademark of its owner.
      </p>

      <H>Your account and your data</H>
      <ul className="list-disc space-y-2 pl-6">
        <li>You must be allowed to access the Harvest account you import, and to share its data with us for this purpose.</li>
        <li>Your data stays yours. We use it only to provide the service, as our privacy policy describes.</li>
        <li>Keep your login secure. You are responsible for activity in your account.</li>
      </ul>

      <H>Acceptable use</H>
      <p>Don’t use the service to break the law, to access data you aren’t allowed to, or to interfere with the service or other users.</p>

      <H>Availability and accuracy</H>
      <p>
        We work to import your records exactly and show totals to compare with Harvest’s own reports, but the service is
        provided as it is. Check the reconciliation totals before relying on imported figures.
      </p>
      <Check>Set the warranty disclaimer and the limit of liability; some jurisdictions restrict both, especially for consumers.</Check>

      <H>Ending</H>
      <p>
        You can delete your workspace at any time. We may suspend accounts that break these terms. If we ever stop the
        service, we will give account holders notice and time to export their data.
      </p>
      <Check>Set the notice period for shutting down the service and for changes to these terms.</Check>

      <H>Changes</H>
      <p>We will update the date above when these terms change and email account holders about important changes.</p>
    </Page>
  )
}
