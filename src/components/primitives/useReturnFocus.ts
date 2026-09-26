import { useCallback, useLayoutEffect, useRef } from 'react'

/**
 * Put focus back where it was when a Dialog or Sheet closes.
 *
 * Radix does this only for its own `Trigger`, and the app never uses one: every
 * dialog is opened from state (a control-bar button, a menu row, a shortcut). So
 * `triggerRef` is empty, Radix prevents its default refocus, and focus fell to
 * `<body>` on every close — a keyboard user was thrown back to the top of the page
 * and a screen reader lost its place.
 *
 * The opener is read in a LAYOUT effect when `open` turns true: layout effects run
 * before Radix's FocusScope moves focus into the content (a passive effect), so
 * `document.activeElement` is still whatever opened it. If that element is gone by
 * the time we close (a menu row that unmounted), `fallback` is used.
 *
 * On a touch screen focus is left alone unless the opener was focused by keyboard
 * (`:focus-visible`): refocusing a text field would raise the keyboard, and the
 * touch chrome must stay free to auto-hide.
 */
export function useReturnFocus(open: boolean, fallback?: { current: HTMLElement | null }) {
  const opener = useRef<HTMLElement | null>(null)
  const byKeyboard = useRef(false)

  useLayoutEffect(() => {
    if (!open) return
    const a = document.activeElement
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null
    try {
      byKeyboard.current = Boolean(opener.current?.matches(':focus-visible'))
    } catch {
      byKeyboard.current = false
    }
  }, [open])

  return useCallback(
    (e: Event) => {
      e.preventDefault()
      const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
      const target = opener.current?.isConnected ? opener.current : (fallback?.current ?? null)
      opener.current = null
      if (!target || (coarse && !byKeyboard.current)) return
      target.focus({ preventScroll: true })
    },
    [fallback],
  )
}

/**
 * Whether an Escape keypress belongs to the control that has focus rather than to
 * the surrounding Dialog or Sheet. Radix listens for Escape on the document in the
 * capture phase, so it hears the key BEFORE the focused control does, and closing
 * the whole chat panel was the answer to "dismiss the @mention list" or "cancel
 * this edit". An open combobox and anything marked `data-own-escape` keep it.
 */
export function ownsEscape(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest('[role="combobox"][aria-expanded="true"], [data-own-escape]'))
  )
}
