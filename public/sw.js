/*
  Manim service worker — background incoming-call notifications via Web Push.
  Pushes are payload-less ("tickle") so there's nothing sensitive at rest and no
  decryption here: we show a generic incoming-call prompt; the real caller/room
  appear in the in-app ringing banner once the app is focused (the Realtime
  channel reconnects on focus). Kept tiny on purpose.
*/
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Incoming call', {
      body: 'Someone is calling you on Manim — tap to open.',
      tag: 'mn-incoming',
      renotify: true,
      requireInteraction: true,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus()
      }
      return self.clients.openWindow('/')
    }),
  )
})
