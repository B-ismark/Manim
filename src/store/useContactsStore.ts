import { create } from 'zustand'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/store/useAuthStore'

/**
 * Consent-based contacts. The relationship is one directed row per pair
 * (`requester` → `addressee`) with a status:
 *  - `pending`  : a request awaiting the addressee's agreement.
 *  - `accepted` : a mutual contact (either side can later remove it).
 *
 * From the caller's point of view each row reads as a `direction`:
 *  - `incoming` : someone asked to add YOU — accept or decline.
 *  - `outgoing` : you asked them — awaiting their agreement (can cancel).
 *  - `accepted` : mutual contact.
 *
 * Reads go through the `list_contacts()` SECURITY DEFINER RPC (joins `profiles`,
 * which isn't publicly readable); writes hit the `contacts` table directly under
 * RLS. Requires a signed-in user + the `contacts` migration (see DEPLOY.md).
 */
export type ContactDirection = 'incoming' | 'outgoing' | 'accepted'

export interface ContactRow {
  otherId: string
  email: string | null
  name: string
  direction: ContactDirection
}

interface ContactsState {
  rows: ContactRow[]
  loading: boolean
  error: string | null
  /** Pull the latest contacts + requests for the signed-in user. */
  refresh: () => Promise<void>
  /** Add someone by email (sends a request, or accepts their pending one).
   *  Returns an error message, or null on success. */
  addByEmail: (email: string) => Promise<string | null>
  /** Agree to an incoming request. */
  accept: (otherId: string) => Promise<void>
  /** Decline incoming / cancel outgoing / remove a mutual contact — same delete. */
  remove: (otherId: string) => Promise<void>
}

function me(): string | null {
  const { signedIn, userId } = useAuthStore.getState()
  return signedIn ? userId : null
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  rows: [],
  loading: false,
  error: null,

  refresh: async () => {
    const sb = supabase
    if (!sb || !me()) {
      set({ rows: [], error: null })
      return
    }
    set({ loading: true, error: null })
    const { data, error } = await sb.rpc('list_contacts')
    if (error) {
      set({ loading: false, error: 'Could not load contacts.' })
      return
    }
    const rows: ContactRow[] = (data ?? []).map(
      (r: { other_id: string; other_email: string | null; other_name: string | null; direction: ContactDirection }) => ({
        otherId: r.other_id,
        email: r.other_email,
        name: r.other_name?.trim() || r.other_email?.split('@')[0] || 'Contact',
        direction: r.direction,
      }),
    )
    set({ rows, loading: false })
  },

  addByEmail: async (email) => {
    const sb = supabase
    const myId = me()
    if (!sb || !myId) return 'Sign in to add contacts.'
    const clean = email.trim().toLowerCase()
    if (!clean) return 'Enter an email.'

    const { data: id, error: lookupErr } = await sb.rpc('lookup_profile_id', { lookup_email: clean })
    if (lookupErr) return 'Could not look up that user.'
    if (!id) return 'No Manim account with that email.'
    const otherId = id as string
    if (otherId === myId) return "That's you."

    // If they already asked you, agreeing is just accepting their request.
    const existing = get().rows.find((r) => r.otherId === otherId)
    if (existing?.direction === 'accepted') return 'Already in your contacts.'
    if (existing?.direction === 'outgoing') return 'Request already sent.'
    if (existing?.direction === 'incoming') {
      await get().accept(otherId)
      return null
    }

    const { error } = await sb.from('contacts').insert({ requester: myId, addressee: otherId })
    if (error) return 'Could not send the request.'
    await get().refresh()
    return null
  },

  accept: async (otherId) => {
    const sb = supabase
    const myId = me()
    if (!sb || !myId) return
    // Only the addressee may flip pending→accepted (enforced by RLS too).
    await sb
      .from('contacts')
      .update({ status: 'accepted', updated_at: new Date().toISOString() })
      .match({ requester: otherId, addressee: myId, status: 'pending' })
    await get().refresh()
  },

  remove: async (otherId) => {
    const sb = supabase
    const myId = me()
    if (!sb || !myId) return
    // Delete the relationship from whichever side holds it (RLS lets either party).
    await sb
      .from('contacts')
      .delete()
      .or(
        `and(requester.eq.${myId},addressee.eq.${otherId}),and(requester.eq.${otherId},addressee.eq.${myId})`,
      )
    await get().refresh()
  },
}))
