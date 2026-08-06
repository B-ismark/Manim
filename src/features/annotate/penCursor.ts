/**
 * The cursor shown while the annotation pen is armed.
 *
 * `cursor: crosshair` was the wrong shape for this in two ways.
 *
 * The reported one: a screen capture bakes the OS pointer into the frame, so a
 * presenter watching their own capture saw the crosshair twice — once under their
 * hand, once inside the video a round-trip behind it. Not showing the share back to
 * yourself is the only lever that actually removes that; a `cursor: 'never'` capture
 * constraint was tried and does NOT (Chrome accepts it and captures the pointer
 * anyway — see the note in AnnotationOverlay).
 *
 * The quieter one: a crosshair says "precision", not "you are holding a pen". Nothing
 * on screen distinguished armed from disarmed except the button's own state, so the
 * only way to find out whether you were about to draw was to draw. A nib in the
 * author's own palette colour answers both — which mode, and whose ink.
 *
 * Drawn as an inline SVG data URI rather than an asset so it inherits the resolved
 * palette token at call time (themes and the vision-assistive presets rewrite those
 * live), with the hotspot at the nib tip where the ink actually starts.
 */

/** Hotspot in the 24x24 artwork — the nib tip, bottom-left. */
const HOTSPOT_X = 3
const HOTSPOT_Y = 21

/**
 * A pen cursor in `color`, as a CSS `cursor` value.
 *
 * Falls back to `crosshair` in the value itself: a data-URI cursor that a browser
 * refuses (size limits, or an unresolved colour) would otherwise leave the default
 * arrow, which is the one shape that must never mean "armed".
 */
export function penCursor(color: string): string {
  // A white outline under the coloured nib keeps it visible over both a dark
  // screenshot and a light one — the same halo trick the strokes themselves use.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
<path d="M3 21l1.5-4.5L16 5a2.1 2.1 0 0 1 3 3L7.5 19.5 3 21z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>
<path d="M3 21l1.5-4.5L7.5 19.5 3 21z" fill="#fff"/>
</svg>`
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  return `url("${uri}") ${HOTSPOT_X} ${HOTSPOT_Y}, crosshair`
}
