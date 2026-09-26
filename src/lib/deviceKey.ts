import { newDeviceKeyPair } from '@/lib/sealedSecrets'

/**
 * This browser's device keypair for sealed secrets (lib/sealedSecrets).
 *
 * Kept in IndexedDB, which can hold a CryptoKey as-is: the private key is created
 * non-extractable, so not even this page's own code can read its bytes back out,
 * only use it. Null where IndexedDB isn't available (some private modes): the
 * caller then falls back to how things worked before.
 */
const DB = 'manim-keys'
const STORE = 'device'
const ID = 'self'

interface Stored {
  privateKey: CryptoKey
  publicJwk: JsonWebKey
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let cached: Promise<Stored | null> | null = null

export function getDeviceKey(): Promise<Stored | null> {
  cached ??= (async () => {
    if (typeof indexedDB === 'undefined') return null
    try {
      const db = await open()
      const have = (await tx(db, 'readonly', (s) => s.get(ID))) as Stored | undefined
      if (have?.privateKey && have.publicJwk) return have
      const fresh = await newDeviceKeyPair()
      await tx(db, 'readwrite', (s) => s.put(fresh, ID))
      return fresh
    } catch {
      return null
    }
  })()
  const p = cached
  // A failure isn't remembered: the next call tries again.
  void p.then((v) => {
    if (!v && cached === p) cached = null
  })
  return p
}

/** Drop this browser's keypair (sign-out / account deletion, lib/localData). */
export async function forgetDeviceKey(): Promise<void> {
  cached = null
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB)
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
