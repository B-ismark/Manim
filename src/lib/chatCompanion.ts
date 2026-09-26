import { useEffect, useState } from 'react'
import { useChromeHidden, useRail, useSafeAreaTop } from '@/lib/chromeBands'
import { useIsTouch } from '@/lib/useIsTouch'
import { useKeyboardInset } from '@/lib/keyboardInset'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useRoomStore } from '@/store/useRoomStore'

/**
 * The call, kept in view while a phone has chat (or People) open.
 *
 * A bottom sheet over a dimmed stage made chatting and watching an either/or: at
 * 70% of the screen the sheet covered everyone, and the scrim darkened what was
 * left. Meet and WhatsApp keep the people you're talking to on screen, and so
 * does this — the panel takes the room the conversation needs and the stage turns
 * into a companion view in the room that's left:
 *
 * - `top` (upright): the sheet takes the bottom HALF, and the top half shows whoever
 *   is talking, in their true shape (a tall phone camera stands with the next two
 *   people beside it; a wide laptop camera fills the width). It used to be a 180px
 *   row of thumbnails over a sheet that took the rest, and the owner's note was
 *   that chat "takes too much vertical space": a chat is glanced at between
 *   sentences, the call is what you're in. When the keyboard is up the sheet keeps
 *   its room for typing and the speaker shrinks above it, down to a floor, and
 *   only then gives way.
 * - `side` (a phone on its side): the panel runs full height down the right, the
 *   same width for Chat, People and More so it never jumps, and the stage shows
 *   whoever is talking in the space on the left.
 *
 * In both, the controls step aside (there's no room for the bar under a sheet or
 * the rail beside a panel), and the Muted pill carries your mic state instead.
 * Tablets keep the docked panel they already had: this is for the phone, where
 * the screen can't hold a panel AND a stage.
 *
 * The geometry lives here so the stage and the sheet read ONE answer; two
 * components working out "where does the sheet start" separately would disagree
 * by a pixel on the first odd phone.
 */
/** Upright, the sheet starts this far down the screen. */
export const SHEET_TOP_FRACTION = 0.5
/** Space between the speaker and the sheet, and the speaker's inset. */
export const STAGE_GAP = 8
/** Chat needs at least this much above the keyboard to be usable. */
const MIN_CHAT_H = 300
/** Below this, a speaker tile is too small to be worth the room. */
const MIN_STAGE_H = 140

export type CompanionLayout =
  | { mode: 'none' }
  | { mode: 'top'; stageTop: number; stageH: number; sheetTop: number; stageShown: boolean }
  | { mode: 'side'; panelW: number }

function useViewport(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [vp, setVp] = useState(read)
  useEffect(() => {
    const on = () => setVp(read())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return vp
}

/** The side panel's width on a phone held sideways: a little over half the screen
 *  (Chat needs a readable line; the speaker needs the rest). */
export function sidePanelWidth(viewportW: number): number {
  return Math.round(Math.min(480, Math.max(320, viewportW * 0.55)))
}

export function useChatCompanion(): CompanionLayout {
  const touch = useIsTouch()
  const open = useRoomStore((s) => s.panel !== null)
  const more = useRoomStore((s) => s.moreOpen)
  const rail = useRail()
  const tablet = useMediaQuery('(min-width: 768px)')
  const safeTop = useSafeAreaTop()
  const rows = useChromeHidden((s) => s.topRowsH)
  const kb = useKeyboardInset()
  const { w, h } = useViewport()

  if (!touch) return { mode: 'none' }
  // Sideways, More gets the same panel as chat, so the call on the left looks the
  // same whichever is open. Upright it stays a bottom sheet: it's a short visit.
  if (rail && (open || more)) return { mode: 'side', panelW: sidePanelWidth(w) }
  if (!open || rail || tablet) return { mode: 'none' }
  // Whatever TopStack still shows (a Muted pill, a reconnect banner) keeps its row;
  // the speaker starts under it.
  const stageTop = rows > 0 ? Math.max(16, safeTop) + rows + STAGE_GAP : Math.max(12, safeTop)
  // Half the screen, or less when the keyboard needs the room for chat.
  const sheetTop = Math.min(Math.round(h * SHEET_TOP_FRACTION), h - kb - MIN_CHAT_H)
  const stageH = sheetTop - stageTop - STAGE_GAP
  const stageShown = stageH >= MIN_STAGE_H
  return { mode: 'top', stageTop, stageH, sheetTop: stageShown ? sheetTop : stageTop, stageShown }
}
