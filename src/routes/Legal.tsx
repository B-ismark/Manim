import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeftIcon } from '@/components/icons'
import {
  APP_NAME,
  CONTACT_EMAIL,
  DATA_COLLECTED,
  LAST_UPDATED,
  MIN_AGE,
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

const linkClass = 'font-medium text-accent-text underline underline-offset-2 hover:text-accent-hover'

/** "email <address>", or — while no address is published — "contact us",
 *  pointing at the Contact section that says what to do meanwhile. */
function ContactUs({ start = false }: { start?: boolean }) {
  if (!CONTACT_EMAIL)
    return (
      <a href="#contact" className={linkClass}>
        {start ? 'Contact us' : 'contact us'}
      </a>
    )
  return (
    <>
      {start ? 'Email' : 'email'}{' '}
      <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
        {CONTACT_EMAIL}
      </a>
    </>
  )
}

/** The Contact section's body: the address, or what to do until there is one. */
function ContactBody({ topic }: { topic: string }) {
  if (CONTACT_EMAIL)
    return (
      <>
        {topic}:{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className={linkClass}>
          {CONTACT_EMAIL}
        </a>
        .
      </>
    )
  return (
    <>
      We're setting up a contact address for {topic.toLowerCase()} and will publish it here.
      Meanwhile you can delete your account yourself from Settings → Delete account.
    </>
  )
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <section>
        <P>
          {APP_NAME} is a browser-based video-calling app. This policy explains what we
          collect, why, which services handle it, and how to have it deleted. It describes what
          the app actually does. Signing in is optional: you can join and host calls without an
          account.
        </P>
      </section>

      <section>
        <Heading>What we collect, and why</Heading>
        {/* Stacked, not a table: three columns of honest-length sentences became a
            tall, word-per-line strip at phone width. */}
        <dl className="mt-3 divide-y divide-line overflow-hidden rounded-tile border border-line">
          {DATA_COLLECTED.map((row) => (
            <div key={row.what} className="flex flex-col gap-1 px-3 py-2.5 text-sm leading-relaxed">
              <dt className="font-medium text-ink">{row.what}</dt>
              <dd className="text-ink-muted">
                <span className="text-ink">Where: </span>
                {row.where}
              </dd>
              <dd className="text-ink-muted">
                <span className="text-ink">Why: </span>
                {row.why}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <Heading>What we don't do</Heading>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-ink-muted">
          <li>
            <span className="text-ink">We don't record your calls.</span> Audio and video pass
            live through LiveKit's servers and are not stored anywhere by {APP_NAME}. Other people
            in a call could still record it on their own devices.
          </li>
          <li>
            <span className="text-ink">Audio and video can be end-to-end encrypted.</span> Calls
            you start with New meeting or by calling a contact are. The key is part of the invite
            link, so anyone with the full link can join and see and hear the call: share it only
            with people you mean to invite. The key reaches our providers in three cases. When you
            ring a contact, it goes through Supabase and stays in our database for up to 3 days.
            When your own signed-in devices show which call you're in, it passes through Supabase
            without being stored. When a host merges two calls, it is sent over the call's message
            channel, which LiveKit can read. Email invites leave the key out. Chat, files, drawings
            and reactions are encrypted on their way to LiveKit but not end-to-end, so LiveKit's
            servers can read them. A call opened without a key isn't end-to-end encrypted; the
            padlock in the call shows which applies.
          </li>
          <li>
            Background notifications say only that someone is calling. If {APP_NAME} is open in
            another tab, the notification shows the caller's name and the room.
          </li>
          <li>We don't make automated decisions about you or build profiles.</li>
          <li>We don't use tracking or advertising cookies, and we don't sell your data.</li>
        </ul>
      </section>

      <section>
        <Heading>In a call, others can see</Heading>
        <P>
          Everyone in a call sees your display name (if you signed in by email and never set one,
          that's the part of your email before the @) and a random device id. If you're signed
          in, they also receive your account number, which can be used to view your profile photo.
          They receive your chat messages, files and drawings. If the host uses a waiting room,
          people in the call can see the names of everyone who asked to join. By default, people who join later can also see
          earlier chat messages, because the people still in the call pass them on. A host can turn
          that off from More → Chat history; the chat panel always says which applies. GIFs posted
          in chat load from Giphy or Tenor for everyone in the call.
        </P>
      </section>

      <section>
        <Heading>Local storage (no cookie banner)</Heading>
        <P>
          {APP_NAME} stores what it needs to work in your browser's local storage: your sign-in,
          display name, device and guest ids, your notification choice, your theme, sound, device
          and effect preferences, and your recent rooms with their invite links and saved keys. It
          doesn't use cookies, and nothing is used to track you across sites, so there's no consent
          banner. Signing out removes your sign-in, name, ids, notification subscription, recent
          rooms and saved keys from this browser, and keeps your theme and device preferences. Other tabs that are still open, and your browser's history, keep
          what they already have, so on a shared computer close them and clear the history too.
          Clearing your browser storage removes everything.
        </P>
      </section>

      <section>
        <Heading>Services we use</Heading>
        <P>
          These services handle some of your data so {APP_NAME} can work. Several are based in the
          United States, so your data may be processed outside your country:
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
          Account data (profile, photo, contacts, notification subscriptions) is kept while your
          account exists. You can delete your account from Settings → Delete account. That removes
          your profile, photo, contacts and notification subscriptions straight away, and clears
          your data from that browser. Some copies outlast it for a while: call invitations in our
          database (up to 3 days), our email and crash-report providers' logs (for as long as they
          keep them), and, if you were given early access, your email on our access list until we
          remove it. <ContactUs start /> to have those removed too. Call audio and video are never
          kept, since calls aren't recorded.
        </P>
      </section>

      <section>
        <Heading>Calling or inviting someone by email</Heading>
        <P>
          When you enter another person's email to call or invite them, {APP_NAME} uses it to look
          up their account or send them a one-off invitation email. We don't add them to a mailing
          list or store the address against your account. Resend, which sends the email, keeps a
          delivery record of it, and the email shows your name and the room name.
        </P>
      </section>

      <section>
        <Heading>Children</Heading>
        <P>
          {APP_NAME} is for people aged {MIN_AGE} and over. We don't knowingly collect data from
          anyone younger. If you think a child under {MIN_AGE} has given us their data,{' '}
          <ContactUs /> and we'll delete it.
        </P>
      </section>

      <section>
        <Heading>Your rights</Heading>
        <P>
          You can ask for a copy of the data we hold about you, have it corrected or deleted, ask
          us to stop or limit using it, or take back a choice you made, such as notifications.
          <ContactUs start /> and we'll reply within a month. If you're unhappy with the answer,
          you can complain to your local data protection authority.
        </P>
      </section>

      <section>
        <Heading>Changes to this policy</Heading>
        <P>
          When what {APP_NAME} does with your data changes, we update this page and the date at
          the top.
        </P>
      </section>

      <section id="contact" className="scroll-mt-6">
        <Heading>Contact</Heading>
        <P>
          <ContactBody topic="Questions, deletion requests and abuse reports" /> The Report button
          in a call alerts that call's host only.
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
        <Heading>Who can use {APP_NAME}</Heading>
        <P>You must be {MIN_AGE} or older to use {APP_NAME}.</P>
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
          <ContactBody topic="Questions about these terms" />
        </P>
      </section>
    </LegalPage>
  )
}
