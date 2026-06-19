import { Link } from 'react-router-dom'
import { CONTACT_EMAIL } from '@/lib/legal'

/**
 * Minimal landing footer: links to the privacy policy, terms, and an operator
 * contact (the audit's L7 — give users a way to reach the operator). Kept in the
 * normal flow (no auto-margin) so it doesn't override the landing's vertical
 * centering on desktop; it simply follows the card and scrolls with it on mobile.
 */
export function SiteFooter() {
  return (
    <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 pt-8 text-xs text-ink-subtle">
      <Link to="/privacy" className="hover:text-ink">
        Privacy
      </Link>
      <Link to="/terms" className="hover:text-ink">
        Terms
      </Link>
      <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-ink">
        Contact
      </a>
    </footer>
  )
}
