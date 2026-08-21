import { useCallback, useEffect, useRef, useState } from 'react'
import { useConnectionState, useRoomContext } from '@livekit/components-react'
import { ConnectionState, RoomEvent } from 'livekit-client'
import { useAnnounce } from '@/features/a11y/AnnouncerContext'
import { useRoomStore } from '@/store/useRoomStore'
import { addBreadcrumb } from '@/lib/report'
import { micTrack, recoverMicrophone, trackNeedsRecovery } from '@/lib/audioRecovery'

/**
 * Audio-session ownership: keeping a call audible across a trip to another app.
 *
 * "I opened another app mid-call and then neither of us could hear anything" was
 * nobody's job before this hook — there was no visibility or audio-session
 * handling for audio anywhere in the app. Four separate gaps produced it, and
 * every one of them is permanent once hit: the call stays silent for the rest of
 * its life, in both directions, behind a control bar that looks entirely healthy.
 *
 * **They can't hear you.** Backgrounding makes the OS mute the capture track.
 * Five seconds later LiveKit's debounced handler calls `pauseUpstream()`, which
 * replaces the outgoing track with `null`, and it undoes that only on the
 * MediaStreamTrack's `unmute` event — which mobile Safari frequently never fires
 * after an interruption. LiveKit's own foreground re-acquire doesn't save it
 * either: it's gated on LiveKit's UA-based `isMobile()` (so a tablet on the
 * desktop site misses it) and it restarts from the track's existing constraints,
 * which may still be pinned to a device that has gone (see lib/audioRecovery).
 *
 * **You can't hear them.** The app renders remote audio through
 * `RoomAudioRenderer` and never called `room.startAudio()`. LiveKit's base track
 * re-plays its attached elements when the page returns — but only for
 * `kind === video`, so audio elements the OS paused are never resumed. And
 * LiveKit's iOS resume hook is installed lazily INSIDE `startAudio()`, so a call
 * that never invokes it never gets the hook at all. Nothing listened for
 * `AudioPlaybackStatusChanged` either, so a browser revoking playback did it in
 * silence.
 *
 * This hook does three things, in descending order of how much they can promise:
 *
 *  1. **Hold the session open** while backgrounded. Calling `startAudio()` is
 *     most of this: on iOS it creates LiveKit's own silent keepalive element and
 *     installs their visibilitychange hook, neither of which existed before
 *     because nothing ever called it. A media session the OS recognises does the
 *     rest. Best-effort by nature — and deliberately no keepalive of our own: an
 *     AudioContext we build is a SECOND one alongside the room's (which is
 *     private, so it can't be shared), and on iOS a second context can move the
 *     audio session under a live call. Unverifiable risk on the one platform
 *     this is for, for a benefit LiveKit's own element already covers.
 *  2. **Repair on return** — resume the context, re-play what stayed paused,
 *     un-pause the upstream, re-acquire a dead mic. This part is reliable, and
 *     it is what turns a permanent outage into a blip.
 *  3. **Ask, when only a gesture will do** — iOS routinely refuses playback
 *     until the user touches something. Nothing in a page can satisfy that, so
 *     `canPlayback` goes false and the UI asks.
 *
 * Mount once inside the LiveKitRoom provider (RoomView).
 */
export function useAudioSession() {
  const room = useRoomContext()
  const state = useConnectionState()
  const connected = state === ConnectionState.Connected
  // Subscribed, not just read inside resume(): while this device is a companion
  // every resume bails, so the session is never started at all. Clearing
  // companion has to be what starts it.
  const companion = useRoomStore((s) => s.companion)
  const announce = useAnnounce()
  /** False while the browser is refusing to play call audio. Only a real user
   *  gesture clears it, so this is the one part that has to be asked for. */
  const [canPlayback, setCanPlayback] = useState(true)
  // Latches on the first connect. The media session below keys off THIS, not
  // `connected`: a reconnect blip is precisely when you want the OS to still
  // think we're playing, so dropping the declaration for it is backwards.
  const [inCall, setInCall] = useState(false)
  useEffect(() => {
    if (connected) setInCall(true)
  }, [connected])

  /**
   * Bring audio back. Safe to call repeatedly; every step no-ops when the thing
   * it fixes isn't broken.
   *
   * Skipped entirely while this device is a muted companion — the user chose to
   * hear the call on their other device, and `startAudio()` force-unmutes every
   * audio element, so running it here would put the echo back.
   */
  const resume = useCallback(async () => {
    if (useRoomStore.getState().companion) return
    addBreadcrumb('audio session resume')

    // Resumes the AudioContext, unmutes and re-plays every remote audio element,
    // and updates canPlaybackAudio. Throws when the browser wants a gesture
    // first; the playback-status listener below picks that up.
    try {
      await room.startAudio()
    } catch {
      /* playback still blocked — reflected via AudioPlaybackStatusChanged */
    }

    // Belt and braces: an element startAudio() didn't reach (attached after it
    // ran, or rejected on its own) is still silent. play() on an already-playing
    // element resolves immediately, so this costs nothing when all is well.
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        for (const el of pub.track?.attachedElements ?? []) {
          if (el.paused) void el.play().catch(() => {})
        }
      }
    }

    // The mic — but only when the user hasn't muted it themselves. Coming back
    // from another app must never unmute someone.
    const track = micTrack(room)
    if (track && !track.isMuted && trackNeedsRecovery(track)) {
      await recoverMicrophone(room, true)
    }
  }, [room])

  // Start the audio session as soon as we're connected. Joining is a click, so
  // the gesture requirement is already satisfied and this normally succeeds
  // outright — and succeeding is also what installs LiveKit's own iOS hook.
  useEffect(() => {
    if (!connected) return
    void resume()
  }, [connected, companion, resume])

  // Returning to the foreground. `visibilitychange` covers the app switch;
  // `pageshow` covers a page restored from the back/forward cache, which fires no
  // visibility change at all.
  useEffect(() => {
    if (!connected) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void resume()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pageshow', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pageshow', onVisible)
    }
  }, [connected, resume])

  // The browser granting or revoking playback. Synced on mount too: the status
  // can already have flipped before we subscribed. Announced on the way DOWN
  // only — the banner it drives carries no live region of its own, so a screen
  // reader hears this once rather than once per surface.
  const wasPlayable = useRef(true)
  useEffect(() => {
    const sync = () => {
      const can = room.canPlaybackAudio
      if (wasPlayable.current && !can) {
        announce('Call audio is paused. Turn sound back on to resume.', 'assertive')
      }
      wasPlayable.current = can
      setCanPlayback(can)
    }
    sync()
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync)
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, sync)
    }
  }, [room, announce])

  useMediaSessionActive(inCall, room.name)

  return { canPlayback, resume }
}

export type AudioSession = ReturnType<typeof useAudioSession>

/**
 * Declare an ACTIVE audio session to the OS for the duration of the call.
 *
 * `useMediaSessionControls` already registers mic/camera/hang-up actions, but a
 * media session with no metadata and no playback state is not something the OS
 * treats as playing: Android and iOS both weigh that when deciding which
 * backgrounded pages keep their audio, and the lock-screen controls those
 * actions exist for never appeared at all. Setting metadata and
 * `playbackState = 'playing'` is the cheapest thing that makes a backgrounded
 * call look like what it is.
 */
function useMediaSessionActive(inCall: boolean, roomName: string) {
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms || !inCall) return
    const prevState = ms.playbackState
    try {
      ms.metadata = new MediaMetadata({ title: 'Call', artist: roomName || 'Manim' })
      ms.playbackState = 'playing'
    } catch {
      /* MediaMetadata unavailable — the actions still work */
    }
    return () => {
      try {
        ms.playbackState = prevState
        ms.metadata = null
      } catch {
        /* ignore */
      }
    }
  }, [inCall, roomName])
}
