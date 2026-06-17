import { useRef, useState } from 'react'
import { accentPresets } from '@/styles/themes'
import { useThemeStore, type ThemeMode } from '@/store/useThemeStore'
import { Button, Tabs, TabPanel, Toggle } from '@/components/primitives'
import { EditIcon } from '@/components/icons'
import { cn } from '@/lib/cn'

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
]

/**
 * Compact theme picker (Slack model): mode segment + accent swatches.
 * Pure token swaps — proves the no-orphan theming (STYLE.md §9).
 */
export function ThemeSwitcher() {
  const mode = useThemeStore((s) => s.mode)
  const accentId = useThemeStore((s) => s.accentId)
  const highContrast = useThemeStore((s) => s.highContrast)
  const setMode = useThemeStore((s) => s.setMode)
  const setAccent = useThemeStore((s) => s.setAccent)
  const setHighContrast = useThemeStore((s) => s.setHighContrast)

  const [tab, setTab] = useState('presets')
  const standard = accentPresets.filter((p) => !p.visionAssistive)
  const vision = accentPresets.filter((p) => p.visionAssistive)

  return (
    <Tabs
      items={[
        { value: 'presets', label: 'Presets' },
        { value: 'custom', label: 'Custom' },
      ]}
      value={tab}
      onValueChange={setTab}
    >
      <TabPanel value="presets" className="mt-3 flex flex-col gap-4">
        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">Appearance</p>
          <div className="inline-flex rounded-control bg-sunken p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className={cn(
                  'rounded-control px-3 py-1.5 text-sm transition-colors duration-[var(--dur-fast)]',
                  mode === m.id
                    ? 'bg-surface text-ink shadow-pop ring-1 ring-inset ring-line-strong'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">Theme color</p>
          <div className="flex flex-wrap gap-2">
            {standard.map((p) => (
              <Swatch
                key={p.id}
                color={p.swatch}
                name={p.name}
                selected={accentId === p.id}
                onSelect={() => setAccent(p.id)}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-ink-muted">Vision-assistive</p>
          <div className="flex flex-wrap gap-2">
            {vision.map((p) => (
              <Swatch
                key={p.id}
                color={p.swatch}
                name={p.name}
                selected={accentId === p.id}
                onSelect={() => setAccent(p.id)}
              />
            ))}
          </div>
          <Toggle
            checked={highContrast}
            onCheckedChange={setHighContrast}
            label="High contrast"
            className="mt-3 w-full justify-between"
          />
        </div>
      </TabPanel>

      <TabPanel value="custom" className="mt-3">
        <CustomTokens />
      </TabPanel>
    </Tabs>
  )
}

// Slack's custom-theme model: a small, named set mapped onto our design tokens
// (not raw token names). Each maps the Slack concept to the app token it drives.
const CUSTOM_FIELDS = [
  { token: '--color-stage', label: 'System navigation', hint: 'App background & chrome', fallback: '#1c1c22' },
  { token: '--color-accent', label: 'Selected items', hint: 'Active & highlighted', fallback: '#6d5efc' },
] as const

/** Power-user overrides applied on top of the chosen preset (STYLE.md §9). */
function CustomTokens() {
  const custom = useThemeStore((s) => s.custom)
  const setCustomToken = useThemeStore((s) => s.setCustomToken)
  const clearCustom = useThemeStore((s) => s.clearCustom)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {CUSTOM_FIELDS.map((f) => (
          <TokenCard
            key={f.token}
            label={f.label}
            hint={f.hint}
            value={custom[f.token] ?? f.fallback}
            onChange={(v) => setCustomToken(f.token, v)}
          />
        ))}
      </div>
      <Button variant="neutral" size="sm" onClick={clearCustom} disabled={Object.keys(custom).length === 0}>
        Reset to preset
      </Button>
      <p className="text-xs text-ink-subtle">Overrides apply on top of the selected theme.</p>
    </div>
  )
}

/** Slack-style token card: label, then a swatch + hex pill that opens the picker. */
function TokenCard({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint: string
  value: string
  onChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="rounded-field border border-line bg-sunken p-2.5">
      <p className="text-xs font-semibold text-ink">{label}</p>
      <p className="mb-2 text-[11px] leading-tight text-ink-subtle">{hint}</p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex w-full items-center gap-2 rounded-control bg-surface px-2 py-1.5 text-left transition-colors hover:bg-line/40"
      >
        <span
          className="size-5 shrink-0 rounded-full border border-line"
          style={{ backgroundColor: value }}
          aria-hidden
        />
        <span className="flex-1 font-mono text-xs uppercase tracking-wide text-ink">{value}</span>
        <EditIcon className="size-3.5 shrink-0 text-ink-subtle" />
      </button>
      <input
        ref={inputRef}
        type="color"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      />
    </div>
  )
}

function Swatch({
  color,
  name,
  selected,
  onSelect,
}: {
  color: string
  name: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={name}
      title={name}
      className={cn(
        'size-8 rounded-control transition-transform duration-[var(--dur-fast)] hover:scale-110',
        selected && 'ring-2 ring-ink ring-offset-2 ring-offset-surface',
      )}
      style={{ backgroundColor: color }}
    />
  )
}
