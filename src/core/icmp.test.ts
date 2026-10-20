import { describe, expect, it } from 'vitest'
import {
  RTT_DISCLAIMER,
  computeForwardingPath,
  runTraceroute,
  simulatePing,
  simulatedRtt,
} from './icmp'
import { chapterFixture } from './__fixtures'

describe('forwarding path used by traceroute', () => {
  it('walks the link-state tree hop by hop', () => {
    const r = computeForwardingPath(chapterFixture(), 'link-state', 'A', 'E')
    expect(r.path).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(r.cost).toBe(8)
    expect(r.unreachable).toBe(false)
    expect(r.links).toEqual(['l-A-B', 'l-B-C', 'l-C-D', 'l-D-E'])
  })
})

describe('simulated RTT is deterministic and cost-driven', () => {
  it('returns the same value for the same inputs', () => {
    expect(simulatedRtt(8, 2, 1)).toBe(simulatedRtt(8, 2, 1))
  })
  it('grows with link cost', () => {
    expect(simulatedRtt(2, 1, 0)).toBeLessThan(simulatedRtt(8, 1, 0))
  })
})

describe('traceroute — successful route', () => {
  const r = runTraceroute({ topology: chapterFixture(), algorithm: 'link-state', fromId: 'A', toId: 'E' })
  it('answers Time Exceeded at each router then Echo Reply at the destination', () => {
    expect(r.hops.map((h) => h.outcome)).toEqual(['time-exceeded', 'time-exceeded', 'time-exceeded', 'echo-reply'])
    expect(r.reached).toBe(true)
    expect(r.stoppedByTtl).toBe(false)
  })
  it('labels the respondent with its own address and one probe per TTL', () => {
    expect(r.hops[0].nodeLabel).toBe('B')
    expect(r.hops[0].rtts).toHaveLength(3)
    expect(r.baseHeader).toContain(RTT_DISCLAIMER)
  })
})

describe('traceroute — unreachable destination', () => {
  const r = runTraceroute({ topology: chapterFixture(), algorithm: 'link-state', fromId: 'A', toId: 'E', scenario: 'unreachable' })
  it('ends on Destination Unreachable instead of an Echo Reply', () => {
    expect(r.hops.at(-1)!.outcome).toBe('destination-unreachable')
    expect(r.reached).toBe(false)
  })
})

describe('traceroute — a router that stays quiet', () => {
  const r = runTraceroute({
    topology: chapterFixture(),
    algorithm: 'link-state',
    fromId: 'A',
    toId: 'E',
    scenario: 'filtered-router',
    silentRouterId: 'B',
  })
  it('shows asterisks for the filtered hop but still reaches the destination', () => {
    expect(r.hops[0].outcome).toBe('no-response')
    expect(r.hops[0].responded).toBe(false)
    expect(r.hops[0].rtts.every((v) => v === 0)).toBe(true)
    expect(r.hops.at(-1)!.outcome).toBe('echo-reply')
    expect(r.reached).toBe(true)
  })
})

describe('traceroute — maximum TTL too small', () => {
  const r = runTraceroute({ topology: chapterFixture(), algorithm: 'link-state', fromId: 'A', toId: 'E', maxTtl: 2 })
  it('stops at the TTL limit without a destination reply', () => {
    expect(r.hops).toHaveLength(2)
    expect(r.reached).toBe(false)
    expect(r.stoppedByTtl).toBe(true)
  })
})

describe('traceroute — a loop only TTL can kill', () => {
  const r = runTraceroute({
    topology: chapterFixture(),
    algorithm: 'link-state',
    fromId: 'A',
    toId: 'E',
    scenario: 'loop',
    loopPath: ['A', 'B', 'C', 'B'],
  })
  it('never gets a reply and reports the loop', () => {
    expect(r.reached).toBe(false)
    expect(r.summary).toMatch(/circl/i)
    expect(r.hops.some((h) => h.outcome === 'expired')).toBe(true)
  })
})

describe('ping', () => {
  it('reports full reachability with a line per probe', () => {
    const p = simulatePing({ topology: chapterFixture(), algorithm: 'link-state', fromId: 'A', toId: 'E', count: 4 })
    expect(p.sent).toBe(4)
    expect(p.received).toBe(4)
    expect(p.loss).toBe(0)
    expect(p.lines).toHaveLength(4)
    expect(p.lines[0]).toContain('ttl=60')
    expect(p.lines[0]).toContain('time=')
    expect(p.disclaimer).toBe(RTT_DISCLAIMER)
  })

  it('reports 100% loss for a destination with no route', () => {
    const topology = chapterFixture()
    topology.nodes.push({ id: 'Z', label: 'Z', kind: 'router', x: 0, y: 0 })
    const p = simulatePing({ topology, algorithm: 'link-state', fromId: 'A', toId: 'Z', count: 3 })
    expect(p.sent).toBe(3)
    expect(p.received).toBe(0)
    expect(p.loss).toBe(100)
    expect(p.lines[0]).toMatch(/could not reach/i)
  })
})
