import { BanIcon, EffectsIcon } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import type { BackgroundBlurControls } from '@/features/effects/useBackgroundBlur'
import { useEffectsUi } from '@/store/useEffectsUi'
import { cn } from '@/lib/cn'

/**
 * Snapchat-style lens carousel: a horizontal strip of circular effect thumbnails
 * that sits just above the control bar and applies live on tap. Opened from the
 * Effects button on the self-view tile. Blur strength + high quality live in the
 * Effects dialog under More — this is the quick, tactile picker. (Image
 * backgrounds were removed; they kept breaking the feed.) Hides with the chrome.
 */
export function EffectsCarousel({
  controls,
  visible,
}: {
  controls: BackgroundBlurControls
  /** chromeVisible && the carousel is toggled open. */
  visible: boolean
}) {
  const { supported, mode, useNone, useBlur } = controls
  const closeCarousel = useEffectsUi((s) => s.closeCarousel)

  const open = visible && supported

  return (
    <div
      className={cn(
        'pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3',
        'bottom-[max(5.25rem,calc(env(safe-area-inset-bottom)+4.75rem))]',
        'transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-island)]',
        !open && 'translate-y-4 opacity-0',
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          'flex max-w-full items-center gap-2 overflow-x-auto rounded-control bg-overlay px-2 py-2 backdrop-blur',
          // Only catch clicks when open — it stays in place (opacity-0) when
          // closed, which otherwise left invisible-but-clickable lenses over the
          // control bar.
          open ? 'pointer-events-auto' : 'pointer-events-none',
          // Hide the scrollbar — the strip scrolls by drag/swipe like Snapchat.
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
        role="radiogroup"
        aria-label="Background effects"
      >
        <Lens label="None" selected={mode === 'none'} onClick={useNone}>
          <BanIcon />
        </Lens>
        <Lens label="Blur" selected={mode === 'blur'} onClick={useBlur}>
          <span className="size-full bg-gradient-to-br from-ink-subtle to-line-strong blur-[1.5px]" />
        </Lens>

        <span className="mx-0.5 h-8 w-px shrink-0 bg-white/20" aria-hidden />
        <IconButton
          size="sm"
          label="Close effects"
          icon={<EffectsIcon />}
          active
          className="shrink-0"
          onClick={closeCarousel}
        />
      </div>
    </div>
  )
}

/** Circular lens thumbnail. */
function Lens({
  label,
  selected,
  onClick,
  children,
}: {
  label: string
  selected: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-sunken text-ink-muted ring-2 transition-[box-shadow] [&_svg]:size-5',
        selected ? 'ring-success' : 'ring-white/30',
      )}
    >
      {children}
    </button>
  )
}
