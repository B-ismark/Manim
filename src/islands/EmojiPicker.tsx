import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * Full emoji picker backed by the complete Unicode set (unicode-emoji-json,
 * ~1900 emoji with names + groups). The dataset is **dynamically imported on
 * first open** so it never weighs down the room bundle. Grouped into the
 * standard categories with a name search; the grid scrolls independently.
 */
interface EmojiEntry {
  e: string
  name: string
  group: string
}

// Standard Unicode emoji groups, in their conventional picker order, each with a
// representative glyph for the category tab.
const GROUPS: { group: string; icon: string }[] = [
  { group: 'Smileys & Emotion', icon: '😀' },
  { group: 'People & Body', icon: '👋' },
  { group: 'Animals & Nature', icon: '🐶' },
  { group: 'Food & Drink', icon: '🍔' },
  { group: 'Travel & Places', icon: '✈️' },
  { group: 'Activities', icon: '⚽' },
  { group: 'Objects', icon: '💡' },
  { group: 'Symbols', icon: '❤️' },
  { group: 'Flags', icon: '🏁' },
]

let cache: EmojiEntry[] | null = null
async function loadEmojis(): Promise<EmojiEntry[]> {
  if (cache) return cache
  const mod = (await import('unicode-emoji-json')) as unknown as {
    default?: Record<string, { name: string; group: string }>
  }
  const data = mod.default ?? (mod as unknown as Record<string, { name: string; group: string }>)
  cache = Object.entries(data).map(([e, m]) => ({ e, name: m.name, group: m.group }))
  return cache
}

export function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [emojis, setEmojis] = useState<EmojiEntry[]>(cache ?? [])
  const [active, setActive] = useState(GROUPS[0].group)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let on = true
    void loadEmojis().then((e) => {
      if (on) setEmojis(e)
    })
    return () => {
      on = false
    }
  }, [])

  const byGroup = useMemo(() => {
    const m: Record<string, EmojiEntry[]> = {}
    for (const it of emojis) (m[it.group] ??= []).push(it)
    return m
  }, [emojis])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return emojis.filter((it) => it.name.includes(q)).slice(0, 300)
  }, [query, emojis])

  const groups = GROUPS.filter((g) => byGroup[g.group]?.length)
  const shown = results ?? byGroup[active] ?? []
  const loading = emojis.length === 0

  return (
    // Bounded column: search + tabs are fixed, only the grid scrolls. w-full so it
    // fills a mobile sheet; capped width keeps the desktop popover tidy.
    <div className="flex w-full max-w-[20rem] flex-col gap-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji"
        aria-label="Search emoji"
        className="h-8 shrink-0 rounded-field bg-sunken px-2.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
      />

      {!results && groups.length > 0 && (
        <div className="flex shrink-0 gap-0.5" role="tablist" aria-label="Emoji categories">
          {groups.map((g) => (
            <button
              key={g.group}
              type="button"
              role="tab"
              aria-selected={active === g.group}
              aria-label={g.group}
              title={g.group}
              onClick={() => setActive(g.group)}
              className={cn(
                'grid flex-1 place-items-center rounded-control py-1 text-base',
                active === g.group ? 'bg-accent-soft' : 'hover:bg-sunken',
              )}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}

      <div className="grid h-56 grid-cols-8 content-start gap-0.5 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
        {loading ? (
          <p className="col-span-8 py-6 text-center text-xs text-ink-subtle">Loading emoji…</p>
        ) : shown.length === 0 ? (
          <p className="col-span-8 py-6 text-center text-xs text-ink-subtle">No emoji found</p>
        ) : (
          shown.map((d) => (
            <button
              key={d.e}
              type="button"
              aria-label={d.name}
              title={d.name}
              onClick={() => onSelect(d.e)}
              className="grid aspect-square place-items-center rounded-control text-xl hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
            >
              {d.e}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
