import { useRef, useState, type ReactNode } from 'react'
import { Dialog, Toggle, Button, Avatar } from '@/components/primitives'
import { ThemeSwitcher } from '@/islands/ThemeSwitcher'
import { useSoundStore } from '@/store/useSoundStore'
import { useAppStore } from '@/store/useAppStore'
import { useNotifyStore } from '@/store/useNotifyStore'
import { useAuthStore } from '@/store/useAuthStore'
import { toast } from '@/store/useToastStore'

/**
 * Settings home for personal preferences, grouped into sections: a Profile header
 * (photo + name + account), Notifications (sounds + incoming-call alerts), and
 * Appearance (theme). This is the single place appearance + profile live (no
 * longer loose in the call control bar); opened from the landing page and the
 * in-call More menu.
 */
export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
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
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Your profile, notifications, and appearance."
    >
      <div className="flex flex-col gap-5">
        {/* Profile ------------------------------------------------------- */}
        <div className="flex items-center gap-4">
          <Avatar size="lg" name={displayName || email || '?'} src={avatarUrl} />
          <div className="flex min-w-0 flex-col gap-2">
            {signedIn ? (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={onPick}
                  className="hidden"
                />
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
            className="h-11 rounded-field bg-sunken px-3.5 text-sm outline-none placeholder:text-ink-subtle focus-visible:ring-2 focus-visible:ring-accent"
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
              className="h-11 cursor-default rounded-field bg-sunken px-3.5 text-sm text-ink-muted outline-none"
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
                    Notifications are blocked — re-enable them for this site in your browser
                    settings.
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
      </div>
    </Dialog>
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
