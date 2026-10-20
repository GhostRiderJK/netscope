import { describe, expect, it } from 'vitest'
import { chainFixture, chapterFixture, countInfinityFixture, hopChain } from '../__fixtures'
import { DEFAULT_DV_OPTIONS, RIP_OPTIONS, dvForwardingTable, dvRoute, runDistanceVector } from './distanceVector'

describe('Distance-vector convergence', () => {
  it('reaches the same costs Dijkstra computes', () => {
    const topology = chapterFixture()
    const result = runDistanceVector({ topology, options: { ...DEFAULT_DV_OPTIONS, infinity: 99 } })
    const last = result.rounds.at(-1)!.tables
    expect(result.converged).toBe(true)
    // From A: B 2, C 4, D 5, E 8.
    expect(last.A!.B!.cost).toBe(2)
    expect(last.A!.C!.cost).toBe(4)
    expect(last.A!.D!.cost).toBe(5)
    expect(last.A!.E!.cost).toBe(8)
    expect(last.A!.B!.nextHop).toBe('B')
    expect(last.A!.E!.nextHop).toBe('B')
  })

  it('propagates good news one router per round', () => {
    const topology = chainFixture()
    const result = runDistanceVector({ topology, options: { ...DEFAULT_DV_OPTIONS, infinity: 99 } })
    const INF = 99
    // R4 is three links from R1, so R1 cannot know it before round 3.
    expect(result.rounds[1]!.tables.R1!.R4!.cost).toBe(INF)
    expect(result.rounds[2]!.tables.R1!.R4!.cost).toBe(3)
    expect(result.convergedAtRound).toBeLessThanOrEqual(4)
  })

  it('installs a forwarding entry for an attached host', () => {
    const topology = chainFixture()
    const result = runDistanceVector({ topology, options: { ...DEFAULT_DV_OPTIONS, infinity: 99 } })
    const table = dvForwardingTable(topology, 'R1', result)
    const row = table.entries.find((e) => e.dest === 'H1')
    // R1 → R2 → R3 → R4 → H1, four links of cost 1.
    expect(row?.nextHop).toBe('R2')
    expect(row?.cost).toBe(4)
  })
})

describe('RIP hop-count limits', () => {
  it('treats 15 hops as the last usable metric and 16 as unreachable', () => {
    const topology = hopChain(18)
    const result = runDistanceVector({ topology, options: RIP_OPTIONS })
    const tables = result.rounds.at(-1)!.tables
    expect(tables.R0!.R15!.cost).toBe(15)
    expect(tables.R0!.R16!.cost).toBe(16)
    expect(tables.R0!.R17!.cost).toBe(16)
    const table = dvForwardingTable(topology, 'R0', result)
    expect(table.entries.map((e) => e.dest)).not.toContain('R16')
  })

  it('reports hop counts, not link costs, in its algorithm id', () => {
    const result = runDistanceVector({ topology: chainFixture(), options: RIP_OPTIONS })
    expect(result.algorithm).toBe('rip')
    expect(result.options.infinity).toBe(16)
  })
})

describe('Bad news and count to infinity', () => {
  const failing = { linkId: 'l-RB-SV', afterRound: 1 }

  it('counts upward when the only route to a server disappears', () => {
    const result = runDistanceVector({
      topology: countInfinityFixture(),
      options: { ...DEFAULT_DV_OPTIONS, infinity: 16, splitHorizon: false },
      failure: failing,
      runRounds: 30,
    })
    const rbToSv = result.rounds.map((r) => r.tables.RB!.SV!.cost)
    // Before the failure RB owns the direct route at cost 1.
    expect(rbToSv[1]).toBe(1)
    // Afterwards RB believes RA, so its metric climbs through finite values
    // instead of declaring failure, until it saturates at infinity.
    const climbed = rbToSv.slice(2).filter((c) => c > 1 && c < 16)
    expect(climbed.length).toBeGreaterThan(2)
    const monotone = rbToSv.every((c, i) => i === 0 || c >= rbToSv[i - 1]!)
    expect(monotone).toBe(true)
    expect(rbToSv.at(-1)).toBe(16)
    expect(result.countToInfinitySeen).toBe(true)
    expect(result.unreachableAfter).toContain('SV')
  })

  it('split horizon makes the adjacent router report failure at once', () => {
    const plain = runDistanceVector({
      topology: countInfinityFixture(),
      options: { ...DEFAULT_DV_OPTIONS, infinity: 16, splitHorizon: false },
      failure: failing,
      runRounds: 14,
    })
    const guarded = runDistanceVector({
      topology: countInfinityFixture(),
      options: { ...DEFAULT_DV_OPTIONS, infinity: 16, splitHorizon: true },
      failure: failing,
      runRounds: 14,
    })
    const plainRb = plain.rounds.map((r) => r.tables.RB!.SV!.cost)
    const guardedRb = guarded.rounds.map((r) => r.tables.RB!.SV!.cost)
    // RA never tells RB anything about SV (it learned it from RB), so RB has no
    // alternate to believe and jumps straight to infinity.
    expect(guardedRb[2]).toBe(16)
    expect(plainRb[2]).toBeLessThan(16)
  })

  it('poison reverse advertises infinity instead of hiding the route', () => {
    const result = runDistanceVector({
      topology: countInfinityFixture(),
      options: { ...DEFAULT_DV_OPTIONS, infinity: 16, poisonReverse: true },
      failure: failing,
      runRounds: 6,
    })
    const roundAfterFailure = result.rounds[2]!
    const poisoned = roundAfterFailure.advertisements.filter((a) => a.kind === 'poison-reverse')
    expect(poisoned.length).toBeGreaterThan(0)
    expect(poisoned.some((a) => a.entries.SV === 16)).toBe(true)
    expect(roundAfterFailure.tables.RB!.SV!.cost).toBe(16)
  })

  it('route lookup returns the settled cell', () => {
    const result = runDistanceVector({ topology: chainFixture(), options: { ...DEFAULT_DV_OPTIONS, infinity: 99 } })
    expect(dvRoute(result, 'R1', 'R3')?.cost).toBe(2)
    expect(dvRoute(result, 'R1', 'R1')?.cost).toBe(0)
  })
})
