import { adjacency, effectiveCost, nodeById } from '../graph'
import type { ForwardingEntry, ForwardingTable, NetLink, Topology } from '../types'

export interface DijkstraStep {
  round: number
  settled: string
  /** Distances after this round, node id -> cost (Infinity for unreached). */
  distances: Record<string, number>
  predecessors: Record<string, string | null>
  /** Links relaxed from the settled node during this round. */
  relaxations: Relaxation[]
  note: string
}

export interface Relaxation {
  via: string
  to: string
  linkId: string
  oldCost: number
  newCost: number
  improved: boolean
}

export interface LinkStateResult {
  source: string
  /** Final shortest-path cost from source to every node. */
  cost: Record<string, number>
  /** Previous node on the shortest path (null for source / unreachable). */
  prev: Record<string, string | null>
  /** Node that owns the route: first hop out of the source equals this for direct paths. */
  order: string[]
  steps: DijkstraStep[]
  /** Edges of the shortest-path tree. */
  treeLinks: string[]
}

/**
 * Dijkstra over the usable links of a topology. Deterministic: candidate nodes
 * are broken ties by label then id, so the settled order is reproducible.
 */
export function dijkstra(topology: Topology, source: string): LinkStateResult {
  const dist: Record<string, number> = {}
  const prev: Record<string, string | null> = {}
  const settled = new Set<string>()
  const steps: DijkstraStep[] = []
  const treeLinks: string[] = []

  for (const node of topology.nodes) {
    dist[node.id] = Infinity
    prev[node.id] = null
  }
  if (source in dist) dist[source] = 0

  let round = 0
  while (settled.size < topology.nodes.length) {
    const candidate = topology.nodes
      .filter((n) => !settled.has(n.id) && Number.isFinite(dist[n.id]))
      .sort((a, b) => dist[a.id] - dist[b.id] || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))[0]
    if (!candidate) break

    round += 1
    settled.add(candidate.id)
    const relaxations: Relaxation[] = []
    for (const entry of adjacency(topology, candidate.id)) {
      const weight = effectiveCost(entry.link)
      const through = dist[candidate.id] + weight
      const old = dist[entry.peer.id]
      if (settled.has(entry.peer.id)) {
        relaxations.push({ via: candidate.id, to: entry.peer.id, linkId: entry.link.id, oldCost: old, newCost: through, improved: false })
        continue
      }
      const improved = through < old
      if (improved) {
        dist[entry.peer.id] = through
        prev[entry.peer.id] = candidate.id
        treeLinks.push(entry.link.id)
      }
      relaxations.push({ via: candidate.id, to: entry.peer.id, linkId: entry.link.id, oldCost: old, newCost: through, improved })
    }
    steps.push({
      round,
      settled: candidate.id,
      distances: { ...dist },
      predecessors: { ...prev },
      relaxations,
      note:
        relaxations.filter((r) => r.improved).length > 0
          ? `Settled ${candidate.label} at cost ${dist[candidate.id]}; improved ${relaxations.filter((r) => r.improved).length} neighbour distance(s).`
          : `Settled ${candidate.label} at cost ${dist[candidate.id]}; no neighbour distance improved.`,
    })
  }

  return {
    source,
    cost: dist,
    prev,
    order: steps.map((s) => s.settled),
    steps,
    treeLinks: [...new Set(treeLinks)],
  }
}

/**
 * First hop out of `owner` towards `dest`, derived from the shortest-path tree.
 * Returns null when `dest` is the owner itself or unreachable.
 */
export function nextHopFrom(_topology: Topology, sp: LinkStateResult, owner: string, dest: string): string | null {
  if (owner === dest) return null
  let cursor = dest
  const guard = new Set<string>()
  while (true) {
    const parent = sp.prev[cursor]
    if (parent === undefined || parent === null) return Number.isFinite(sp.cost[cursor]) ? null : null
    if (parent === owner) return cursor
    if (guard.has(cursor)) return null
    guard.add(cursor)
    cursor = parent
  }
}

/** The link `owner` uses to send towards `nextHopId` (cheapest direct link). */
export function outLinkFor(topology: Topology, owner: string, nextHopId: string): NetLink | undefined {
  return adjacency(topology, owner)
    .filter((a) => a.peer.id === nextHopId)
    .sort((x, y) => effectiveCost(x.link) - effectiveCost(y.link))
    .map((a) => a.link)[0]
}

export function hopCount(_topology: Topology, sp: LinkStateResult, dest: string): number {
  if (sp.cost[dest] === undefined || !Number.isFinite(sp.cost[dest])) return Infinity
  let hops = 0
  let cursor = dest
  const guard = new Set<string>()
  while (cursor !== sp.source) {
    const parent = sp.prev[cursor]
    if (!parent || guard.has(cursor)) return Infinity
    guard.add(cursor)
    cursor = parent
    hops += 1
  }
  return hops
}

/**
 * Build the forwarding table a router would install from a link-state run.
 * `owner` must be the Dijkstra source; for other routers pass their own run.
 */
export function linkStateForwardingTable(topology: Topology, owner: string, sp: LinkStateResult): ForwardingTable {
  const entries: ForwardingEntry[] = []
  for (const node of topology.nodes) {
    if (node.id === owner) continue
    const cost = sp.cost[node.id]
    if (cost === undefined || !Number.isFinite(cost)) continue
    const nextHop = nextHopFrom(topology, sp, owner, node.id)
    if (!nextHop) continue
    const link = outLinkFor(topology, owner, nextHop)
    entries.push({
      dest: node.id,
      destLabel: node.label,
      destPrefix: prefixOf(topology, node.id),
      nextHop,
      nextHopLabel: nodeById(topology, nextHop)?.label ?? nextHop,
      cost,
      outLink: link?.id ?? '',
      outLinkLabel: link ? linkLabel(topology, link) : '',
      hops: hopCount(topology, sp, node.id),
    })
  }
  entries.sort((a, b) => a.destLabel.localeCompare(b.destLabel) || a.dest.localeCompare(b.dest))
  return { routerId: owner, algorithm: 'link-state', entries }
}

function linkLabel(topology: Topology, link: NetLink): string {
  const a = nodeById(topology, link.a)
  const b = nodeById(topology, link.b)
  return `${a?.label ?? link.a}–${b?.label ?? link.b}`
}

export function prefixOf(topology: Topology, nodeId: string): string {
  const node = nodeById(topology, nodeId)
  if (!node?.ip) return `net:${node?.label ?? nodeId}`
  const prefix = node.prefix ?? 24
  return `${networkAddressOf(node.ip, prefix)}/${prefix}`
}

/** Network address of an IPv4 dotted-quad (kept local so core has no import cycle). */
export function networkAddressOf(ip: string, prefix: number): string {
  const parts = ip.split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) return ip
  const value = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  const network = (value & mask) >>> 0
  return [(network >>> 24) & 255, (network >>> 16) & 255, (network >>> 8) & 255, network & 255].join('.')
}
