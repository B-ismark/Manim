import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeftIcon } from '@/components/icons'
import {
  APP_NAME,
  CONTACT_EMAIL,
  DATA_COLLECTED,
  LAST_UPDATED,
  SUBPROCESSORS,
} from '@/lib/legal'

/**
 * Static legal/disclosure pages (privacy + terms). Secondary surfaces, so unlike
 * the landing/prejoin/in-call screens they're allowed to scroll. The copy is an
 * honest description of what the app actually does — see src/lib/legal.ts.
 */
function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  // These pages are linked-to directly (footer / sign-in); start at the top.
  useEffect(() => window.scrollTo(0, 0), [])
  return (
    <main className="min-h-dvh overflow-y-auto bg-stage px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          to="/"
          className="-ml-1 mb-6 inline-flex items-center gap-1 rounded-field py-1 pr-2 text-sm text-ink-muted hover:text-ink [&_svg]:size-4"
        >
          <ChevronLeftIcon />
          Back to {APP_NAME}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-subtle">Last updated {LAST_UPDATED}</p>
        <div className="mt-8 flex flex-col gap-8">{children}</div>
      </div>
    </main>
  )
}

function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 text-base font-semibold">{children}</h2>
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink-muted">{children}</p>
}

function MailLink() {
  return (
    <a
      href={`mailto:${CONTACT_EMAIL}`}
      className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover"
    >
      {CONTACT_EMAIL}
    </a>
  )
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <section>
        <P>
          {APP_NAME} is a browser-based video-calling app. This policy explains what we
          collect, why, who processes it, and how to have it deleted. We've kept it to what
          the app actually does — there's intentionally not much.
        </P>
      </section>

      <section>
        <Heading>What we collect, and why</Heading>
        <div className="mt-3 overflow-hidden rounded-tile border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-sunken text-xs uppercase tracking-wide text-ink-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Data</th>
                <th scope="col" className="px-3 py-2 font-medium">Where</th>
                <th scope="col" className="px-3 py-2 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {DATA_COLLECTED.map((row) => (
                <tr key={row.what} className="align-top">
                  <td className="px-3 py-2.5 font-medium">{row.what}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{row.where}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <Heading>What we don't do</Heading>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-muted">
          <li>
            <span className="text-ink">We don't record your calls.</span> Audio and video are
            transported live between participants and are not stored anywhere by {APP_NAME}.
          </li>
          <li>
            Calls can be <span className="text-ink">end-to-end encrypted</span> — when you start a
            new meeting, the encryption key lives only in the invite link, never on our servers.
          </li>
          <li>Push notifications carry no message content — only "someone is calling".</li>
          <li>We don't use tracking or advertising cookies, and we don't sell your data.</li>
        </ul>
      </section>

      <section>
        <Heading>Local storage (no cookie banner)</Heading>
        <P>
          {APP_NAME} stores a few functional preferences in your browser's local storage — your
          display name, a device id for multi-device handoff, and your notification choice. These
          are used only to make the app work, not to track you across sites, so there's no consent
          banner. Clearing your browser storage removes them.
        </P>
      </section>

      <section>
        <Heading>Who processes your data</Heading>
        <P>
          We rely on a small set of service providers (sub-processors) to run {APP_NAME}. Where
          your data is processed depends on these providers' regions:
        </P>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm leading-relaxed text-ink-muted">
          {SUBPROCESSORS.map((s) => (
            <li key={s.name}>
              <span className="font-medium text-ink">{s.name}</span> — {s.purpose}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <Heading>Retention &amp; deletion</Heading>
        <P>
          Account data (profile, contacts, push subscriptions) is kept while your account exists.
          You can delete your account from Settings → Delete account; this removes your profile,
          contacts, and push subscriptions. Call media is never retained, since it isn't recorded.
          To request deletion or ask a privacy question, email <MailLink />.
        </P>
      </section>

      <section>
        <Heading>Calling or inviting someone by email</Heading>
        <P>
          When you enter another person's email to call or invite them, {APP_NAME} uses it to look
          up their account or send them a one-off invitation email. We don't add them to a mailing
          list or store the address against your account.
        </P>
      </section>

      <section>
        <Heading>Contact</Heading>
        <P>
          Questions, deletion requests, or abuse reports: <MailLink />.
        </P>
      </section>
    </LegalPage>
  )
}

export function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <section>
        <P>
          By using {APP_NAME} you agree to these terms. If you don't agree, please don't use the
          service.
        </P>
      </section>

      <section>
        <Heading>Acceptable use</Heading>
        <P>You agree not to use {APP_NAME} to:</P>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-muted">
          <li>harass, threaten, or abuse anyone, or share illegal or infringing content;</li>
          <li>send unsolicited or bulk invitations (spam) to people who haven't asked for them;</li>
          <li>attempt to access rooms, accounts, or data you aren't authorised to;</li>
          <li>disrupt, overload, or probe the service or its infrastructure.</li>
        </ul>
        <P>
          We may suspend or remove access for anyone who breaks these rules. You're responsible for
          the content you transmit and for anyone you invite.
        </P>
      </section>

      <section>
        <Heading>No warranty</Heading>
        <P>
          {APP_NAME} is provided "as is", without warranties of any kind. We don't guarantee the
          service will be uninterrupted, error-free, or that calls will always connect.
        </P>
      </section>

      <section>
        <Heading>Limitation of liability</Heading>
        <P>
          To the maximum extent permitted by law, {APP_NAME} and its operators are not liable for
          any indirect, incidental, or consequential damages arising from your use of the service.
        </P>
      </section>

      <section>
        <Heading>Changes</Heading>
        <P>
          We may update these terms or discontinue the service. Continued use after a change means
          you accept the updated terms.
        </P>
      </section>

      <section>
        <Heading>Contact</Heading>
        <P>
          Questions about these terms: <MailLink />.
        </P>
      </section>
    </LegalPage>
  )
}
