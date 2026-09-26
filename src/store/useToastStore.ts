import { create } from 'zustand'

export type ToastTone = 'neutral' | 'info' | 'warning' | 'danger'

/** Optional inline action button on a toast (e.g. "Rejoin" after leaving). */
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  action?: ToastAction
  /** Override the auto-dismiss delay (ms). Actionable toasts want longer. */
  duration?: number
  /** Groups toasts that one event makes stale (every "New message" is `chat`). */
  tag?: string
}

export interface Toast {
  id: number
  text: string
  tone: ToastTone
  action?: ToastAction
  duration?: number
  tag?: string
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, tone?: ToastTone, opts?: ToastOptions) => void
  dismiss: (id: number) => void
  dismissTag: (tag: string) => void
}

let seq = 0
const MAX = 4

/** Transient on-screen notifications (join/leave, reports, etc.). */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (text, tone = 'neutral', opts) =>
    set((s) => ({
      toasts: [...s.toasts, { id: ++seq, text, tone, action: opts?.action, duration: opts?.duration, tag: opts?.tag }].slice(-MAX),
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  dismissTag: (tag) => set((s) => ({ toasts: s.toasts.filter((t) => t.tag !== tag) })),
}))

/** Non-React entry point so hooks/services can fire a toast. */
export function toast(text: string, tone?: ToastTone, opts?: ToastOptions) {
  useToastStore.getState().push(text, tone, opts)
}
