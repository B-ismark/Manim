import { useEffect, useState } from 'react'

const TENOR_KEY = import.meta.env.VITE_TENOR_KEY ?? ''
/** GIF feature is available only when a (free) Tenor API key is configured. */
export const gifEnabled = Boolean(TENOR_KEY)

interface TenorResult {
  id: string
  media_formats?: Record<string, { url?: string }>
}

interface GifItem {
  id: string
  preview: string
  gif: string
}

/** Tenor GIF search/picker. Selecting a GIF sends its URL as a chat message. */
export function GifPicker({ onSelect }: { onSelect: (url: string) => void }) {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<GifItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const q = query.trim()
        const endpoint = q
          ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}`
          : 'https://tenor.googleapis.com/v2/featured?'
        const url = `${endpoint}&key=${TENOR_KEY}&client_key=manim&limit=24&media_filter=tinygif,gif`
        const res = await fetch(url)
        const data = (await res.json()) as { results?: TenorResult[] }
        if (cancelled) return
        const mapped = (data.results ?? [])
          .map((r) => ({
            id: r.id,
            preview: r.media_formats?.tinygif?.url ?? '',
            gif: r.media_formats?.gif?.url ?? '',
          }))
          .filter((r) => r.preview && r.gif)
        setItems(mapped)
      } catch {
        if (!cancelled) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    const t = window.setTimeout(run, query ? 350 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [query])

  return (
    <div className="w-72">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search GIFs"
        aria-label="Search GIFs"
        autoFocus
        className="h-9 w-full rounded-field bg-sunken px-3 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
      />
      <div className="mt-2 grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto">
        {items.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => onSelect(g.gif)}
            className="overflow-hidden rounded-field bg-sunken focus-visible:ring-2 focus-visible:ring-accent"
          >
            <img src={g.preview} alt="" loading="lazy" className="h-24 w-full object-cover" />
          </button>
        ))}
        {!loading && items.length === 0 && (
          <p className="col-span-2 py-6 text-center text-xs text-ink-subtle">No GIFs found.</p>
        )}
      </div>
      <p className="mt-1.5 text-center text-[10px] text-ink-subtle">Powered by Tenor</p>
    </div>
  )
}
