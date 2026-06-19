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

  const activeGroup = results ? null : groups.find((g) => g.group === active) ?? groups[0]

  return (
    // Bounded column: search + tabs are fixed, only the grid scrolls. Fills a
    // mobile sheet; ~22rem on desktop so 8 columns fit with no horizontal scroll.
    <div className="flex w-full flex-col gap-2 sm:w-[22rem]">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji"
        aria-label="Search emoji"
        className="h-9 shrink-0 rounded-field bg-sunken px-2.5 text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent sm:h-8 sm:text-sm"
      />

      {!results && groups.length > 0 && (
        <div className="flex shrink-0 gap-1" role="tablist" aria-label="Emoji categories">
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
                'grid flex-1 place-items-center rounded-control py-1.5 text-lg leading-none',
                active === g.group ? 'bg-accent-soft' : 'hover:bg-sunken',
              )}
            >
              {g.icon}
            </button>
          ))}
        </div>
      )}

      {/* Section label so you know where you are while scrolling. */}
      <p className="shrink-0 px-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
        {results ? 'Search results' : activeGroup?.group}
      </p>

      {/* auto-fill columns sized to fit the width → never a horizontal scrollbar.
          Cells are a comfortable 2.75rem min so wide system emoji (Samsung / Noto
          on Android) aren't clipped into thin ribbons; NO overflow-hidden on the
          buttons for the same reason. Taller scroll area on a phone where there's
          room; capped on desktop. */}
      <div
        className="grid h-[44dvh] grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] content-start gap-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-width:thin] sm:h-56"
      >
        {loading ? (
          <p className="col-span-full py-6 text-center text-xs text-ink-subtle">Loading emoji…</p>
        ) : shown.length === 0 ? (
          <p className="col-span-full py-6 text-center text-xs text-ink-subtle">No emoji found</p>
        ) : (
          shown.map((d) => (
            <button
              key={d.e}
              type="button"
              aria-label={d.name}
              title={d.name}
              onClick={() => onSelect(d.e)}
              className="flex aspect-square items-center justify-center rounded-control text-2xl leading-none hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none"
            >
              {d.e}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
