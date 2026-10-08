/**
 * Download blur's MediaPipe assets ourselves, with a stall watchdog, BEFORE the
 * processor is attached to the camera.
 *
 * `@livekit/track-processors` fetches the segmenter's WASM runtime and model from
 * a CDN inside `processor.init`, and LiveKit runs that init while holding the
 * camera track's change lock. Those fetches have no timeout. A download that
 * stalls (a captive portal, a flaky mobile link, a CDN hiccup) never settles, so
 * `setProcessor` never returns: blur sits in "busy" forever, and every later
 * camera change — off, flip, a device switch — queues behind the same lock. The
 * camera is wedged until reload.
 *
 * So the bytes are fetched here first, where a stall CAN be detected: the timer
 * resets on every chunk (a slow link that is still making progress is fine; one
 * that has gone quiet is not) and also covers time-to-first-byte. A stall throws,
 * the hook drops blur to 'none' and reports it, and the camera is never touched.
 *
 * - The model is handed to the processor as a blob URL, so init doesn't fetch it
 *   again at all.
 * - The WASM runtime can only be passed as a base URL (MediaPipe derives the file
 *   names), so its two files are fetched to warm the HTTP cache. MediaPipe loads
 *   them CORS-mode without credentials — the script tag is `crossOrigin =
 *   'anonymous'`, the binary a plain fetch — which is exactly how a default
 *   `fetch` here asks, so the cache entry it finds is the one written here.
 *
 * Residual risk, documented rather than hidden: if the cache entry is evicted
 * between this prefetch and init (or the CDN refuses to cache), init downloads
 * again unguarded. The window is seconds wide; the common stall — the CDN being
 * unreachable from the start — is caught here.
 */

/**
 * Must match the @mediapipe/tasks-vision track-processors bundles: passing the
 * base explicitly replaces the path it would derive from its own dependency, and
 * a runtime from another version won't load. blurAssets.test pins it to the
 * installed package, so an upgrade that moves it fails there, not in a call.
 */
export const TASKS_VISION_VERSION = '0.10.14'
export const TASKS_VISION_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`
export const SEGMENTER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'

/** No byte for this long → the download is declared stalled. */
export const STALL_MS = 20_000

export class AssetStallError extends Error {
  constructor(readonly url: string, readonly stallMs: number) {
    super(`blur asset stalled: no data for ${stallMs}ms (${url})`)
    this.name = 'AssetStallError'
  }
}

type FetchOpts = { stallMs?: number; signal?: AbortSignal; fetchImpl?: typeof fetch }

/**
 * `fetch` → Blob, aborting if no data arrives for `stallMs` (time-to-first-byte
 * included). An outer `signal` cancels it too, and its abort reason is rethrown.
 */
export async function fetchWithStallTimeout(url: string, opts: FetchOpts = {}): Promise<Blob> {
  const { stallMs = STALL_MS, signal, fetchImpl = fetch } = opts
  signal?.throwIfAborted()
  const ctrl = new AbortController()
  let stalled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stalled = true
      ctrl.abort()
    }, stallMs)
  }
  const onOuterAbort = () => ctrl.abort(signal?.reason)
  signal?.addEventListener('abort', onOuterAbort, { once: true })
  arm()
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal })
    if (!res.ok) {
      void res.body?.cancel().catch(() => {})
      throw new Error(`blur asset ${res.status} (${url})`)
    }
    if (!res.body) {
      arm()
      return await res.blob()
    }
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    // A reader doesn't always honour the fetch's signal mid-read (a body that has
    // simply stopped producing), so the stall also cancels the reader directly.
    ctrl.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}), { once: true })
    for (;;) {
      arm()
      const { done, value } = await reader.read()
      if (ctrl.signal.aborted) throw new Error('aborted')
      if (done) break
      chunks.push(value)
    }
    return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' })
  } catch (e) {
    if (stalled) throw new AssetStallError(url, stallMs)
    if (signal?.aborted) throw signal.reason ?? e
    throw e
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuterAbort)
  }
}

// The same probe MediaPipe's FilesetResolver runs to choose between its SIMD and
// non-SIMD builds (a module using one v128 instruction). Copied rather than
// imported: @mediapipe/tasks-vision is track-processors' dependency, not ours.
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
])
async function simdSupported(): Promise<boolean> {
  try {
    await WebAssembly.instantiate(SIMD_PROBE)
    return true
  } catch {
    return false
  }
}

/** The two runtime files FilesetResolver will ask for on this browser. */
export async function wasmFiles(base = TASKS_VISION_BASE): Promise<string[]> {
  const kind = (await simdSupported()) ? 'wasm_internal' : 'wasm_nosimd_internal'
  return [`${base}/vision_${kind}.js`, `${base}/vision_${kind}.wasm`]
}

export type BlurAssetPaths = { tasksVisionFileSet: string; modelAssetPath: string }

// A successful prefetch is kept for the page's life: every rebuild (quality
// change, camera restart) reuses the blob URL instead of downloading again.
let ready: BlurAssetPaths | null = null

/** Test seam: e2e shortens the watchdog so a held download fails in seconds. */
function stallMs(): number {
  const o = (globalThis as { __MN_BLUR_STALL_MS?: unknown }).__MN_BLUR_STALL_MS
  return typeof o === 'number' && o > 0 ? o : STALL_MS
}

/** Fetch (or reuse) blur's assets; rejects with AssetStallError on a stall. */
export async function prepareBlurAssets(signal?: AbortSignal): Promise<BlurAssetPaths> {
  if (ready) return ready
  // One failure stops the sibling downloads too, rather than leaving megabytes
  // of WASM streaming in the background for a blur that has already given up.
  const all = new AbortController()
  const onAbort = () => all.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const opts = { stallMs: stallMs(), signal: all.signal }
  const files = [SEGMENTER_MODEL_URL, ...(await wasmFiles())]
  try {
    const [model] = await Promise.all(
      files.map((u) =>
        fetchWithStallTimeout(u, opts).catch((e) => {
          all.abort(e)
          throw e
        }),
      ),
    )
    ready = { tasksVisionFileSet: TASKS_VISION_BASE, modelAssetPath: URL.createObjectURL(model) }
    return ready
  } finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Unit tests only. */
export function resetBlurAssetsForTest() {
  ready = null
}
