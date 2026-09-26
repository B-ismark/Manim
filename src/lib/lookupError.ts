/**
 * What to say when the find-by-email lookup fails. The server throttles it
 * (DEPLOY.md §3.1: 30 per 10 minutes per account, so nobody can check a list of
 * addresses against Manim); that one case is the user's to wait out, not an error.
 */
export function lookupError(error: { message?: string } | null | undefined): string {
  return error?.message?.includes('rate_limited')
    ? 'Too many lookups — try again in a few minutes.'
    : 'Could not look up that user.'
}
