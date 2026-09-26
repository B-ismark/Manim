/**
 * Keeps the browser's own media UI off our live feeds.
 *
 * Every feed in the app is a bare `<video>` (the prejoin preview, stage tiles,
 * the mini player, the effects preview), and a bare `<video>` brings the
 * browser's context menu with it: "Show controls" paints a scrubber and a
 * play/pause over a live call, "Loop" and playback speed are meaningless on a
 * MediaStream, and the menu's "Picture in picture" skips the app's own PiP path
 * — which picks a REMOTE feed precisely because PiP shows raw, unmirrored frames,
 * so the menu hands you your own face flipped. None of it is ours to offer.
 *
 * Installed once at the document (capture phase) rather than per element, so a
 * video added later — including the ones `@livekit/components-react` renders —
 * can't forget to opt in. The CSS half lives in app.css (`video` in @layer base):
 * it hides native controls even if a browser shows them some other way, and stops
 * the feed being dragged out or long-press-saved on touch.
 */
export function isMediaTarget(target: EventTarget | null): boolean {
  // `closest` also covers a click on something laid INSIDE a <video> box by
  // the browser (the shadow controls), which retargets to the element itself.
  return (
    typeof (target as Element | null)?.closest === 'function' &&
    (target as Element).closest('video') !== null
  )
}

export function installMediaGuards(doc: Document = document): () => void {
  const block = (e: Event) => {
    if (isMediaTarget(e.target)) e.preventDefault()
  }
  doc.addEventListener('contextmenu', block, true)
  doc.addEventListener('dragstart', block, true)
  return () => {
    doc.removeEventListener('contextmenu', block, true)
    doc.removeEventListener('dragstart', block, true)
  }
}

/**
 * Turn off the browser's own picture-in-picture button on every feed. Firefox
 * paints one on hover over any playing `<video>`, and like the menu's "Picture in
 * picture" it skips the app's mini player (which picks a remote feed on purpose).
 * The app's own fallback clears the flag on the one video it opens
 * (ControlBar's mini player). Watches for videos added later, which is all of them.
 */
export function hideNativePip(doc: Document = document): () => void {
  const mark = (root: ParentNode) => {
    for (const v of root.querySelectorAll('video')) v.disablePictureInPicture = true
  }
  mark(doc)
  const obs = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n instanceof HTMLVideoElement) n.disablePictureInPicture = true
        else if (n instanceof Element) mark(n)
      }
    }
  })
  obs.observe(doc.documentElement, { childList: true, subtree: true })
  return () => obs.disconnect()
}
