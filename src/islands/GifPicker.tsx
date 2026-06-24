import { useEffect, useState } from 'react'

const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY ?? ''
/** GIF feature is available only when a (free) Giphy API key is configured. */
export const gifEnabled = Boolean(GIPHY_KEY)

interface GiphyImage {
  url?: string
}
interface GiphyResult {
  id: string
  images?: Record<string, GiphyImage>
}

interface GifItem {
  id: string
  preview: string
  gif: string
}

/** Giphy GIF search/picker. Selecting a GIF sends its URL as a chat message. */
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
        const base = q
          ? `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(q)}`
          : 'https://api.giphy.com/v1/gifs/trending?'
        const url = `${base}&api_key=${GIPHY_KEY}&limit=24&rating=g`
        const res = await fetch(url)
        const data = (await res.json()) as { data?: GiphyResult[] }
        if (cancelled) return
        const mapped = (data.data ?? [])
          .map((g) => ({
            id: g.id,
            preview: g.images?.fixed_width_small?.url ?? g.images?.preview_gif?.url ?? '',
            gif: g.images?.downsized?.url ?? g.images?.original?.url ?? '',
          }))
          .filter((g) => g.preview && g.gif)
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
    <div className="w-full">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search GIFs"
        aria-label="Search GIFs"
        autoFocus
        className="h-9 w-full rounded-field bg-sunken px-3 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
      />
      <div className="mt-2 grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto no-scrollbar">
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
      <p className="mt-1.5 text-center text-[10px] text-ink-subtle">Powered by GIPHY</p>
    </div>
  )
}
