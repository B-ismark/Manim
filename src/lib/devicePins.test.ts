import { beforeEach, describe, expect, it } from 'vitest'
import { checkDevices, fingerprint } from './devicePins'
import { newDeviceKeyPair, type DeviceKey } from './sealedSecrets'

async function device(id: string): Promise<DeviceKey> {
  return { deviceId: id, publicJwk: (await newDeviceKeyPair()).publicJwk }
}

/** In-memory localStorage: these tests run in the Node environment. */
function installStorage() {
  const data = new Map<string, string>()
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true })
}

describe('devicePins', () => {
  beforeEach(installStorage)

  it('the first ring just remembers; nothing to warn about', async () => {
    const c = await checkDevices('me', 'ama', [await device('phone-1')])
    expect(c).toMatchObject({ first: true, added: [], changed: [] })
  })

  it('a device never seen before is new, not changed', async () => {
    const phone = await device('phone-1')
    ;(await checkDevices('me', 'ama', [phone])).accept()
    const c = await checkDevices('me', 'ama', [phone, await device('laptop-1')])
    expect(c).toMatchObject({ first: false, added: ['laptop-1'], changed: [] })
    c.accept()
    expect((await checkDevices('me', 'ama', [phone])).added).toEqual([])
  })

  it('a known device with a different key is a change', async () => {
    const phone = await device('phone-1')
    ;(await checkDevices('me', 'ama', [phone])).accept()
    const swapped = { deviceId: 'phone-1', publicJwk: (await device('x')).publicJwk }
    const c = await checkDevices('me', 'ama', [swapped])
    expect(c.changed).toEqual(['phone-1'])
    // Until accepted, it keeps saying so.
    expect((await checkDevices('me', 'ama', [swapped])).changed).toEqual(['phone-1'])
    c.accept()
    expect((await checkDevices('me', 'ama', [swapped])).changed).toEqual([])
  })

  it('a device that drops off the list and comes back is still known', async () => {
    const phone = await device('phone-1')
    const laptop = await device('laptop-1')
    ;(await checkDevices('me', 'ama', [phone, laptop])).accept()
    ;(await checkDevices('me', 'ama', [phone])).accept()
    expect((await checkDevices('me', 'ama', [phone, laptop])).added).toEqual([])
  })

  it('each account keeps its own trust', async () => {
    ;(await checkDevices('me', 'ama', [await device('phone-1')])).accept()
    expect((await checkDevices('someone-else', 'ama', [await device('phone-1')])).first).toBe(true)
  })

  it('fingerprints are stable per key and differ between keys', async () => {
    const a = await device('a')
    expect(await fingerprint(a.publicJwk)).toBe(await fingerprint(a.publicJwk))
    expect(await fingerprint(a.publicJwk)).not.toBe(await fingerprint((await device('b')).publicJwk))
  })
})
