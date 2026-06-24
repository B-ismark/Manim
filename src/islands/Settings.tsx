import { useRef, useState, type ReactNode } from 'react'
import { Dialog, Toggle, Button, Avatar, Popover, IconButton } from '@/components/primitives'
import { SettingsIcon } from '@/components/icons'
import { ThemeSwitcher } from '@/islands/ThemeSwitcher'
import { useSoundStore } from '@/store/useSoundStore'
import { useAppStore } from '@/store/useAppStore'
import { useNotifyStore } from '@/store/useNotifyStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useIsTouch } from '@/lib/useIsTouch'
import { toast } from '@/store/useToastStore'

/**
 * Settings: profile (photo + name + account), notifications, and appearance.
 * Two surfaces share the same body — a full Dialog (in-call, from the More menu)
 * and a header Popover (landing — anchored, no scrim, like Setup status). The
 * landing popover is sized to the available viewport height so it fits without an
 * inner scroll on a normal screen.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Your profile, notifications, and appearance."
    >
      <SettingsContent />
    </Dialog>
  )
}

/**
 * Landing-header settings launcher. Desktop (fine pointer) → anchored popover,
 * no scrim (Setup-status style). Touch → full modal dialog; a header-anchored
 * panel is a desktop-only pattern that reads wrong on a phone.
 */
export function SettingsLauncher() {
  const touch = useIsTouch()
  const [open, setOpen] = useState(false)

  if (!touch) return <SettingsPopover />

  return (
    <>
      <IconButton
        label="Settings"
        icon={<SettingsIcon />}
        tone="neutral"
        onClick={() => setOpen(true)}
      />
      <SettingsDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** Desktop: anchored popover (no overlay), Setup-status style. */
function SettingsPopover() {
  return (
    <Popover
      side="bottom"
      align="end"
      className="w-[21rem] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto overscroll-contain no-scrollbar"
      trigger={<IconButton label="Settings" icon={<SettingsIcon />} tone="neutral" />}
    >
      <div className="px-1 pb-2 pt-1">
        <p className="text-sm font-semibold">Settings</p>
        <p className="text-xs text-ink-muted">Your profile, notifications, and appearance.</p>
      </div>
      <SettingsContent />
    </Popover>
  )
}

function SettingsContent() {
  const soundOn = useSoundStore((s) => s.enabled)
  const toggleSound = useSoundStore((s) => s.toggle)
  const displayName = useAppStore((s) => s.displayName)
  const setDisplayName = useAppStore((s) => s.setDisplayName)
  const notifyOn = useNotifyStore((s) => s.enabled)
  const enableNotify = useNotifyStore((s) => s.enable)
  const disableNotify = useNotifyStore((s) => s.disable)
  const signedIn = useAuthStore((s) => s.signedIn)
  const email = useAuthStore((s) => s.email)
  const avatarUrl = useAuthStore((s) => s.avatarUrl)
  const uploadAvatar = useAuthStore((s) => s.uploadAvatar)
  const removeAvatar = useAuthStore((s) => s.removeAvatar)
  const deleteAccount = useAuthStore((s) => s.deleteAccount)
  const notifSupported = typeof Notification !== 'undefined'
  const notifBlocked = notifSupported && Notification.permission === 'denied'

  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    if (!file.type.startsWith('image/')) return toast('Pick an image file.', 'danger')
    if (file.size > 8 * 1024 * 1024) return toast('Image is too large (max 8MB).', 'danger')
    setUploading(true)
    try {
      await uploadAvatar(file)
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'Upload failed.', 'danger')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Profile ------------------------------------------------------- */}
      <div className="flex items-center gap-4">
        <Avatar size="lg" name={displayName || email || '?'} src={avatarUrl} />
        <div className="flex min-w-0 flex-col gap-2">
          {signedIn ? (
            <>
              <input ref={fileRef} type="file" accept="image/*" onChange={onPick} className="hidden" />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="neutral"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Upload photo'}
                </Button>
                {avatarUrl && !uploading && (
                  <Button size="sm" variant="ghost" onClick={() => void removeAvatar()}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-ink-subtle">JPG, PNG or WebP, up to 8MB.</p>
            </>
          ) : (
            <p className="text-xs text-ink-subtle">Sign in to add a profile photo.</p>
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Your name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          autoComplete="name"
          className="h-11 rounded-field bg-sunken px-3.5 text-base outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:text-sm"
        />
        <span className="text-xs text-ink-subtle">
          {signedIn
            ? 'Synced to your account — used on every device you sign in on.'
            : 'Saved on this device and used when you join a call.'}
        </span>
      </label>

      {signedIn && email && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Email</span>
          <input
            value={email}
            readOnly
            aria-label="Email"
            className="h-11 cursor-default rounded-field bg-sunken px-3.5 text-base text-ink-muted outline-none sm:text-sm"
          />
        </label>
      )}

      {/* Notifications ------------------------------------------------- */}
      <Section title="Notifications">
        <div className="flex flex-col gap-4">
          <Toggle
            checked={soundOn}
            onCheckedChange={toggleSound}
            label="UI sounds"
            className="w-full justify-between"
          />
          {notifSupported && (
            <div>
              <Toggle
                checked={notifyOn}
                disabled={notifBlocked}
                onCheckedChange={(v) => {
                  if (v) void enableNotify()
                  else disableNotify()
                }}
                label="Notify me of incoming calls"
                className="w-full justify-between"
              />
              {notifBlocked && (
                <p className="mt-1 text-xs text-ink-subtle">
                  Notifications are blocked — re-enable them for this site in your browser settings.
                </p>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* Appearance ---------------------------------------------------- */}
      <Section title="Appearance">
        <ThemeSwitcher />
      </Section>

      {/* Account — self-serve deletion (the audit's L5). Signed-in only. */}
      {signedIn && (
        <Section title="Account">
          <DeleteAccount onDelete={deleteAccount} />
        </Section>
      )}
    </div>
  )
}

/**
 * Self-serve account deletion. Inline two-step confirm (not a separate modal) so
 * it works identically whether Settings is rendered as the desktop popover or the
 * touch dialog — a nested portal modal would race the popover's auto-close.
 */
function DeleteAccount({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      await onDelete()
      toast('Your account and data were deleted.', 'info')
    } catch (ex) {
      toast(ex instanceof Error ? ex.message : 'Could not delete your account.', 'danger')
      setBusy(false)
      setConfirming(false)
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1.5">
        <Button size="sm" variant="ghost" className="self-start !text-danger-text" onClick={() => setConfirming(true)}>
          Delete account
        </Button>
        <p className="text-xs text-ink-subtle">
          Permanently removes your profile, contacts, and notifications. Calls aren't recorded, so
          there's no call history to delete.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-field bg-sunken p-3">
      <p className="text-sm font-medium">Delete your account?</p>
      <p className="text-xs text-ink-muted">This can't be undone.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="danger" disabled={busy} onClick={() => void run()}>
          {busy ? 'Deleting…' : 'Delete account'}
        </Button>
        <Button size="sm" variant="neutral" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Labelled, divider-separated group of settings (Vercel/Clay-style sections). */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-ink-subtle">{title}</h3>
      {children}
    </section>
  )
}
