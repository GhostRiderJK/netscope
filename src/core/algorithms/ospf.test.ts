import { describe, expect, it } from 'vitest'
import { adjacencyFromLsdb, runOspf } from './ospf'
import { dijkstra } from './linkState'
import { chapterFixture, chainFixture } from '../__fixtures'

describe('OSPF link-state process on the assignment topology', () => {
  const result = runOspf(chapterFixture())

  it('every router originates exactly one router LSA', () => {
    expect(result.lsdbSize).toBe(5)
    expect(result.records.map((r) => r.lsa.advertisingRouter).sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('floods until all routers hold an identical database', () => {
    expect(result.databasesMatch).toBe(true)
    expect(result.syncedRouters.sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(result.records.every((r) => r.complete)).toBe(true)
  })

  it('terminates flooding within a small, bounded number of rounds', () => {
    expect(result.rounds).toBeGreaterThan(0)
    expect(result.rounds).toBeLessThanOrEqual(result.lsdbSize)
  })

  it('each router runs the same SPF as raw Dijkstra on its own LSDB', () => {
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      expect(result.perRouter[id]!.spf.cost).toEqual(dijkstra(chapterFixture(), id).cost)
      expect(result.perRouter[id]!.forwardingTable.algorithm).toBe('ospf')
    }
  })

  it('router-to-router edges reconstructed from LSAs match the graph', () => {
    expect(result.routerRouterEdges).toHaveLength(7)
    const costs = result.routerRouterEdges.map((e) => `${e.a}-${e.b}:${e.cost}`).sort()
    expect(costs).toContain('A-B:2')
    expect(costs).toContain('C-D:1')
  })
})

describe('OSPF with a host on a stub link', () => {
  it('does not treat the attached host as an LSA originator', () => {
    const result = runOspf(chainFixture())
    expect(result.lsdbSize).toBe(4) // R1..R4, not H1
    expect(result.databasesMatch).toBe(true)
    const r4 = result.records.find((r) => r.lsa.advertisingRouter === 'R4')!
    expect(r4.lsa.links.some((l) => l.stub)).toBe(true)
  })
})

describe('adjacencyFromLsdb keeps the cheapest of duplicate edges', () => {
  it('collapses both directions of a link into one edge', () => {
    const result = runOspf(chapterFixture())
    const a = result.records.find((r) => r.lsa.advertisingRouter === 'A')!.lsa
    const b = result.records.find((r) => r.lsa.advertisingRouter === 'B')!.lsa
    const edges = adjacencyFromLsdb([a, b])
    expect(edges.filter((e) => (e.a === 'A' && e.b === 'B') || (e.a === 'B' && e.b === 'A'))).toHaveLength(1)
  })
})
