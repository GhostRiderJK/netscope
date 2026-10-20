import { adjacency, effectiveCost, isUsable, nodeById } from '../graph'
import type { ForwardingTable, Topology } from '../types'
import { dijkstra, linkStateForwardingTable, type LinkStateResult } from './linkState'

/**
 * Educational OSPF: every router originates a router LSA describing its usable
 * links, LSAs are flooded through the area until all routers hold the same
 * link-state database, and each router then runs the identical SPF (Dijkstra).
 *
 * Simplified on purpose — single area, no hello/DR election, no LSA types 2/3/7,
 * no authentication or timer model.
 */

export interface OspfRouterLsa {
  advertisingRouter: string
  routerLabel: string
  area: string
  /** Real OSPF starts router LSAs at 0x80000001 and increments on refresh. */
  seq: number
  links: { to: string; toLabel: string; cost: number; mtu: number; stub: boolean }[]
}

export interface OspfFloodEvent {
  round: number
  origin: string
  from: string
  to: string[]
  note: string
}

export interface OspfLsaRecord {
  lsa: OspfRouterLsa
  /** Rounds of flooding needed before every reachable router held this LSA. */
  spreadRounds: number
  holders: string[]
  complete: boolean
}

export interface OspfRouterView {
  routerId: string
  spf: LinkStateResult
  forwardingTable: ForwardingTable
}

export interface OspfResult {
  area: string
  records: OspfLsaRecord[]
  flooding: OspfFloodEvent[]
  rounds: number
  lsdbSize: number
  syncedRouters: string[]
  /** True when every router ended up with the identical database. */
  databasesMatch: boolean
  perRouter: Record<string, OspfRouterView>
  routerRouterEdges: { a: string; b: string; cost: number }[]
}

export function runOspf(topology: Topology): OspfResult {
  const routers = topology.nodes.filter((n) => n.kind === 'router')
  const routerIds = routers.map((r) => r.id)
  const routerSet = new Set(routerIds)

  const lsas: OspfRouterLsa[] = routers.map((router, i) => ({
    advertisingRouter: router.id,
    routerLabel: router.label,
    area: '0.0.0.0',
    seq: 0x80000001 + i,
    links: adjacency(topology, router.id).map((a) => ({
      to: a.peer.id,
      toLabel: a.peer.label,
      cost: effectiveCost(a.link),
      mtu: a.link.mtu,
      stub: a.peer.kind !== 'router',
    })),
  }))

  const holders: Record<string, Set<string>> = {}
  for (const origin of routerIds) holders[origin] = new Set([origin])

  const flooding: OspfFloodEvent[] = []
  const spreadRounds: Record<string, number> = Object.fromEntries(routerIds.map((id) => [id, 0]))
  let round = 0
  for (;;) {
    round += 1
    if (round > routerIds.length + 2) break
    let progressed = false
    for (const origin of routerIds) {
      const snapshot = [...holders[origin]!].sort()
      const targets = new Map<string, string[]>()
      for (const holder of snapshot) {
        const forward = adjacency(topology, holder)
          .filter((a) => routerSet.has(a.peer.id) && !holders[origin]!.has(a.peer.id))
          .map((a) => a.peer.id)
        for (const target of forward) {
          holders[origin]!.add(target)
          targets.set(holder, [...(targets.get(holder) ?? []), target])
          progressed = true
        }
      }
      for (const [from, to] of targets) {
        const unique = [...new Set(to)].sort()
        flooding.push({
          round,
          origin,
          from,
          to: unique,
          note: `${label(topology, from)} forwards the LSA from ${label(topology, origin)} to ${unique
            .map((t) => label(topology, t))
            .join(', ')}.`,
        })
        spreadRounds[origin] = Math.max(spreadRounds[origin]!, round)
      }
    }
    if (!progressed) break
  }

  const records: OspfLsaRecord[] = lsas.map((lsa) => ({
    lsa,
    spreadRounds: spreadRounds[lsa.advertisingRouter] ?? 0,
    holders: [...(holders[lsa.advertisingRouter] ?? [])].sort(),
    complete: (holders[lsa.advertisingRouter]?.size ?? 0) === routerIds.length,
  }))

  const syncedRouters = routerIds.filter((id) => records.every((r) => r.holders.includes(id)))
  const databasesMatch = syncedRouters.length === routerIds.length && records.every((r) => r.complete)

  const perRouter: Record<string, OspfRouterView> = {}
  for (const router of routers) {
    const spf = dijkstra(topology, router.id)
    const table = linkStateForwardingTable(topology, router.id, spf)
    perRouter[router.id] = {
      routerId: router.id,
      spf,
      forwardingTable: { ...table, algorithm: 'ospf' },
    }
  }

  return {
    area: '0.0.0.0',
    records,
    flooding,
    rounds: Math.max(0, round - 1),
    lsdbSize: lsas.length,
    syncedRouters,
    databasesMatch,
    perRouter,
    routerRouterEdges: adjacencyFromLsdb(lsas),
  }
}

function label(topology: Topology, id: string): string {
  return nodeById(topology, id)?.label ?? id
}

/** Router-to-router edges reconstructed from the flooded LSAs, as OSPF would. */
export function adjacencyFromLsdb(records: OspfRouterLsa[]): { a: string; b: string; cost: number }[] {
  const edges = new Map<string, { a: string; b: string; cost: number }>()
  for (const lsa of records) {
    for (const link of lsa.links) {
      if (link.stub) continue
      const pair = [lsa.advertisingRouter, link.to].sort()
      const key = pair.join('~')
      const candidate = { a: pair[0]!, b: pair[1]!, cost: link.cost }
      const existing = edges.get(key)
      if (!existing || candidate.cost < existing.cost) edges.set(key, candidate)
    }
  }
  return [...edges.values()].sort((x, y) => x.cost - y.cost || x.a.localeCompare(y.a))
}

export function hasUsableLink(topology: Topology, id: string): boolean {
  return topology.links.some((l) => isUsable(l) && (l.a === id || l.b === id))
}
