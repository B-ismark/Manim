import { describe, expect, it } from 'vitest'
import { warmOrigin } from './warmConnection'

describe('warmOrigin', () => {
  it('maps a secure media-server URL to its https origin', () => {
    expect(warmOrigin('wss://demo.livekit.cloud')).toBe('https://demo.livekit.cloud')
    expect(warmOrigin('wss://demo.livekit.cloud/rtc?x=1')).toBe('https://demo.livekit.cloud')
  })
  it('keeps a local server on plain http, with its port', () => {
    expect(warmOrigin('ws://127.0.0.1:7880')).toBe('http://127.0.0.1:7880')
  })
  it('passes an http(s) URL through and refuses anything else', () => {
    expect(warmOrigin('https://a.example')).toBe('https://a.example')
    expect(warmOrigin('ftp://a.example')).toBeNull()
    expect(warmOrigin('')).toBeNull()
    expect(warmOrigin('not a url')).toBeNull()
  })
})
