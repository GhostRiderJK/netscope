import { describe, expect, it } from 'vitest'
import { hostPrefixTest, simulatePacket } from './packetSim'
import { chainFixture, chapterFixture } from './__fixtures'
import { PRESETS } from './presets'
import type { Topology } from './types'

const campus = PRESETS.find((p) => p.id === 'campus')!

function link(id: string, a: string, b: string, cost = 1, mtu = 1500): Topology['links'][number] {
  return { id, a, b, cost, mtu, status: 'active' }
}

const twoHostsSameSubnet: Topology = {
  id: 'lan',
  name: 'Two hosts',
  summary: 'same /24, one link',
  nodes: [
    { id: 'H1', label: 'H1', kind: 'host', x: 0, y: 0, ip: '10.0.0.10', prefix: 24 },
    { id: 'H2', label: 'H2', kind: 'host', x: 1, y: 0, ip: '10.0.0.20', prefix: 24 },
  ],
  links: [link('l-H1-H2', 'H1', 'H2')],
  policies: [],
}

const twoRouters: Topology = {
  id: 'pair',
  name: 'Two routers',
  summary: 'one link',
  nodes: [
    { id: 'A', label: 'A', kind: 'router', x: 0, y: 0 },
    { id: 'B', label: 'B', kind: 'router', x: 1, y: 0 },
  ],
  links: [link('l-A-B', 'A', 'B')],
  policies: [],
}

describe('host forwarding decision', () => {
  it('delivers directly when the destination is on the same subnet', () => {
    expect(hostPrefixTest(twoHostsSameSubnet, 'H1', 'H2').mode).toBe('direct')
  })
  it('falls back to the default gateway for a remote destination', () => {
    const r = hostPrefixTest(chainFixture(), 'H1', 'R1')
    expect(r.mode).toBe('gateway')
    expect(r.gatewayId).toBe('R4')
  })
  it('hands an addressed off-subnet host to its reachable gateway node (gateway is a node id, not an IP)', () => {
    const r = hostPrefixTest(campus, 'pc1', 'sv1')
    expect(r.mode).toBe('gateway')
    expect(r.gatewayId).toBe('r2')
  })
  it('refuses to send when the gateway node is not reachable over any usable link', () => {
    const topology: Topology = {
      ...campus,
      links: campus.links.filter((l) => l.id !== 'l-r2-pc1'),
    }
    expect(hostPrefixTest(topology, 'pc1', 'sv1').mode).toBe('none')
  })
  it('refuses to send when there is neither addressing nor a gateway', () => {
    const topology: Topology = {
      ...chainFixture(),
      nodes: [{ id: 'X', label: 'X', kind: 'host', x: 0, y: 0 }, ...chainFixture().nodes],
    }
    expect(hostPrefixTest(topology, 'X', 'R1').mode).toBe('none')
  })
})

describe('packet simulation — local delivery', () => {
  it('sends a datagram directly with no router involved', () => {
    const run = simulatePacket({
      topology: twoHostsSameSubnet,
      algorithm: 'link-state',
      srcId: 'H1',
      dstId: 'H2',
      initialTtl: 64,
      packetBytes: 200,
      headerLength: 20,
    })
    expect(run.result).toBe('delivered')
    expect(run.path).toEqual(['H1', 'H2'])
    expect(run.hops).toBe(1)
    expect(run.finalTtl).toBe(64)
    expect(run.events.some((e) => e.kind === 'prefix-check')).toBe(true)
  })
})

describe('packet simulation — gateway then router hop loop', () => {
  it('delivers the flagship campus PC-1 → Web Server journey through the gateway handoff', () => {
    const run = simulatePacket({
      topology: campus,
      algorithm: 'link-state',
      srcId: 'pc1',
      dstId: 'sv1',
      initialTtl: 64,
      packetBytes: 512,
      headerLength: 20,
    })
    expect(run.result).toBe('delivered')
    expect(run.path[0]).toBe('pc1')
    expect(run.path[1]).toBe('r2')
    expect(run.path.at(-1)).toBe('sv1')
    expect(run.events.some((e) => e.kind === 'gateway')).toBe(true)
  })


  const run = simulatePacket({
    topology: chainFixture(),
    algorithm: 'link-state',
    srcId: 'H1',
    dstId: 'R1',
    initialTtl: 8,
    packetBytes: 100,
    headerLength: 20,
  })

  it('hands off to the gateway, then forwards through the network', () => {
    expect(run.result).toBe('delivered')
    expect(run.path).toEqual(['H1', 'R4', 'R3', 'R2', 'R1'])
    expect(run.hops).toBe(4)
    expect(run.totalCost).toBe(4)
  })

  it('decrements TTL exactly once per forwarding router', () => {
    expect(run.events.filter((e) => e.kind === 'ttl-decrement')).toHaveLength(3)
    expect(run.finalTtl).toBe(5)
  })

  it('produces a timeline the animation can trust', () => {
    const kinds = run.events.map((e) => e.kind)
    expect(kinds[0]).toBe('create')
    expect(kinds).toContain('gateway')
    expect(kinds.at(-1)).toBe('deliver')
    expect(run.events.every((e, i) => e.index === i)).toBe(true)
  })
})

describe('packet simulation — TTL expiry', () => {
  it('discards the datagram when TTL reaches zero', () => {
    const run = simulatePacket({
      topology: chainFixture(),
      algorithm: 'link-state',
      srcId: 'H1',
      dstId: 'R1',
      initialTtl: 3,
      packetBytes: 100,
      headerLength: 20,
    })
    expect(run.result).toBe('ttl-expired')
    expect(run.finalTtl).toBe(0)
    expect(run.path).toEqual(['H1', 'R4', 'R3', 'R2'])
    expect(run.events.some((e) => e.kind === 'ttl-expired')).toBe(true)
  })
})

describe('packet simulation — fragmentation on the wire', () => {
  it('splits a 2000-byte datagram across an MTU-1500 link', () => {
    const run = simulatePacket({
      topology: twoRouters,
      algorithm: 'link-state',
      srcId: 'A',
      dstId: 'B',
      initialTtl: 64,
      packetBytes: 2000,
      headerLength: 20,
    })
    expect(run.result).toBe('delivered')
    // 1980 B of payload over a 1480 B chunk -> 1480 + 500.
    expect(run.fragments.map((f) => f.payloadBytes)).toEqual([1480, 500])
    expect(run.fragments.map((f) => f.offsetUnits)).toEqual([0, 185])
    expect(run.fragments.map((f) => f.moreFragments)).toEqual([true, false])
    expect(run.events.some((e) => e.kind === 'fragment')).toBe(true)
  })

  it('drops and reports ICMP when DF forbids fragmentation', () => {
    const run = simulatePacket({
      topology: chapterFixture(),
      algorithm: 'link-state',
      srcId: 'A',
      dstId: 'E',
      initialTtl: 64,
      packetBytes: 2000,
      headerLength: 20,
      dontFragment: true,
    })
    expect(run.result).toBe('df-drop')
    expect(run.events.some((e) => e.kind === 'drop' && /DF=1/.test(e.text))).toBe(true)
  })
})

describe('packet simulation — failures and edge cases', () => {
  it('drops and sends Destination Unreachable when there is no route', () => {
    const topology = chainFixture()
    topology.links.find((l) => l.id === 'l-R2-R3')!.status = 'failed'
    const run = simulatePacket({
      topology,
      algorithm: 'link-state',
      srcId: 'R1',
      dstId: 'R4',
      initialTtl: 64,
      packetBytes: 100,
      headerLength: 20,
    })
    expect(run.result).toBe('unreachable')
    expect(run.events.at(-1)!.kind).toBe('icmp')
  })

  it('loops a datagram back internally when source equals destination', () => {
    const run = simulatePacket({
      topology: chapterFixture(),
      algorithm: 'link-state',
      srcId: 'A',
      dstId: 'A',
      initialTtl: 64,
      packetBytes: 100,
      headerLength: 20,
    })
    expect(run.result).toBe('delivered')
    expect(run.events[0].kind).toBe('deliver')
  })

  it('rejects an unknown endpoint', () => {
    const run = simulatePacket({
      topology: chapterFixture(),
      algorithm: 'link-state',
      srcId: 'A',
      dstId: 'GHOST',
      initialTtl: 64,
      packetBytes: 100,
      headerLength: 20,
    })
    expect(run.result).toBe('unreachable')
  })
})
