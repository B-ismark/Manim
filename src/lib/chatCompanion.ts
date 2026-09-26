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
 * - `strip` (upright): the sheet stops short of the top, and the stage becomes one
 *   row of people above it, `STRIP_H` tall, speaker first, swiped sideways.
 * - `side` (a phone on its side): the panel runs full height down the right, the
 *   same width for Chat and People so it never jumps, and the stage shows whoever
 *   is talking in the space on the left.
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
export const STRIP_H = 180
/** Space between the strip and the sheet, and the strip's inset. */
export const STRIP_GAP = 8
/** Below this much chat under the strip (the keyboard's up), the strip gives way. */
const MIN_CHAT_H = 300

export type CompanionLayout =
  | { mode: 'none' }
  | { mode: 'strip'; stripTop: number; sheetTop: number; stripShown: boolean }
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
  const rail = useRail()
  const tablet = useMediaQuery('(min-width: 768px)')
  const safeTop = useSafeAreaTop()
  const rows = useChromeHidden((s) => s.topRowsH)
  const kb = useKeyboardInset()
  const { w, h } = useViewport()

  if (!touch || !open) return { mode: 'none' }
  if (rail) return { mode: 'side', panelW: sidePanelWidth(w) }
  if (tablet) return { mode: 'none' }
  // Whatever TopStack still shows (a Muted pill, a reconnect banner) keeps its row;
  // the strip starts under it.
  const stripTop = rows > 0 ? Math.max(16, safeTop) + rows + STRIP_GAP : Math.max(12, safeTop)
  const withStrip = stripTop + STRIP_H + STRIP_GAP
  const stripShown = h - kb - withStrip >= MIN_CHAT_H
  return { mode: 'strip', stripTop, sheetTop: stripShown ? withStrip : stripTop, stripShown }
}
