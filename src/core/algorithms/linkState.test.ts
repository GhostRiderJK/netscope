import { describe, expect, it } from 'vitest'
import { chapterFixture, chainFixture } from '../__fixtures'
import { dijkstra, hopCount, linkStateForwardingTable, nextHopFrom } from './linkState'
import { RoutingEngine } from '../routing'

describe('Dijkstra on the assignment topology', () => {
  const topology = chapterFixture()
  const sp = dijkstra(topology, 'A')

  // Hand-checked: A 0, B 2, C 4 (A-B-C), D 5 (A-B-C-D), E 8 (A-B-C-D-E).
  it('produces the documented shortest-path costs', () => {
    expect(sp.cost.A).toBe(0)
    expect(sp.cost.B).toBe(2)
    expect(sp.cost.C).toBe(4)
    expect(sp.cost.D).toBe(5)
    expect(sp.cost.E).toBe(8)
  })

  it('settles nodes in increasing cost order', () => {
    expect(sp.order).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('uses B as the next hop for B, C, D and E', () => {
    for (const dest of ['B', 'C', 'D', 'E']) {
      expect(nextHopFrom(topology, sp, 'A', dest)).toBe('B')
    }
  })

  it('builds a forwarding table whose costs match the tree', () => {
    const table = linkStateForwardingTable(topology, 'A', sp)
    expect(table.entries.map((e) => [e.destLabel, e.nextHopLabel, e.cost])).toEqual([
      ['B', 'B', 2],
      ['C', 'B', 4],
      ['D', 'B', 5],
      ['E', 'B', 8],
    ])
    expect(table.entries.every((e) => e.outLink === 'l-A-B')).toBe(true)
  })

  it('counts hops along the tree', () => {
    expect(hopCount(topology, sp, 'D')).toBe(3)
    expect(hopCount(topology, sp, 'E')).toBe(4)
  })

  it('prefers the physical detour over an expensive direct link', () => {
    // A-C direct costs 5, A-B-C costs 4.
    expect(sp.cost.C).toBeLessThan(5)
    expect(sp.prev.C).toBe('B')
  })
})

describe('Dijkstra under link failure and congestion', () => {
  it('recomputes instantly when the used link dies', () => {
    const before = dijkstra(chapterFixture(), 'A')
    const broken = chapterFixture()
    broken.links.find((l) => l.a === 'A' && l.b === 'B')!.status = 'failed'
    const after = dijkstra(broken, 'A')
    expect(before.cost.B).toBe(2)
    expect(after.cost.B).toBe(7) // A-C-B = 5 + 2
    expect(nextHopFrom(broken, after, 'A', 'B')).toBe('C')
  })

  it('marks an unreachable node with an infinite cost', () => {
    const topology = chainFixture()
    topology.links.find((l) => l.a === 'R3')!.status = 'failed'
    const sp = dijkstra(topology, 'R1')
    expect(Number.isFinite(sp.cost.R4)).toBe(false)
    expect(linkStateForwardingTable(topology, 'R1', sp).entries.map((e) => e.dest)).not.toContain('R4')
  })

  it('routes around a congested link when the detour is cheaper', () => {
    const topology = chapterFixture()
    topology.links.find((l) => l.a === 'A' && l.b === 'B')!.status = 'congested'
    const sp = dijkstra(topology, 'A')
    // A-B now costs 2 + 10 = 12, A-C-B costs 5 + 2 = 7.
    expect(sp.cost.B).toBe(7)
    expect(nextHopFrom(topology, sp, 'A', 'B')).toBe('C')
  })

  it('keeps the engine and the raw algorithm in agreement', () => {
    const topology = chapterFixture()
    const engine = new RoutingEngine(topology, 'link-state')
    const decision = engine.decide('A', 'E')
    expect(decision.nextHop).toBe('B')
    expect(decision.cost).toBe(8)
    expect(decision.rationale).toContain('SPF')
  })

  it('reports an empty decision when there is genuinely no route', () => {
    const topology = chapterFixture()
    topology.nodes.push({ id: 'Z', label: 'Z', kind: 'router', x: 0, y: 0 })
    const engine = new RoutingEngine(topology, 'link-state')
    const decision = engine.decide('A', 'Z')
    expect(decision.nextHop).toBeNull()
    expect(decision.cost).toBe(Infinity)
  })
})
