import type { NetLink, NetNode, Topology } from './types'

export interface Adjacency {
  nodeId: string
  link: NetLink
  peer: NetNode
}

export function nodeById(topology: Topology, id: string): NetNode | undefined {
  return topology.nodes.find((n) => n.id === id)
}

export function linkById(topology: Topology, id: string): NetLink | undefined {
  return topology.links.find((l) => l.id === id)
}

export function linkEndpoints(topology: Topology, linkId: string): [NetNode, NetNode] | null {
  const link = linkById(topology, linkId)
  if (!link) return null
  const a = nodeById(topology, link.a)
  const b = nodeById(topology, link.b)
  if (!a || !b) return null
  return [a, b]
}

export function otherEnd(link: NetLink, nodeId: string): string | null {
  if (link.a === nodeId) return link.b
  if (link.b === nodeId) return link.a
  return null
}

/** Links usable for routing: active or congested (congested costs more but exists). */
export function isUsable(link: NetLink): boolean {
  return link.status !== 'failed'
}

/**
 * Effective metric used by routing algorithms. A congested link still carries
 * traffic but with a penalty, so a packet can legitimately prefer a longer
 * physical path over a congested one.
 */
export const CONGESTION_PENALTY = 10

export function effectiveCost(link: NetLink): number {
  return link.status === 'congested' ? link.cost + CONGESTION_PENALTY : link.cost
}

export function adjacency(topology: Topology, nodeId: string): Adjacency[] {
  const out: Adjacency[] = []
  for (const link of topology.links) {
    if (!isUsable(link)) continue
    const peerId = otherEnd(link, nodeId)
    if (!peerId) continue
    const peer = nodeById(topology, peerId)
    if (!peer) continue
    out.push({ nodeId, link, peer })
  }
  return out.sort((x, y) => x.peer.id.localeCompare(y.peer.id))
}

export function routersOf(topology: Topology): NetNode[] {
  return topology.nodes.filter((n) => n.kind === 'router')
}

export function hostsOf(topology: Topology): NetNode[] {
  return topology.nodes.filter((n) => n.kind !== 'router')
}

/** Autonomous systems present in the topology, sorted. */
export function autonomousSystems(topology: Topology): number[] {
  const set = new Set<number>()
  for (const n of topology.nodes) {
    if (n.kind === 'router' && n.asNumber !== undefined) set.add(n.asNumber)
  }
  return [...set].sort((a, b) => a - b)
}

export function asOfNode(topology: Topology, nodeId: string): number | undefined {
  return nodeById(topology, nodeId)?.asNumber
}

export interface TopologyIssue {
  level: 'error' | 'warning'
  message: string
  nodeId?: string
  linkId?: string
}

/** Structural validation used by the editor before a simulation may run. */
export function validateTopology(topology: Topology): TopologyIssue[] {
  const issues: TopologyIssue[] = []
  const ids = new Set<string>()
  for (const node of topology.nodes) {
    if (ids.has(node.id)) {
      issues.push({ level: 'error', message: `Duplicate node id "${node.id}".`, nodeId: node.id })
    }
    ids.add(node.id)
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      issues.push({ level: 'error', message: `${node.label} has no valid canvas position.`, nodeId: node.id })
    }
  }
  const linkIds = new Set<string>()
  for (const link of topology.links) {
    if (linkIds.has(link.id)) {
      issues.push({ level: 'error', message: `Duplicate link id "${link.id}".`, linkId: link.id })
    }
    linkIds.add(link.id)
    if (!ids.has(link.a) || !ids.has(link.b)) {
      issues.push({ level: 'error', message: `Link ${link.id} references a missing node.`, linkId: link.id })
      continue
    }
    if (link.a === link.b) {
      issues.push({ level: 'error', message: `${link.id} is a self-loop; drop it.`, linkId: link.id })
    }
    if (link.cost < 1 || !Number.isInteger(link.cost)) {
      issues.push({ level: 'error', message: `Link ${link.id} cost must be a positive integer.`, linkId: link.id })
    }
    if (link.mtu < 128 || link.mtu > 65535) {
      issues.push({ level: 'warning', message: `Link ${link.id} MTU ${link.mtu} is outside 128..65535 bytes.`, linkId: link.id })
    }
  }
  const seenPairs = new Set<string>()
  for (const link of topology.links) {
    const pairKey = [link.a, link.b].sort().join('~')
    if (seenPairs.has(pairKey)) {
      issues.push({ level: 'warning', message: `Parallel link ${link.a}–${link.b}: routing only sees the cheapest one.`, linkId: link.id })
    }
    seenPairs.add(pairKey)
  }

  for (const node of hostsOf(topology)) {
    const neighbours = topology.links
      .filter((l) => isUsable(l) && (l.a === node.id || l.b === node.id))
      .map((l) => otherEnd(l, node.id))
    if (neighbours.length === 0) {
      issues.push({ level: 'warning', message: `${node.label} is not connected to any link.`, nodeId: node.id })
    }
    if (node.gateway === undefined && neighbours.length > 0) {
      issues.push({ level: 'warning', message: `${node.label} has no default gateway, so it can only reach its own subnet.`, nodeId: node.id })
    }
  }

  // Reachability components over usable links.
  for (const component of connectedComponents(topology)) {
    if (component.length < 2) {
      const node = nodeById(topology, component[0] ?? '')
      if (node) issues.push({ level: 'warning', message: `${node.label} is isolated (no usable links).`, nodeId: node.id })
    }
  }
  return dedupeIssues(issues)
}

function dedupeIssues(issues: TopologyIssue[]): TopologyIssue[] {
  const seen = new Set<string>()
  const out: TopologyIssue[] = []
  for (const issue of issues) {
    const key = `${issue.level}|${issue.message}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(issue)
  }
  return out
}

/** Connected components over usable links (includes hosts). */
export function connectedComponents(topology: Topology): string[][] {
  const seen = new Set<string>()
  const components: string[][] = []
  for (const node of topology.nodes) {
    if (seen.has(node.id)) continue
    const stack = [node.id]
    const group: string[] = []
    seen.add(node.id)
    while (stack.length > 0) {
      const current = stack.pop() as string
      group.push(current)
      for (const link of topology.links) {
        if (!isUsable(link)) continue
        const peer = otherEnd(link, current)
        if (peer && !seen.has(peer)) {
          seen.add(peer)
          stack.push(peer)
        }
      }
    }
    components.push(group.sort())
  }
  return components.sort((a, b) => b.length - a.length)
}

export function reachable(topology: Topology, from: string, to: string): boolean {
  if (from === to) return true
  const seen = new Set([from])
  const stack = [from]
  while (stack.length > 0) {
    const current = stack.pop() as string
    for (const entry of adjacency(topology, current)) {
      if (seen.has(entry.peer.id)) continue
      if (entry.peer.id === to) return true
      seen.add(entry.peer.id)
      stack.push(entry.peer.id)
    }
  }
  return false
}

/** Cheapest usable direct link between two nodes, if any. */
export function directLink(topology: Topology, a: string, b: string): NetLink | undefined {
  return topology.links
    .filter((l) => isUsable(l) && samePair(l, a, b))
    .sort((x, y) => effectiveCost(x) - effectiveCost(y))[0]
}

function samePair(link: NetLink, a: string, b: string): boolean {
  return (link.a === a && link.b === b) || (link.a === b && link.b === a)
}

export function linkLabel(topology: Topology, link: NetLink): string {
  const a = nodeById(topology, link.a)
  const b = nodeById(topology, link.b)
  return `${a?.label ?? link.a}–${b?.label ?? link.b}`
}
