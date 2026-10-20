import { isUsable, nodeById } from '../graph'
import type { ForwardingEntry, ForwardingTable, NetLink, RoutingAlgorithm, Topology } from '../types'
import { prefixOf } from './linkState'

export type DvMetric = 'cost' | 'hops'

export interface DvOptions {
  metric: DvMetric
  /** Value treated as "infinity" / unreachable. RIP uses 16. */
  infinity: number
  splitHorizon: boolean
  poisonReverse: boolean
  maxRounds: number
}

export const DEFAULT_DV_OPTIONS: DvOptions = {
  metric: 'cost',
  infinity: 99,
  splitHorizon: false,
  poisonReverse: false,
  maxRounds: 60,
}

export const RIP_OPTIONS: DvOptions = {
  metric: 'hops',
  infinity: 16,
  splitHorizon: false,
  poisonReverse: false,
  maxRounds: 60,
}

export interface DvCell {
  cost: number
  nextHop: string | null
}

export type DvTable = Record<string, DvCell>

export interface DvAdvertisement {
  from: string
  to: string
  kind: 'full-vector' | 'split-horizon' | 'poison-reverse'
  entries: Record<string, number>
  suppressed: string[]
}

export interface DvUpdate {
  router: string
  dest: string
  fromCost: number
  toCost: number
  via: string
  note: string
}

export interface DvRound {
  round: number
  advertisements: DvAdvertisement[]
  updates: DvUpdate[]
  tables: Record<string, DvTable>
  converged: boolean
  failedLinks: string[]
}

export interface DvResult {
  algorithm: RoutingAlgorithm
  routers: string[]
  destinations: string[]
  options: DvOptions
  rounds: DvRound[]
  converged: boolean
  convergedAtRound: number | null
  countToInfinitySeen: boolean
  unreachableAfter: string[]
}

export interface DvRunInput {
  topology: Topology
  options?: Partial<DvOptions>
  /** Link ids failed from round 0. */
  failedLinks?: string[]
  /** Link that fails at the start of `afterRound + 1`, to show re-convergence. */
  failure?: { linkId: string; afterRound: number }
  /** Keep simulating past convergence for demos. */
  runRounds?: number
}

/**
 * Synchronous distance-vector iterations: Dx(y) = min over DV neighbours v of
 * { c(x,v) + Dv(y) }, plus the directly-connected-network rule for stub hosts.
 */
export function runDistanceVector(input: DvRunInput): DvResult {
  const topology = input.topology
  const options: DvOptions = { ...DEFAULT_DV_OPTIONS, ...input.options }
  const routers = topology.nodes.filter((n) => n.kind === 'router').map((n) => n.id)
  const destinations = topology.nodes.map((n) => n.id)
  const INF = options.infinity
  const routerSet = new Set(routers)

  let tables: Record<string, DvTable> = {}
  for (const r of routers) {
    const table: DvTable = {}
    for (const d of destinations) {
      if (d === r) table[d] = { cost: 0, nextHop: null }
      else {
        const link = linkBetween(topology, r, d, new Set())
        table[d] = link ? { cost: weight(link, options.metric), nextHop: d } : { cost: INF, nextHop: null }
      }
    }
    tables[r] = table
  }

  const staticFailed = new Set(input.failedLinks ?? [])
  const rounds: DvRound[] = [
    { round: 0, advertisements: [], updates: [], tables: cloneTables(tables), converged: false, failedLinks: [...staticFailed] },
  ]
  let converged = false
  let convergedAtRound: number | null = null
  let failureApplied = false
  let countToInfinitySeen = false

  for (let round = 1; round <= options.maxRounds; round += 1) {
    const failed = new Set(staticFailed)
    if (input.failure && round > input.failure.afterRound) {
      failed.add(input.failure.linkId)
      failureApplied = true
    }

    const advertisements: DvAdvertisement[] = []
    const received: Record<string, Record<string, Record<string, number>>> = {}
    for (const r of routers) received[r] = {}

    for (const r of routers) {
      for (const neighbour of dvNeighbours(topology, r, failed, routerSet)) {
        const entries: Record<string, number> = {}
        const suppressed: string[] = []
        for (const d of destinations) {
          const cell = tables[r]![d]!
          const hides = cell.nextHop === neighbour && d !== r
          if (hides && (options.splitHorizon || options.poisonReverse)) {
            suppressed.push(d)
            if (options.poisonReverse) entries[d] = INF
            continue
          }
          entries[d] = cell.cost
        }
        const kind: DvAdvertisement['kind'] = suppressed.length
          ? options.poisonReverse
            ? 'poison-reverse'
            : 'split-horizon'
          : 'full-vector'
        advertisements.push({ from: r, to: neighbour, kind, entries, suppressed })
        received[neighbour]![r] = entries
      }
    }

    const updates: DvUpdate[] = []
    const next: Record<string, DvTable> = {}
    for (const r of routers) {
      const table: DvTable = {}
      for (const d of destinations) {
        let bestCost = INF
        let bestVia: string | null = null

        for (const neighbour of dvNeighbours(topology, r, failed, routerSet)) {
          const advertised = received[r]?.[neighbour]?.[d]
          if (advertised === undefined) continue
          const link = linkBetween(topology, r, neighbour, failed)
          if (!link) continue
          if (advertised >= INF) continue
          const through = weight(link, options.metric) + advertised
          if (through < bestCost) {
            bestCost = Math.min(through, INF)
            bestVia = neighbour
          }
        }

        // Directly attached network / host stub.
        const own = linkBetween(topology, r, d, failed)
        if (own && weight(own, options.metric) < bestCost) {
          bestCost = Math.min(weight(own, options.metric), INF)
          bestVia = d
        }

        const proposed: DvCell = bestCost >= INF || d === r ? (d === r ? { cost: 0, nextHop: null } : { cost: INF, nextHop: null }) : { cost: bestCost, nextHop: bestVia }
        const old = tables[r]![d]!
        if (proposed.cost !== old.cost || proposed.nextHop !== old.nextHop) {
          updates.push({
            router: r,
            dest: d,
            fromCost: old.cost,
            toCost: proposed.cost,
            via: proposed.nextHop ?? '-',
            note: describeUpdate(r, d, old, proposed, topology, options),
          })
          if (failureApplied && old.cost < INF && proposed.cost > old.cost && proposed.cost < INF) countToInfinitySeen = true
        }
        table[d] = proposed
      }
      next[r] = table
    }

    tables = next
    const changed = updates.length > 0
    rounds.push({ round, advertisements, updates, tables: cloneTables(tables), converged: !changed, failedLinks: [...failed] })
    if (!changed) {
      converged = true
      convergedAtRound = round
      if (input.runRounds === undefined || round >= input.runRounds) break
    } else if (input.runRounds !== undefined && round >= input.runRounds) {
      break
    }
  }

  const finalTables = rounds.at(-1)!.tables
  const unreachableAfter = destinations.filter((d) =>
    routers.every((r) => (finalTables[r]?.[d]?.cost ?? INF) >= INF)
  )

  return {
    algorithm: options.metric === 'hops' ? 'rip' : 'distance-vector',
    routers,
    destinations,
    options,
    rounds,
    converged,
    convergedAtRound,
    countToInfinitySeen,
    unreachableAfter,
  }
}

function describeUpdate(
  router: string,
  dest: string,
  old: DvCell,
  next: DvCell,
  topology: Topology,
  options: DvOptions
): string {
  const r = nodeById(topology, router)?.label ?? router
  const d = nodeById(topology, dest)?.label ?? dest
  const via = next.nextHop ? nodeById(topology, next.nextHop)?.label ?? next.nextHop : 'none'
  const unit = options.metric === 'hops' ? 'hops' : 'cost'
  if (old.cost < options.infinity && next.cost >= options.infinity) {
    return `${r}: route to ${d} withdrawn (was ${old.cost} ${unit}).`
  }
  if (next.cost > old.cost) return `${r}: route to ${d} worsened ${old.cost} → ${next.cost} ${unit} via ${via}.`
  if (next.cost < old.cost) return `${r}: route to ${d} improved ${old.cost} → ${next.cost} ${unit} via ${via}.`
  return `${r}: next hop for ${d} changed to ${via} at equal ${unit}.`
}

function weight(link: NetLink, metric: DvMetric): number {
  return metric === 'hops' ? 1 : link.cost
}

function linkBetween(topology: Topology, a: string, b: string, failed: Set<string>): NetLink | null {
  const candidates = topology.links
    .filter((l) => isUsable(l) && !failed.has(l.id) && ((l.a === a && l.b === b) || (l.a === b && l.b === a)))
    .sort((x, y) => x.cost - y.cost)
  return candidates[0] ?? null
}

/** Distance-vector peers: usable neighbours that also run the protocol. */
function dvNeighbours(topology: Topology, nodeId: string, failed: Set<string>, routerSet: Set<string>): string[] {
  const out: string[] = []
  for (const link of topology.links) {
    if (!isUsable(link) || failed.has(link.id)) continue
    const peer = link.a === nodeId ? link.b : link.b === nodeId ? link.a : null
    if (peer && routerSet.has(peer)) out.push(peer)
  }
  return [...new Set(out)].sort()
}

function cloneTables(tables: Record<string, DvTable>): Record<string, DvTable> {
  const out: Record<string, DvTable> = {}
  for (const [router, table] of Object.entries(tables)) {
    const copy: DvTable = {}
    for (const [dest, cell] of Object.entries(table)) copy[dest] = { ...cell }
    out[router] = copy
  }
  return out
}

export function dvForwardingTable(topology: Topology, router: string, result: DvResult): ForwardingTable {
  const table = result.rounds.at(-1)?.tables[router] ?? {}
  const entries: ForwardingEntry[] = []
  for (const [dest, cell] of Object.entries(table)) {
    if (dest === router || cell.cost >= result.options.infinity || !cell.nextHop) continue
    const link = linkBetween(topology, router, cell.nextHop, new Set())
    entries.push({
      dest,
      destLabel: nodeById(topology, dest)?.label ?? dest,
      destPrefix: prefixOf(topology, dest),
      nextHop: cell.nextHop,
      nextHopLabel: nodeById(topology, cell.nextHop)?.label ?? cell.nextHop,
      cost: cell.cost,
      outLink: link?.id ?? '',
      outLinkLabel: link ? `${nodeById(topology, link.a)?.label}–${nodeById(topology, link.b)?.label}` : '',
      hops: cell.cost,
    })
  }
  entries.sort((a, b) => a.destLabel.localeCompare(b.destLabel))
  return { routerId: router, algorithm: result.algorithm, entries }
}

export function dvRoute(result: DvResult, router: string, dest: string): DvCell | null {
  return result.rounds.at(-1)?.tables[router]?.[dest] ?? null
}

/** Per-round cost of reaching one destination from every router — the count-to-infinity chart. */
export function countToInfinityTrace(result: DvResult, dest: string): { round: number; costs: Record<string, number> }[] {
  return result.rounds.map((round) => {
    const costs: Record<string, number> = {}
    for (const router of result.routers) costs[router] = round.tables[router]?.[dest]?.cost ?? result.options.infinity
    return { round: round.round, costs }
  })
}
