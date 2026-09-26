import { Encryption_Type, type Room } from 'livekit-client'

/**
 * Proof that a data packet on an encrypted call came from someone holding the
 * call's key.
 *
 * lib/useDataTopic's rule is "on an E2EE call, drop a packet that arrived in the
 * clear, or the server could put words in anyone's mouth". It read the clear/
 * encrypted flag livekit-client passes with each packet, and that flag is wrong:
 * the sender builds its EncryptedPacket without `encryptionType`, so the receiver,
 * having decrypted it, reports NONE (livekit-client 2.19–2.22, both ends). Every
 * genuine packet looked forged and was dropped: chat history, pins, edits,
 * message reactions, floating reactions, host controls and ink, on every
 * encrypted call.
 *
 * So the proof is ours instead of the library's: on an encrypted call each packet
 * carries an HMAC over its topic and payload, keyed from the call's passphrase
 * (HKDF, a label of its own so it is never the media key). A receiver accepts a
 * clear-flagged packet only when that tag checks out. The server can still
 * REPLAY a packet it saw, which is no worse than today's chat, but it can't make
 * one up. If livekit ever reports GCM honestly, that is believed as well.
 *
 * Unencrypted calls are untouched: no key, no tag, bytes pass through.
 */

const MAGIC = [0x4d, 0x54, 0x01] // "MT", version 1
const TAG_BYTES = 16
const HEADER = MAGIC.length + TAG_BYTES

/** Keyed by the room's key provider: lib/livekit makes one per call, and the Room
 *  keeps the same object in `options.encryption.keyProvider`. */
const keys = new WeakMap<object, Promise<CryptoKey>>()

function deriveKey(passphrase: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle
    .importKey('raw', enc.encode(passphrase), 'HKDF', false, ['deriveKey'])
    .then((base) =>
      crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('manim data tag v1') },
        base,
        { name: 'HMAC', hash: 'SHA-256', length: 256 },
        false,
        ['sign', 'verify'],
      ),
    )
}

/** Register the passphrase for a call's key provider (lib/livekit, at creation). */
export function setDataTagKey(keyProvider: object, passphrase: string): void {
  keys.set(keyProvider, deriveKey(passphrase))
}

function keyFor(room: Room): Promise<CryptoKey> | null {
  const provider = (room.options as { encryption?: { keyProvider?: object } }).encryption?.keyProvider
  return provider ? (keys.get(provider) ?? null) : null
}

/** Whether this call encrypts its data channel (the link carried a key). */
export function encryptedCall(room: Room): boolean {
  return Boolean((room.options as { encryption?: unknown }).encryption)
}

function signed(topic: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const t = new TextEncoder().encode(topic)
  const out = new Uint8Array(t.length + 1 + payload.length)
  out.set(t, 0)
  out.set(payload, t.length + 1) // a 0 byte between: topic "a" + "bc" ≠ topic "ab" + "c"
  return out
}

/** The bytes to send: the payload, prefixed with its tag on an encrypted call. */
export async function sealData(room: Room, topic: string, payload: Uint8Array): Promise<Uint8Array> {
  const key = keyFor(room)
  if (!key) return payload
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key, signed(topic, payload)))
  const out = new Uint8Array(HEADER + payload.length)
  out.set(MAGIC, 0)
  out.set(mac.subarray(0, TAG_BYTES), MAGIC.length)
  out.set(payload, HEADER)
  return out
}

function hasHeader(bytes: Uint8Array): boolean {
  return bytes.length >= HEADER && MAGIC.every((b, i) => bytes[i] === b)
}

async function tagMatches(key: CryptoKey, topic: string, bytes: Uint8Array): Promise<boolean> {
  const want = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, signed(topic, bytes.subarray(HEADER))),
  ).subarray(0, TAG_BYTES)
  // Constant-time-ish compare; the tag is short and this isn't a hot secret path.
  let diff = 0
  for (let i = 0; i < TAG_BYTES; i++) diff |= want[i] ^ bytes[MAGIC.length + i]
  return diff === 0
}

/**
 * The payload to hand the app, or null to drop the packet.
 *  - Unencrypted call: as received.
 *  - No sender (the server's own control messages): as received.
 *  - Encrypted call: a valid tag, or an honest GCM flag from livekit.
 */
export async function openData(
  room: Room,
  topic: string,
  bytes: Uint8Array,
  fromParticipant: boolean,
  encryptionType?: Encryption_Type,
): Promise<Uint8Array | null> {
  if (!encryptedCall(room) || !fromParticipant) return hasHeader(bytes) ? bytes.subarray(HEADER) : bytes
  const key = keyFor(room)
  if (hasHeader(bytes) && key && (await tagMatches(await key, topic, bytes))) return bytes.subarray(HEADER)
  if (encryptionType !== undefined && encryptionType !== Encryption_Type.NONE) {
    return hasHeader(bytes) ? bytes.subarray(HEADER) : bytes
  }
  return null
}
