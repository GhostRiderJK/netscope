import { adjacency, directLink, effectiveCost, nodeById } from './graph'
import type { ForwardingEntry, ForwardingTable, NetLink, RoutingAlgorithm, Topology } from './types'
import { prefixOf } from './algorithms/linkState'
import { dijkstra, linkStateForwardingTable, nextHopFrom, type LinkStateResult } from './algorithms/linkState'
import {
  DEFAULT_DV_OPTIONS,
  RIP_OPTIONS,
  dvForwardingTable,
  dvRoute,
  runDistanceVector,
  type DvOptions,
  type DvResult,
} from './algorithms/distanceVector'
import { runOspf, type OspfResult } from './algorithms/ospf'
import { bgpForwardingTable, runBgp, type BgpResult, type BgpRoute } from './algorithms/bgp'

export interface HopDecision {
  router: string
  dest: string
  nextHop: string | null
  cost: number
  tableEntry: ForwardingEntry | null
  rationale: string
}

/**
 * One routing "brain" over a snapshot of a topology. All five Chapter 4
 * algorithms are computed from the graph here — no hardcoded answers.
 */
export class RoutingEngine {
  readonly topology: Topology
  readonly algorithm: RoutingAlgorithm
  readonly dv: DvResult | null
  readonly ospf: OspfResult | null
  readonly bgp: BgpResult | null
  private readonly lsCache: Record<string, LinkStateResult> = {}

  constructor(topology: Topology, algorithm: RoutingAlgorithm, dvOptions?: Partial<DvOptions>) {
    this.topology = topology
    this.algorithm = algorithm
    if (algorithm === 'distance-vector' || algorithm === 'rip') {
      const base = algorithm === 'rip' ? RIP_OPTIONS : DEFAULT_DV_OPTIONS
      this.dv = runDistanceVector({ topology, options: { ...base, ...dvOptions } })
    } else {
      this.dv = null
    }
    this.ospf = algorithm === 'ospf' ? runOspf(topology) : null
    this.bgp = algorithm === 'bgp' ? runBgp(topology) : null
  }

  linkStateFor(router: string): LinkStateResult {
    this.lsCache[router] ??= dijkstra(this.topology, router)
    return this.lsCache[router]!
  }

  forwardingTable(router: string): ForwardingTable {
    switch (this.algorithm) {
      case 'link-state':
        return linkStateForwardingTable(this.topology, router, this.linkStateFor(router))
      case 'ospf':
        return this.ospf?.perRouter[router]?.forwardingTable ?? { routerId: router, algorithm: 'ospf', entries: [] }
      case 'distance-vector':
      case 'rip':
        return this.dv ? dvForwardingTable(this.topology, router, this.dv) : { routerId: router, algorithm: this.algorithm, entries: [] }
      case 'bgp':
        return this.bgp ? bgpForwardingTable(this.topology, router, this.bgp) : { routerId: router, algorithm: 'bgp', entries: [] }
    }
  }

  /** The forwarding decision a router makes for a destination. */
  decide(router: string, dest: string): HopDecision {
    const table = this.forwardingTable(router)
    const entry = table.entries.find((e) => e.dest === dest) ?? null
    if (entry) {
      return { router, dest, nextHop: entry.nextHop, cost: entry.cost, tableEntry: entry, rationale: this.rationale(entry, router) }
    }

    const link = usableDirect(this.topology, router, dest)
    if (link) {
      const synthetic: ForwardingEntry = {
        dest,
        destLabel: nodeById(this.topology, dest)?.label ?? dest,
        destPrefix: prefixOf(this.topology, dest),
        nextHop: dest,
        nextHopLabel: nodeById(this.topology, dest)?.label ?? dest,
        cost: effectiveCost(link),
        outLink: link.id,
        outLinkLabel: linkName(this.topology, link),
        hops: 1,
      }
      return {
        router,
        dest,
        nextHop: dest,
        cost: synthetic.cost,
        tableEntry: synthetic,
        rationale: `${label(this.topology, router)} has ${label(this.topology, dest)} on the directly attached link ${linkName(this.topology, link)} (cost ${effectiveCost(link)}), so it delivers locally instead of forwarding onward.`,
      }
    }

    return {
      router,
      dest,
      nextHop: null,
      cost: Infinity,
      tableEntry: null,
      rationale: `${label(this.topology, router)} has no entry for ${prefixOf(this.topology, dest)} — the destination is unreachable under ${this.algorithm} routing from this router.`,
    }
  }

  private rationale(entry: ForwardingEntry, router: string): string {
    if (this.algorithm === 'bgp') {
      const route: BgpRoute | undefined = this.bgp?.best[router]?.[entry.dest]
      if (!route) return `BGP has no route for ${entry.destPrefix} at ${label(this.topology, router)}.`
      return `${label(this.topology, router)} chose ${entry.destPrefix} via ${entry.nextHopLabel}: ${route.reason} AS_PATH [${route.asPath.join(' ') || 'local'}], LOCAL_PREF ${route.localPref}, MED ${route.med}, IGP exit cost ${route.exitCost}.`
    }
    if (this.algorithm === 'distance-vector' || this.algorithm === 'rip') {
      const cell = this.dv ? dvRoute(this.dv, router, entry.dest) : null
      return `${label(this.topology, router)} only knows what its neighbours advertised: the smallest Bellman–Ford value for ${entry.destPrefix} is ${cell?.cost ?? entry.cost}, so it installs ${entry.nextHopLabel}. It never sees the whole path.`
    }
    const sp = this.linkStateFor(router)
    const path = treePath(this.topology, sp.prev, router, entry.dest)
    return `${label(this.topology, router)} runs SPF over its link-state database. The tree reaches ${entry.destPrefix} at total cost ${entry.cost} along ${path.join(' → ')}, so the first hop is ${entry.nextHopLabel}.`
  }
}

function treePath(topology: Topology, prev: Record<string, string | null>, from: string, to: string): string[] {
  const ids = [to]
  let cursor = to
  const guard = new Set<string>()
  while (cursor !== from && !guard.has(cursor)) {
    guard.add(cursor)
    const parent = prev[cursor]
    if (!parent) break
    ids.unshift(parent)
    cursor = parent
  }
  return ids.map((id) => label(topology, id))
}

export function usableDirect(topology: Topology, a: string, b: string): NetLink | null {
  const viaAdjacency = adjacency(topology, a).find((x) => x.peer.id === b)?.link
  return viaAdjacency ?? directLink(topology, a, b) ?? null
}

export function linkName(topology: Topology, link: NetLink): string {
  return `${nodeById(topology, link.a)?.label ?? link.a}–${nodeById(topology, link.b)?.label ?? link.b}`
}

export function label(topology: Topology, id: string): string {
  return nodeById(topology, id)?.label ?? id
}

export { nextHopFrom, dijkstra, runDistanceVector, runOspf, runBgp }
export type { DvOptions, DvResult, OspfResult, BgpResult, LinkStateResult }
