import { describe, expect, it } from 'vitest'
import {
  aggregate,
  binaryOctets,
  cidrOverlap,
  deliveryDecision,
  describeSubnet,
  parseIpv4,
  sameSubnet,
} from './ipv4'

describe('IPv4 parsing and validation', () => {
  it('accepts well-formed addresses', () => {
    expect(parseIpv4('192.168.10.130').ok).toBe(true)
    expect(parseIpv4('0.0.0.0').ok).toBe(true)
    expect(parseIpv4('255.255.255.255').value).toBe(4294967295)
  })

  it('rejects malformed input with a reason', () => {
    expect(parseIpv4('256.1.1.1').ok).toBe(false)
    expect(parseIpv4('10.0.0').ok).toBe(false)
    expect(parseIpv4('10.0.0.01').ok).toBe(false)
    expect(parseIpv4('10.0.0.-1').ok).toBe(false)
    expect(parseIpv4('').ok).toBe(false)
    expect(parseIpv4('10.0.0.999').error).toContain('255')
  })

  it('renders binary octets', () => {
    expect(binaryOctets(parseIpv4('192.168.10.130').value)).toBe('11000000.10101000.00001010.10000010')
  })
})

describe('The worked example 192.168.10.130/26', () => {
  const info = describeSubnet('192.168.10.130', 26)

  // Hand-checked: /26 blocks are 64 wide, so 130 lands in 128–191.
  it('derives mask, network and broadcast', () => {
    expect(info.mask).toBe('255.255.255.192')
    expect(info.wildcard).toBe('0.0.0.63')
    expect(info.network).toBe('192.168.10.128')
    expect(info.broadcast).toBe('192.168.10.191')
  })

  it('derives the usable range and counts', () => {
    expect(info.firstUsable).toBe('192.168.10.129')
    expect(info.lastUsable).toBe('192.168.10.190')
    expect(info.total).toBe(64)
    expect(info.usable).toBe(62)
    expect(info.networkBits).toBe(26)
    expect(info.hostBits).toBe(6)
    expect(info.hostPartBits).toBe('000010')
    expect(info.special).toBeNull()
  })

  it('splits network and host bits at the prefix', () => {
    expect(info.networkPartBits).toBe('11000000101010000000101010')
    expect(info.networkPartBits.length).toBe(26)
  })
})

describe('Prefix edge cases', () => {
  it('treats /31 as a point-to-point link with two usable addresses', () => {
    const info = describeSubnet('10.0.0.0', 31)
    expect(info.special).toBe('point-to-point')
    expect(info.total).toBe(2)
    expect(info.usable).toBe(2)
    expect(info.firstUsable).toBe('10.0.0.0')
    expect(info.lastUsable).toBe('10.0.0.1')
  })

  it('treats /32 as a single host route', () => {
    const info = describeSubnet('203.0.113.7', 32)
    expect(info.special).toBe('host-route')
    expect(info.total).toBe(1)
    expect(info.usable).toBe(1)
    expect(info.network).toBe('203.0.113.7')
    expect(info.broadcast).toBe('203.0.113.7')
    expect(info.hostPartBits).toBe('')
  })

  it('handles /0 as the default route block', () => {
    const info = describeSubnet('0.0.0.0', 0)
    expect(info.mask).toBe('0.0.0.0')
    expect(info.total).toBe(4294967296)
    expect(info.network).toBe('0.0.0.0')
  })

  it('refuses impossible prefixes', () => {
    expect(describeSubnet('10.0.0.1', 33).ok).toBe(false)
    expect(describeSubnet('10.0.0.1', -1).ok).toBe(false)
    expect(describeSubnet('10.0.0.1', 24.5).ok).toBe(false)
  })
})

describe('Subnet membership and the host forwarding decision', () => {
  it('decides two addresses share a /26', () => {
    expect(sameSubnet('192.168.10.130', '192.168.10.150', 26).shared).toBe(true)
    expect(sameSubnet('192.168.10.130', '192.168.10.195', 26).shared).toBe(false)
  })

  it('sends same-subnet traffic directly', () => {
    const d = deliveryDecision('192.168.10.130', 26, '192.168.10.150', '192.168.10.191')
    expect(d.mode).toBe('direct')
    expect(d.reason).toMatch(/own subnet|local ARP/i)
  })

  it('explains same-subnet delivery from the real destination, not a placeholder', () => {
    const d = deliveryDecision('192.168.10.130', 26, '192.168.10.150', '192.168.10.191')
    expect(d.reason).toContain('192.168.10.150')
    expect(d.reason).not.toContain('8.8.8.8')
  })

  it('explains remote delivery using the entered Host B and gateway', () => {
    const d = deliveryDecision('192.168.10.130', 26, '192.168.20.10', '192.168.10.129')
    expect(d.mode).toBe('gateway')
    expect(d.reason).toContain('192.168.20.10')
    expect(d.reason).toContain('192.168.10.129')
    expect(d.reason).not.toContain('8.8.8.8')
  })

  it('sends remote traffic to the gateway', () => {
    const d = deliveryDecision('192.168.10.130', 26, '192.168.20.10', '192.168.10.129')
    expect(d.mode).toBe('gateway')
  })

  it('flags a gateway outside the host subnet as the classic misconfiguration', () => {
    const d = deliveryDecision('192.168.10.130', 26, '192.168.20.10', '192.168.99.1')
    expect(d.mode).toBe('invalid-gateway')
    expect(d.reason).toMatch(/not inside/i)
  })

  it('reports no way out when there is no gateway', () => {
    expect(deliveryDecision('192.168.10.130', 26, '192.168.20.10').mode).toBe('none')
  })
})

describe('CIDR aggregation and overlap', () => {
  it('summarises two adjacent /26s into one /25', () => {
    const r = aggregate('192.168.10.130', 26, '192.168.10.195', 26)
    expect(r.block).toBe('192.168.10.128/25')
  })

  it('summarises four contiguous /24s into one /22', () => {
    const r = aggregate('10.0.0.1', 24, '10.0.3.1', 24)
    expect(r.block).toBe('10.0.0.0/22')
  })

  it('detects overlapping prefixes', () => {
    // a /24 nested inside a /16 overlaps
    expect(cidrOverlap('10.0.0.5', 16, '10.0.1.5', 24).overlaps).toBe(true)
    // adjacent, non-overlapping /26s
    expect(cidrOverlap('192.168.10.0', 26, '192.168.10.64', 26).overlaps).toBe(false)
  })
})
