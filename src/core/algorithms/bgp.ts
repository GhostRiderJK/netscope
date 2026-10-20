import { adjacency, effectiveCost, isUsable, nodeById } from '../graph'
import type { BgpPolicy, ForwardingEntry, ForwardingTable, NetLink, Topology } from '../types'
import { prefixOf } from './linkState'

/**
 * Simplified BGP best-path simulation.
 *
 * eBGP sessions run over links that cross an AS boundary; iBGP is a full mesh
 * inside each AS. Routes propagate speaker by speaker until nothing changes.
 * Selection order implemented: LOCAL_PREF (from ingress policy) → shortest
 * AS_PATH → lowest MED → lowest IGP distance to the exit point → lowest peer id.
 *
 * Not modelled: route reflectors, Confederations, communities, MED inheritance,
 * multi-exit discriminator per-VRF, aggregation, or real timing.
 */

export interface BgpRoute {
  dest: string
  /** AS the destination lives in. */
  destAs: number
  /** ASes to traverse, excluding the evaluating router's own AS. */
  asPath: number[]
  localPref: number
  med: number
  /** Which session taught this route to the holder. */
  source: 'local' | 'ibgp' | 'ebgp'
  /** Peer router that advertised it (null for locally originated). */
  peer: string | null
  /** IGP cost from the evaluating router to the exit point. */
  exitCost: number
  /** Resolved next hop router used for forwarding. */
  nextHop: string | null
  reason: string
}

export interface BgpRound {
  round: number
  changes: { router: string; dest: string; note: string }[]
}

export interface BgpResult {
  asNumbers: number[]
  /** as → routers in it. */
  members: Record<number, string[]>
  sessions: { a: string; b: string; kind: 'ebgp' | 'ibgp'; linkId?: string }[]
  best: Record<string, Record<string, BgpRoute>>
  /** All candidate routes per router/dest — the BGP table view. */
  candidates: Record<string, Record<string, BgpRoute[]>>
  rounds: BgpRound[]
  converged: boolean
  /** Routes where the policy winner is not the IGP-cheapest reachable route. */
  policyOverShortest: { router: string; dest: string; policyCost: number; shortestCost: number }[]
}

export function asOf(topology: Topology, nodeId: string): number | undefined {
  return nodeById(topology, nodeId)?.asNumber
}

export function runBgp(topology: Topology): BgpResult {
  const routers = topology.nodes.filter((n) => n.kind === 'router' && n.asNumber !== undefined)
  const routerIds = routers.map((r) => r.id)
  const asOfId = new Map(routers.map((r) => [r.id, r.asNumber as number]))
  const members: Record<number, string[]> = {}
  for (const r of routers) {
    const as = r.asNumber as number
    members[as] ??= []
    if (!members[as].includes(r.id)) members[as].push(r.id)
  }
  for (const list of Object.values(members)) list.sort()
  const asNumbers = Object.keys(members)
    .map(Number)
    .sort((a, b) => a - b)

  const sessions: { a: string; b: string; kind: 'ebgp' | 'ibgp'; linkId?: string }[] = []
  for (const link of topology.links) {
    if (!isUsable(link)) continue
    const asA = asOfId.get(link.a)
    const asB = asOfId.get(link.b)
    if (asA === undefined || asB === undefined) continue
    sessions.push({ a: link.a, b: link.b, kind: asA === asB ? 'ibgp' : 'ebgp', linkId: link.id })
  }
  // iBGP full mesh (logical peering; traffic still exits over the IGP path).
  for (const as of asNumbers) {
    const list = members[as]!
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        sessions.push({ a: list[i]!, b: list[j]!, kind: 'ibgp' })
      }
    }
  }

  const igpCostWithin = (from: string, to: string): number => intraAsCost(topology, from, to, asOfId)
  const destinations = topology.nodes.map((n) => n.id)
  const localOriginOf = (dest: string): { owner: string; direct: boolean } | null => {
    const node = nodeById(topology, dest)
    if (!node) return null
    if (node.kind === 'router' && node.asNumber !== undefined) return { owner: node.id, direct: true }
    const attached = topology.links
      .filter((l) => isUsable(l) && (l.a === dest || l.b === dest))
      .map((l) => (l.a === dest ? l.b : l.a))
      .map((id) => nodeById(topology, id))
      .find((n) => n?.kind === 'router' && n.asNumber !== undefined)
    return attached ? { owner: attached.id, direct: true } : null
  }

  const peersOf = (router: string) =>
    sessions
      .filter((s) => s.a === router || s.b === router)
      .map((s) => ({ peer: s.a === router ? s.b : s.a, kind: s.kind, linkId: s.linkId }))
      .sort((x, y) => x.peer.localeCompare(y.peer))

  let best: Record<string, Record<string, BgpRoute>> = {}
  for (const r of routerIds) best[r] = {}

  const localRoutes: Record<string, Record<string, BgpRoute>> = {}
  for (const r of routerIds) localRoutes[r] = {}

  // Seed locally originated routes.
  for (const dest of destinations) {
    const origin = localOriginOf(dest)
    if (!origin) continue
    const ownAs = asOfId.get(origin.owner) as number
    const destAs = nodeById(topology, dest)?.asNumber ?? ownAs
    const route: BgpRoute = {
      dest,
      destAs,
      asPath: [],
      localPref: 100,
      med: 0,
      source: 'local',
      peer: null,
      exitCost: 0,
      nextHop: dest,
      reason: `${label(topology, origin.owner)} originates ${prefixOf(topology, dest)} (its own network).`,
    }
    localRoutes[origin.owner]![dest] = route
    best[origin.owner]![dest] = route
  }

  const candidates: Record<string, Record<string, BgpRoute[]>> = {}
  const rounds: BgpRound[] = []
  let changed = true
  let round = 0
  while (changed && round < 24) {
    round += 1
    changed = false
    const changes: BgpRound['changes'] = []
    const previousBest = structuredCloneRoutes(best)

    for (const router of routerIds) {
      const ownAs = asOfId.get(router) as number
      for (const dest of destinations) {
        const list: BgpRoute[] = []
        const local = localRoutes[router]?.[dest]
        if (local) list.push(local)

        for (const { peer, kind, linkId } of peersOf(router)) {
          const peerBest = previousBest[peer]?.[dest]
          if (!peerBest) continue
          const peerAs = asOfId.get(peer)
          if (peerAs === undefined) continue
          if (kind === 'ebgp') {
            // iBGP-learned routes are not re-advertised out an eBGP session.
            if (peerBest.source === 'ibgp') continue
            if (peerAs === ownAs || peerBest.asPath.includes(ownAs)) continue
            const link = linkId ? topology.links.find((l) => l.id === linkId) : undefined
            const linkCost = link ? effectiveCost(link) : 1
            const lp = localPrefFor(topology.policies, ownAs, peerAs)
            list.push({
              dest,
              destAs: peerBest.destAs,
              asPath: [peerAs, ...peerBest.asPath],
              localPref: lp.value,
              med: peerBest.med + linkCost,
              source: 'ebgp',
              peer,
              exitCost: linkCost,
              nextHop: peer,
              reason: `learned from ${label(topology, peer)} (AS${peerAs}) over eBGP; AS_PATH ${[peerAs, ...peerBest.asPath].join(' ')}, LOCAL_PREF ${lp.value}${lp.reason ? ` (${lp.reason})` : ''}.`,
            })
          } else if (peerAs === ownAs && peer !== router) {
            if (peerBest.source === 'local' || peerBest.source === 'ebgp') {
              list.push({
                ...peerBest,
                source: 'ibgp',
                peer,
                exitCost: igpCostWithin(router, peer),
                nextHop: null,
                reason: `learned from iBGP peer ${label(topology, peer)} in AS${ownAs}; exit via that border router, IGP distance ${igpCostWithin(router, peer)}.`,
              })
            }
          }
        }

        for (const route of list) {
          if (route.source !== 'local' && route.nextHop === null && route.source === 'ibgp') {
            const exit = route.peer as string
            route.nextHop = nextHopTowards(topology, router, exit, asOfId)
          }
        }

        candidates[router] ??= {}
        candidates[router]![dest] = list

        if (list.length === 0) {
          if (best[router]![dest]) {
            delete best[router]![dest]
            changed = true
          }
          continue
        }
        const winner = selectBest(list)
        const current = best[router]![dest]
        if (!current || !sameRoute(current, winner)) {
          best[router]![dest] = winner
          changed = true
          changes.push({ router, dest, note: `${label(topology, router)}: best for ${prefixOf(topology, dest)} → ${winner.source}, AS_PATH ${winner.asPath.join(' ') || '(local)'}, LOCAL_PREF ${winner.localPref}.` })
        }
      }
    }
    rounds.push({ round, changes })
  }

  const policyOverShortest: BgpResult['policyOverShortest'] = []
  for (const router of routerIds) {
    for (const dest of destinations) {
      const chosen = best[router]?.[dest]
      if (!chosen) continue
      const all = candidates[router]?.[dest] ?? []
      const cheapest = [...all].sort(
        (x, y) => x.med + x.exitCost - (y.med + y.exitCost) || x.asPath.length - y.asPath.length
      )[0]
      if (cheapest && !sameRoute(cheapest, chosen) && cheapest.med + cheapest.exitCost < chosen.med + chosen.exitCost) {
        policyOverShortest.push({
          router,
          dest,
          policyCost: chosen.med + chosen.exitCost,
          shortestCost: cheapest.med + cheapest.exitCost,
        })
      }
    }
  }

  return {
    asNumbers,
    members,
    sessions,
    best,
    candidates,
    rounds,
    converged: !changed,
    policyOverShortest,
  }
}

export function localPrefFor(policies: BgpPolicy[], ownAs: number, peerAs: number): { value: number; reason?: string } {
  const match = policies.find((p) => p.asNumber === ownAs && p.peerAs === peerAs)
  return match ? { value: match.localPref, reason: match.reason } : { value: 100 }
}

/** Cisco-flavoured ordering, reduced to the attributes this model carries. */
export function selectBest(routes: BgpRoute[]): BgpRoute {
  return [...routes].sort((x, y) => {
    if (y.localPref !== x.localPref) return y.localPref - x.localPref
    if (x.asPath.length !== y.asPath.length) return x.asPath.length - y.asPath.length
    if (x.med !== y.med) return x.med - y.med
    if (x.exitCost !== y.exitCost) return x.exitCost - y.exitCost
    if (x.source !== y.source) return order(x.source) - order(y.source)
    return (x.peer ?? '').localeCompare(y.peer ?? '')
  })[0]!
}

function order(source: BgpRoute['source']): number {
  return source === 'local' ? 0 : source === 'ebgp' ? 1 : 2
}

function sameRoute(a: BgpRoute, b: BgpRoute): boolean {
  return (
    a.source === b.source &&
    a.peer === b.peer &&
    a.localPref === b.localPref &&
    a.med === b.med &&
    a.asPath.join(',') === b.asPath.join(',')
  )
}

function structuredCloneRoutes(best: Record<string, Record<string, BgpRoute>>) {
  const out: Record<string, Record<string, BgpRoute>> = {}
  for (const [router, table] of Object.entries(best)) {
    out[router] = {}
    for (const [dest, route] of Object.entries(table)) out[router]![dest] = { ...route, asPath: [...route.asPath] }
  }
  return out
}

/** Cheapest path inside one AS only — the IGP that BGP uses to pick an exit. */
export function intraAsCost(topology: Topology, from: string, to: string, asOfId?: Map<string, number | undefined>): number {
  const ownAs = asOfId?.get(from) ?? asOf(topology, from)
  if (ownAs === undefined) return Infinity
  const asMap: Map<string, number | undefined> = asOfId ?? new Map(topology.nodes.map((n) => [n.id, n.asNumber]))
  const dist: Record<string, number> = { [from]: 0 }
  const visited = new Set<string>()
  for (;;) {
    let current: string | null = null
    for (const [id, cost] of Object.entries(dist)) {
      if (visited.has(id)) continue
      if (current === null || cost < dist[current]!) current = id
    }
    if (current === null) break
    if (current === to) return dist[current]!
    visited.add(current)
    for (const entry of adjacency(topology, current)) {
      if (asMap.get(entry.peer.id) !== ownAs) continue
      const through = dist[current]! + effectiveCost(entry.link)
      if (dist[entry.peer.id] === undefined || through < dist[entry.peer.id]!) dist[entry.peer.id] = through
    }
  }
  return dist[to] ?? Infinity
}

/** IGP next hop inside the AS towards an exit-point router. */
export function nextHopTowards(topology: Topology, from: string, target: string, asOfId?: Map<string, number | undefined>): string | null {
  if (from === target) return target
  const ownAs = asOfId?.get(from) ?? asOf(topology, from)
  const asMap: Map<string, number | undefined> = asOfId ?? new Map(topology.nodes.map((n) => [n.id, n.asNumber]))
  let bestNext: string | null = null
  let bestCost = Infinity
  for (const entry of adjacency(topology, from)) {
    if (asMap.get(entry.peer.id) !== ownAs) continue
    const cost = effectiveCost(entry.link) + intraAsCost(topology, entry.peer.id, target, asMap)
    if (cost < bestCost) {
      bestCost = cost
      bestNext = entry.peer.id
    }
  }
  return bestNext
}

export function bgpForwardingTable(topology: Topology, router: string, result: BgpResult): ForwardingTable {
  const table = result.best[router] ?? {}
  const entries: ForwardingEntry[] = []
  for (const [dest, route] of Object.entries(table)) {
    if (dest === router || !route.nextHop) continue
    const link = usableDirectLink(topology, router, route.nextHop)
    entries.push({
      dest,
      destLabel: nodeById(topology, dest)?.label ?? dest,
      destPrefix: prefixOf(topology, dest),
      nextHop: route.nextHop,
      nextHopLabel: nodeById(topology, route.nextHop)?.label ?? route.nextHop,
      cost: route.med + route.exitCost,
      outLink: link?.id ?? '',
      outLinkLabel: link ? `${nodeById(topology, link.a)?.label}–${nodeById(topology, link.b)?.label}` : '',
      hops: route.asPath.length,
    })
  }
  entries.sort((a, b) => a.destLabel.localeCompare(b.destLabel))
  return { routerId: router, algorithm: 'bgp', entries }
}

function usableDirectLink(topology: Topology, a: string, b: string): NetLink | null {
  const found = topology.links
    .filter((l) => isUsable(l) && ((l.a === a && l.b === b) || (l.a === b && l.b === a)))
    .sort((x, y) => effectiveCost(x) - effectiveCost(y))[0]
  return found ?? null
}

function label(topology: Topology, id: string): string {
  return nodeById(topology, id)?.label ?? id
}
