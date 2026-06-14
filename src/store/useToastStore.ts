import { create } from 'zustand'

export type ToastTone = 'neutral' | 'info' | 'warning' | 'danger'

export interface Toast {
  id: number
  text: string
  tone: ToastTone
}

interface ToastState {
  toasts: Toast[]
  push: (text: string, tone?: ToastTone) => void
  dismiss: (id: number) => void
}

let seq = 0
const MAX = 4

/** Transient on-screen notifications (join/leave, reports, etc.). */
export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (text, tone = 'neutral') =>
    set((s) => ({ toasts: [...s.toasts, { id: ++seq, text, tone }].slice(-MAX) })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Non-React entry point so hooks/services can fire a toast. */
export function toast(text: string, tone?: ToastTone) {
  useToastStore.getState().push(text, tone)
}
