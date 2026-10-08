import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AssetStallError,
  fetchWithStallTimeout,
  prepareBlurAssets,
  resetBlurAssetsForTest,
  SEGMENTER_MODEL_URL,
  TASKS_VISION_BASE,
  TASKS_VISION_VERSION,
  wasmFiles,
} from './blurAssets'

/**
 * A fake fetch whose body is driven by hand: `push` delivers a chunk, `end`
 * finishes it. Until then the read just waits — exactly what a stalled CDN does.
 * It honours the request's abort signal the way a real fetch does.
 */
function manualFetch() {
  let ctl!: ReadableStreamDefaultController<Uint8Array>
  let respond!: () => void
  const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      respond = () => {
        const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctl = c) })
        resolve(new Response(body, { status: 200 }))
      }
    })
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
  return {
    fetchImpl,
    respond: () => respond(),
    push: (n: number) => ctl.enqueue(new Uint8Array(n)),
    end: () => ctl.close(),
  }
}

describe('fetchWithStallTimeout', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('gives up when no first byte arrives in time', async () => {
    const f = manualFetch()
    const p = fetchWithStallTimeout('https://x/a', { stallMs: 1000, fetchImpl: f.fetchImpl })
    const caught = p.catch((e) => e)
    await vi.advanceTimersByTimeAsync(1001)
    expect(await caught).toBeInstanceOf(AssetStallError)
  })

  it('keeps going while chunks keep arriving, and resolves with every byte', async () => {
    const f = manualFetch()
    const p = fetchWithStallTimeout('https://x/a', { stallMs: 1000, fetchImpl: f.fetchImpl })
    f.respond()
    // Three chunks 900ms apart — 2.7s in total, longer than the window, but the
    // timer restarts on each one, so a slow-but-alive link is never cut off.
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(900)
      f.push(10)
    }
    f.end()
    const blob = await p
    expect(blob.size).toBe(30)
  })

  it('gives up when a body goes quiet midway', async () => {
    const f = manualFetch()
    const p = fetchWithStallTimeout('https://x/a', { stallMs: 1000, fetchImpl: f.fetchImpl })
    const caught = p.catch((e) => e)
    f.respond()
    await vi.advanceTimersByTimeAsync(500)
    f.push(10)
    await vi.advanceTimersByTimeAsync(1001)
    const e = await caught
    expect(e).toBeInstanceOf(AssetStallError)
    expect((e as AssetStallError).url).toBe('https://x/a')
  })

  it('rethrows the caller’s abort reason, not a stall', async () => {
    const f = manualFetch()
    const ctrl = new AbortController()
    const reason = new Error('superseded')
    const p = fetchWithStallTimeout('https://x/a', { stallMs: 1000, signal: ctrl.signal, fetchImpl: f.fetchImpl })
    const caught = p.catch((e) => e)
    ctrl.abort(reason)
    expect(await caught).toBe(reason)
  })

  it('rejects a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('no', { status: 404 })) as unknown as typeof fetch
    await expect(fetchWithStallTimeout('https://x/a', { fetchImpl })).rejects.toThrow(/404/)
  })
})

describe('prepareBlurAssets', () => {
  afterEach(() => {
    resetBlurAssetsForTest()
    vi.unstubAllGlobals()
  })

  it('fetches the model and both runtime files, then reuses the result', async () => {
    const seen: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url)
        return new Response(new Uint8Array(4), { status: 200 })
      }),
    )
    const a = await prepareBlurAssets()
    expect(a.tasksVisionFileSet).toBe(TASKS_VISION_BASE)
    expect(a.modelAssetPath).toMatch(/^blob:/)
    expect(seen.sort()).toEqual([SEGMENTER_MODEL_URL, ...(await wasmFiles())].sort())
    // A rebuild (quality change, camera restart) downloads nothing.
    expect(await prepareBlurAssets()).toBe(a)
    expect(seen).toHaveLength(3)
  })

  it('does not remember a failure', async () => {
    let fail = true
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => (fail ? new Response('', { status: 503 }) : new Response(new Uint8Array(1)))),
    )
    await expect(prepareBlurAssets()).rejects.toThrow(/503/)
    fail = false
    await expect(prepareBlurAssets()).resolves.toBeTruthy()
  })

  it('asks for the runtime build FilesetResolver will pick', async () => {
    const [js, wasm] = await wasmFiles('B')
    // Node supports WASM SIMD, so this is the SIMD build; the probe is MediaPipe's own.
    expect(js).toBe('B/vision_wasm_internal.js')
    expect(wasm).toBe('B/vision_wasm_internal.wasm')
  })
})

describe('TASKS_VISION_VERSION', () => {
  it('matches the @mediapipe/tasks-vision track-processors actually bundles', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8'),
    ) as { version: string }
    expect(TASKS_VISION_VERSION).toBe(pkg.version)
  })
})
