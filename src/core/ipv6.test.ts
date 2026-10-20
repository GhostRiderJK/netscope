import { describe, expect, it } from 'vitest'
import {
  NEXT_HEADER_NUMBERS,
  compressIpv6,
  describeIpv6Header,
  expandIpv6,
  interfaceIdFromMac,
  ipv6Binary,
  ipv6Nibbles,
  parseIpv6,
  sameIpv6Prefix,
} from './ipv6'

describe('IPv6 address parsing', () => {
  it('accepts a full eight-group address', () => {
    const p = parseIpv6('2001:0db8:0000:0000:0000:0000:0000:0001')
    expect(p.ok).toBe(true)
    expect(p.groups).toEqual([0x2001, 0x0db8, 0, 0, 0, 0, 0, 1])
  })

  it('expands a compressed address to eight four-digit groups', () => {
    expect(expandIpv6('2001:db8::1')).toBe('2001:0db8:0000:0000:0000:0000:0000:0001')
    expect(expandIpv6('::1')).toBe('0000:0000:0000:0000:0000:0000:0000:0001')
    expect(expandIpv6('::')).toBe('0000:0000:0000:0000:0000:0000:0000:0000')
  })

  it('handles an embedded IPv4 tail', () => {
    const p = parseIpv6('2001:db8::192.0.2.34')
    expect(p.ok).toBe(true)
    expect(p.groups.length).toBe(8)
    expect(p.groups[6]).toBe(0xc000)
    expect(p.groups[7]).toBe(0x0222)
  })

  it('rejects malformed input', () => {
    expect(parseIpv6('gggg::1').ok).toBe(false)
    expect(parseIpv6('1:2:3').ok).toBe(false)
    expect(parseIpv6('2001::db8::1').ok).toBe(false)
    expect(parseIpv6('fe80::1%eth0').ok).toBe(false)
    expect(parseIpv6('12345::1').ok).toBe(false)
    // "::" would have to stand for zero groups.
    expect(parseIpv6('1:2:3:4:5:6:7:8::').ok).toBe(false)
  })
})

describe('RFC 5952 canonical compression', () => {
  it('collapses the longest run and prefers the leftmost on a tie', () => {
    expect(compressIpv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe('2001:db8::1')
    expect(compressIpv6('fe80:0000:0000:0000:0000:0000:0000:0001')).toBe('fe80::1')
    expect(compressIpv6('2001:0db8:0001:0000:0000:0000:0000:0000')).toBe('2001:db8:1::')
    expect(compressIpv6('0000:0000:0000:0000:0000:0000:0000:0000')).toBe('::')
    // two equal zero-runs of length 2 → only the leftmost is compressed
    expect(compressIpv6('2001:0000:0000:1:0000:0000:1:1')).toBe('2001::1:0:0:1:1')
  })

  it('never compresses a single zero group', () => {
    expect(compressIpv6('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1')
  })

  it('round-trips through expansion', () => {
    const original = '2001:db8:85a3::8a2e:370:7334'
    expect(compressIpv6(expandIpv6(original))).toBe(original)
  })
})

describe('IPv6 bit and nibble views', () => {
  it('produces 128 bits', () => {
    expect(ipv6Binary('::1')).toHaveLength(128)
    expect(ipv6Binary('::1').endsWith('1')).toBe(true)
    expect(ipv6Nibbles('::1')).toHaveLength(32)
  })
})

describe('IPv6 prefix comparison', () => {
  it('groups two addresses under a /48', () => {
    const r = sameIpv6Prefix('2001:db8:1::1', '2001:db8:1::ff', 48)
    expect(r.ok).toBe(true)
    expect(r.shared).toBe(true)
    expect(r.networkA).toBe('2001:db8:1::')
  })

  it('separates different /48 blocks', () => {
    expect(sameIpv6Prefix('2001:db8:1::1', '2001:db8:2::1', 48).shared).toBe(false)
  })

  it('refuses an out-of-range prefix', () => {
    expect(sameIpv6Prefix('::1', '::2', 200).ok).toBe(false)
  })
})

describe('EUI-64 interface identifiers', () => {
  it('flips the universal/local bit and inserts fffe', () => {
    const r = interfaceIdFromMac('02:42:ac:11:00:02')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('0042:ac11:fffe:0002')
  })

  it('rejects a malformed MAC', () => {
    expect(interfaceIdFromMac('02:42:ac').ok).toBe(false)
  })
})

describe('IPv6 base header', () => {
  it('is always 40 bytes across six fields', () => {
    const r = describeIpv6Header({ trafficClass: 0, flowLabel: 0, payloadLength: 1200, nextHeader: 6, hopLimit: 64 })
    expect(r.ok).toBe(true)
    expect(r.totalBytes).toBe(40)
    expect(r.fields).toHaveLength(6)
    expect(r.fields.some((f) => f.note.includes('ICMPv6') || f.value.includes('TCP'))).toBe(true)
  })

  it('validates field widths', () => {
    expect(describeIpv6Header({ trafficClass: 0, flowLabel: 2 ** 20, payloadLength: 0, nextHeader: 6, hopLimit: 64 }).ok).toBe(false)
    expect(describeIpv6Header({ trafficClass: 300, flowLabel: 0, payloadLength: 0, nextHeader: 6, hopLimit: 64 }).ok).toBe(false)
    expect(describeIpv6Header({ trafficClass: 0, flowLabel: 0, payloadLength: 0, nextHeader: 58, hopLimit: 0 }).ok).toBe(true)
    expect(NEXT_HEADER_NUMBERS[58]).toBe('ICMPv6')
  })
})
