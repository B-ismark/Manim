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
    // Another tab holding the old version open: give up rather than hang.
    req.onblocked = () => reject(new Error('device key store blocked'))
  })
}

/** Read the stored pair, or store `fresh` — in ONE transaction, so it can't race itself. */
async function getOrCreate(db: IDBDatabase, fresh: Stored): Promise<Stored> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite')
    const store = t.objectStore(STORE)
    let result: Stored = fresh
    const get = store.get(ID)
    get.onsuccess = () => {
      const have = get.result as Stored | undefined
      if (have?.privateKey && have.publicJwk) result = have
      else store.put(fresh, ID)
    }
    // Resolve on commit, not on the request: a put that fails at commit (quota)
    // must not hand back a key that was never stored.
    t.oncomplete = () => resolve(result)
    t.onerror = t.onabort = () => reject(t.error)
  })
}

/** Serialise first-use creation across tabs where the browser can (Web Locks). */
function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks?.request ? (locks.request('manim-device-key', run) as Promise<T>) : run()
}

let cached: Promise<Stored | null> | null = null

export function getDeviceKey(): Promise<Stored | null> {
  cached ??= (async () => {
    if (typeof indexedDB === 'undefined') return null
    let db: IDBDatabase | undefined
    try {
      // Two tabs on a first sign-in would otherwise each mint a pair, and the
      // one the server holds could differ from the one a tab opens rings with.
      const fresh = await newDeviceKeyPair()
      return await exclusive(async () => {
        db = await open()
        return getOrCreate(db, fresh)
      })
    } catch {
      return null
    } finally {
      // An open connection would block forgetDeviceKey's deleteDatabase.
      db?.close()
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
