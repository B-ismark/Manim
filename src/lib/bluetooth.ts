/**
 * Best-effort Bluetooth-audio detection from a device label. The Web platform has
 * no API that says "this is Bluetooth" — the label is all we get — so this is a
 * heuristic tuned to how the common headsets name themselves across OSes. It's used
 * to auto-route audio to a headset the moment it connects (useAudioDeviceAutoswitch).
 *
 * Kept deliberately conservative on generic words: "wireless"/"headset" alone are
 * ambiguous (some USB dongles say them), but paired with the brand/transport terms
 * below they're a reliable signal. False positives only mean an auto-switch the user
 * can undo from the audio menu; false negatives just fall back to remembered-device.
 */
const BLUETOOTH_LABEL = new RegExp(
  [
    'bluetooth',
    'air\\s?pods',
    '\\bbeats\\b',
    'galaxy\\s?buds',
    '\\bbuds\\b',
    '\\bjabra\\b',
    '\\bbose\\b',
    'sony\\s?w[fh]', // Sony WF-/WH- series
    'jbl',
    'pixel\\s?buds',
    'hands[-\\s]?free',
    '\\ba2dp\\b',
    '\\bhfp\\b',
    '\\bsco\\b',
    'le\\s?audio',
    'wireless\\s?(head|ear|buds)',
  ].join('|'),
  'i',
)

export function isBluetoothLabel(label: string | undefined | null): boolean {
  return !!label && BLUETOOTH_LABEL.test(label)
}
