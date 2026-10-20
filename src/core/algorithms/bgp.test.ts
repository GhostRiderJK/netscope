import { describe, expect, it } from 'vitest'
import {
  bgpForwardingTable,
  intraAsCost,
  localPrefFor,
  runBgp,
  selectBest,
  type BgpRoute,
} from './bgp'
import { bgpFixture, chainFixture } from '../__fixtures'

function route(partial: Partial<BgpRoute>): BgpRoute {
  return {
    dest: 'SV',
    destAs: 4,
    asPath: [],
    localPref: 100,
    med: 0,
    source: 'ebgp',
    peer: 'P',
    exitCost: 0,
    nextHop: 'P',
    reason: '',
    ...partial,
  }
}

describe('BGP best-path selection rules', () => {
  it('prefers higher LOCAL_PREF over a shorter/c cheaper path', () => {
    const cheap = route({ peer: 'B1', asPath: [3, 4], med: 1, localPref: 100 })
    const expensive = route({ peer: 'A1', asPath: [2, 4], med: 30, localPref: 200 })
    expect(selectBest([cheap, expensive]).peer).toBe('A1')
  })

  it('breaks a LOCAL_PREF tie on shortest AS_PATH', () => {
    const shorter = route({ peer: 'X', asPath: [9] })
    const longer = route({ peer: 'Y', asPath: [8, 7, 9] })
    expect(selectBest([longer, shorter]).peer).toBe('X')
  })

  it('then falls back to MED', () => {
    expect(selectBest([route({ peer: 'hi', med: 5 }), route({ peer: 'lo', med: 1 })]).peer).toBe('lo')
  })

  it('reads ingress policy for LOCAL_PREF', () => {
    const topology = bgpFixture()
    expect(localPrefFor(topology.policies, 1, 2).value).toBe(200)
    expect(localPrefFor(topology.policies, 1, 3).value).toBe(100)
  })
})

describe('BGP propagation on the policy fixture', () => {
  const topology = bgpFixture()
  const result = runBgp(topology)

  it('sees four autonomous systems and iBGP full mesh inside AS1', () => {
    expect(result.asNumbers).toEqual([1, 2, 3, 4])
    expect(result.members[1]!.sort()).toEqual(['C1', 'C2'])
    expect(result.sessions.some((s) => s.kind === 'ibgp' && [s.a, s.b].sort().join() === 'C1,C2')).toBe(true)
    expect(result.converged).toBe(true)
  })

  it('AS1 exits toward AS2 because of LOCAL_PREF, not the cheap AS3 link', () => {
    const c1sv = result.best['C1']!['SV']!
    expect(c1sv.asPath).toEqual([2, 4])
    expect(c1sv.localPref).toBe(200)
    expect(c1sv.nextHop).toBe('A1')

    // Both AS1 border routers converge on the AS2 egress.
    expect(result.best['C2']!['SV']!.asPath).toEqual([2, 4])

    // The cheaper AS3 route is offered to C2 but rejected on policy.
    const c2candidates = result.candidates['C2']!['SV']!
    expect(c2candidates.some((r) => r.asPath.join(',') === '3,4')).toBe(true)
  })

  it('flags at least one route where policy overrode the cheapest path', () => {
    expect(result.policyOverShortest.some((e) => e.router === 'C2' && e.dest === 'SV')).toBe(true)
  })

  it('builds a forwarding table whose cost reflects the chosen AS-path', () => {
    const table = bgpForwardingTable(topology, 'C1', result)
    expect(table.algorithm).toBe('bgp')
    const entry = table.entries.find((e) => e.dest === 'SV')!
    expect(entry.nextHop).toBe('A1')
    expect(entry.outLink).toBe('l-C1-A1')
    expect(entry.hops).toBe(2)
  })
})

describe('BGP on a plain interior topology', () => {
  it('has no autonomous systems to speak of and simply converges', () => {
    const result = runBgp(chainFixture())
    expect(result.asNumbers).toEqual([])
    expect(result.converged).toBe(true)
  })

  it('intra-AS cost is Infinity across an AS boundary', () => {
    const topology = bgpFixture()
    expect(intraAsCost(topology, 'C1', 'C2')).toBe(1)
    expect(Number.isFinite(intraAsCost(topology, 'C1', 'A1'))).toBe(false)
  })
})
