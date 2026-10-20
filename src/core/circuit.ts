import { effectiveCost, nodeById } from './graph'
import { RoutingEngine, label, usableDirect } from './routing'
import type { RoutingAlgorithm, Topology } from './types'

/**
 * Module H engine: a virtual-circuit network (per-call state installed at setup
 * time, identifiers swapped at each hop) compared against a datagram network
 * (per-packet destination lookup, tables may change mid-flight).
 */

export interface CircuitForwardingEntry {
  router: string
  routerLabel: string
  incomingLink: string | null
  incomingVci: number
  outgoingLink: string
  outgoingVci: number
  nextHop: string
  nextHopLabel: string
}

export interface CircuitSetup {
  vci: number
  path: string[]
  links: string[]
  cost: number
  entries: CircuitForwardingEntry[]
  events: string[]
  ok: boolean
  failure?: string
}

/**
 * Set up a virtual circuit along the computed forwarding path. Each router
 * stores (incoming link, incoming VCI) → (outgoing link, outgoing VCI); the
 * VCI is re-labelled hop by hop, exactly like Frame Relay / X.25 / ATM.
 */
export function setupVirtualCircuit(
  topology: Topology,
  algorithm: RoutingAlgorithm,
  srcId: string,
  dstId: string,
  startVci = 100
): CircuitSetup {
  const engine = new RoutingEngine(topology, algorithm)
  const events: string[] = []
  const path: string[] = []
  const links: string[] = []
  const entries: CircuitForwardingEntry[] = []
  const src = nodeById(topology, srcId)
  const dst = nodeById(topology, dstId)
  if (!src || !dst) return { vci: startVci, path, links, cost: 0, entries, events: ['Unknown endpoint.'], ok: false, failure: 'Unknown endpoint.' }

  events.push(`${src.label} sends a SETUP request for a virtual circuit to ${dst.label} (global identifier VCI ${startVci}).`)

  const route = walk(topology, engine, src.id, dst.id)
  if (!route.ok) {
    events.push(`Call admission failed: ${route.reason}`)
    return { vci: startVci, path: route.path, links: route.links, cost: 0, entries, events, ok: false, failure: route.reason }
  }

  path.push(...route.path)
  links.push(...route.links)
  events.push(`Call routing picked ${route.path.map((id) => label(topology, id)).join(' → ')} (cost ${route.cost}); the path is now frozen into the switches.`)

  for (let i = 0; i < route.links.length; i += 1) {
    const router = route.path[i]!
    const nextHop = route.path[i + 1]!
    const link = topology.links.find((l) => l.id === route.links[i])!
    const incomingLink = i === 0 ? null : route.links[i - 1]!
    const outgoingVci = startVci + i
    entries.push({
      router,
      routerLabel: label(topology, router),
      incomingLink,
      incomingVci: i === 0 ? startVci : startVci + i - 1,
      outgoingLink: link.id,
      outgoingVci,
      nextHop,
      nextHopLabel: label(topology, nextHop),
    })
    events.push(
      i === 0
        ? `${label(topology, router)} installs an entry: incoming VCI ${startVci} → ${linkLabel(topology, router, nextHop)}, outgoing VCI ${outgoingVci}.`
        : `${label(topology, router)} installs an entry: incoming VCI ${startVci + i - 1} on ${incomingLink ? linkName(topology, incomingLink) : 'the access link'} → outgoing VCI ${outgoingVci}.`
    )
  }
  events.push(`${dst.label} answers with CONNECT. Total one-way cost ${route.cost}. Every router on the path now holds per-call state.`)
  return { vci: startVci, path, links, cost: route.cost, entries, events, ok: true }
}

/** Send N data packets over an established circuit. */
export function sendDataOnCircuit(setup: CircuitSetup, packets = 3): string[] {
  const out: string[] = []
  for (let i = 1; i <= packets; i += 1) {
    const hops = setup.entries.map((e, idx) => `${e.routerLabel}[VCI ${idx === 0 ? setup.vci : setup.vci + idx - 1}→${e.outgoingVci}]`).join(' → ')
    out.push(`Data ${i}: identifier swap along the circuit — ${hops}. No destination lookup happens at any hop.`)
  }
  return out
}

/** Tear the circuit down again. */
export function teardownCircuit(setup: CircuitSetup): string[] {
  return [
    `${setup.entries[0]?.routerLabel ?? 'Ingress'} sends TEARDOWN; each switch deletes its (link, VCI) entry on the way.`,
    'Virtual-circuit state is gone, so a later call must run setup again before any data can flow.',
  ]
}

/** What a link failure does to an established circuit. */
export function failCircuit(topology: Topology, setup: CircuitSetup, linkId: string): { interrupted: boolean; atRouter?: string; note: string } {
  const index = setup.links.indexOf(linkId)
  if (index === -1) {
    return { interrupted: false, note: 'The failed link is not part of this circuit, so the call keeps running on its stored path — the switches never re-consult a routing table.' }
  }
  const atRouter = setup.path[index]!
  const nextRouter = setup.path[index + 1] ?? setup.path.at(-1)!
  return {
    interrupted: true,
    atRouter,
    note: `${linkName(topology, linkId)} carried this circuit, so ${label(topology, atRouter)} has nowhere to send VCI ${setup.vci + index} and the call dies on the spot. ${label(topology, nextRouter)} and everything downstream lose the connection too; recovery needs a fresh SETUP that picks a new path.`,
  }
}

/**
 * Datagram comparison: packets are forwarded independently, so if the routing
 * tables change while the burst is in flight, later packets follow the new
 * table and may overtake or lag behind the earlier ones.
 */
export interface DatagramBurstPacket {
  index: number
  path: string[]
  links: string[]
  cost: number
  /** Simulated arrival time in arbitrary units. */
  arrival: number
  delivered: boolean
  note: string
}

export interface DatagramBurst {
  packets: DatagramBurstPacket[]
  arrivalOrder: number[]
  outOfOrder: boolean
  events: string[]
  disclaimer: string
}

export function sendDatagramBurst(input: {
  topology: Topology
  algorithm: RoutingAlgorithm
  srcId: string
  dstId: string
  packets?: number
  /** Index of the packet after which `linkId` fails, re-running the tables. */
  failLinkId?: string
  failAfterPacket?: number
}): DatagramBurst {
  const topology = input.topology
  const packets = input.packets ?? 3
  const events: string[] = []
  const result: DatagramBurstPacket[] = []
  let activeTopology = topology
  let failAppliedAt: number | null = null

  for (let i = 0; i < packets; i += 1) {
    if (input.failLinkId && i === (input.failAfterPacket ?? 0)) {
      activeTopology = withFailedLink(topology, input.failLinkId)
      failAppliedAt = i
      events.push(`Mid-flight change: ${linkName(topology, input.failLinkId)} is removed, and the ${input.algorithm} tables are recomputed before packet ${i + 1} is forwarded.`)
    }
    const engine = new RoutingEngine(activeTopology, input.algorithm)
    const route = walk(activeTopology, engine, input.srcId, input.dstId)
    if (!route.ok) {
      result.push({ index: i, path: route.path, links: route.links, cost: Infinity, arrival: Infinity, delivered: false, note: `Packet ${i + 1} was dropped: ${route.reason}` })
      events.push(`Packet ${i + 1} dropped — ${route.reason}`)
      continue
    }
    const arrival = route.links.reduce((sum, id) => {
      const link = activeTopology.links.find((l) => l.id === id)
      return sum + (link ? effectiveCost(link) + 1 : 1)
    }, 0)
    result.push({
      index: i,
      path: route.path,
      links: route.links,
      cost: route.cost,
      arrival,
      delivered: true,
      note: `Packet ${i + 1} took ${route.path.map((id) => label(activeTopology, id)).join(' → ')} (cost ${route.cost}, arrival ${arrival}).`,
    })
    events.push(`Packet ${i + 1}: each router re-looked-up the destination address; path cost ${route.cost}, arrival ${arrival}.`)
  }

  const delivered = result.filter((p) => p.delivered)
  const arrivalOrder = [...delivered].sort((a, b) => a.arrival - b.arrival).map((p) => p.index)
  const outOfOrder = arrivalOrder.some((value, idx) => value !== idx)

  return {
    packets: result,
    arrivalOrder,
    outOfOrder,
    events: [
      ...events,
      failAppliedAt !== null
        ? `Packets 1–${failAppliedAt} and ${failAppliedAt + 1}–${packets} were forwarded from different tables — that is what independent per-packet routing means, and why a transport layer must reorder segments.`
        : 'Every packet made its own lookup, so a table change at any moment can redirect only the packets that arrive after it.',
      outOfOrder ? 'Arrival order differs from send order: the later packet took the shorter route.' : 'Arrival order matched send order this time, but nothing guarantees it.',
    ],
    disclaimer: 'Arrival values are simulated hop units (link cost + 1 per link), not measured times.',
  }
}

function withFailedLink(topology: Topology, linkId: string): Topology {
  return {
    ...topology,
    links: topology.links.map((l) => (l.id === linkId ? { ...l, status: 'failed' as const } : l)),
  }
}

export function linkName(topology: Topology, linkId: string): string {
  const link = topology.links.find((l) => l.id === linkId)
  if (!link) return linkId
  return `${nodeById(topology, link.a)?.label ?? link.a}–${nodeById(topology, link.b)?.label ?? link.b}`
}

function linkLabel(topology: Topology, from: string, to: string): string {
  return `${label(topology, from)}–${label(topology, to)}`
}

function walk(
  topology: Topology,
  engine: RoutingEngine,
  srcId: string,
  dstId: string
): { ok: boolean; path: string[]; links: string[]; cost: number; reason: string } {
  const path: string[] = [srcId]
  const links: string[] = []
  let cost = 0
  const src = nodeById(topology, srcId)
  let cursor = srcId
  if (src && src.kind !== 'router' && src.gateway) {
    const link = usableDirect(topology, src.id, src.gateway)
    if (!link) return { ok: false, path, links, cost, reason: `${src.label} cannot reach gateway ${label(topology, src.gateway)}.` }
    path.push(src.gateway)
    links.push(link.id)
    cost += effectiveCost(link)
    cursor = src.gateway
  }
  const seen: Record<string, number> = {}
  for (let step = 0; step < topology.nodes.length * 3; step += 1) {
    if (cursor === dstId) return { ok: true, path, links, cost, reason: 'ok' }
    const decision = engine.decide(cursor, dstId)
    if (!decision.nextHop) return { ok: false, path, links, cost, reason: decision.rationale }
    const link = usableDirect(topology, cursor, decision.nextHop)
    if (!link) return { ok: false, path, links, cost, reason: `${label(topology, cursor)} has no usable link to ${label(topology, decision.nextHop)}.` }
    seen[decision.nextHop] = (seen[decision.nextHop] ?? 0) + 1
    if (seen[decision.nextHop]! > 2) return { ok: false, path, links, cost, reason: 'Forwarding loop.' }
    path.push(decision.nextHop)
    links.push(link.id)
    cost += effectiveCost(link)
    cursor = decision.nextHop
  }
  return { ok: false, path, links, cost, reason: 'The forwarding walk never reached the destination.' }
}

export const VC_VS_DATAGRAM: { aspect: string; circuit: string; datagram: string }[] = [
  {
    aspect: 'Path chosen',
    circuit: 'Once, at call setup. Every packet follows the same stored route.',
    datagram: 'Independently, per packet, from the destination address.',
  },
  {
    aspect: 'What a switch looks up',
    circuit: 'The (incoming link, VCI) pair in the call table.',
    datagram: 'The destination IP prefix in the forwarding table.',
  },
  {
    aspect: 'Setup cost',
    circuit: 'Real signalling delay before any data flows.',
    datagram: 'None — the first packet already travels.',
  },
  {
    aspect: 'Resource reservation',
    circuit: 'Buffers and sometimes bandwidth are held for the call.',
    datagram: 'Nothing is reserved; congestion is handled packet by packet.',
  },
  {
    aspect: 'Link or switch failure',
    circuit: 'The circuit breaks. Recovery means tearing down and re-establishing it.',
    datagram: 'Later packets simply follow the recalculated tables; earlier ones may be lost.',
  },
  {
    aspect: 'Ordering',
    circuit: 'Guaranteed, because all packets take one path.',
    datagram: 'Not guaranteed — different packets can take different paths.',
  },
  {
    aspect: 'Real-world examples',
    circuit: 'X.25, Frame Relay, ATM, MPLS label switched paths.',
    datagram: 'The Internet Protocol itself: connectionless, best effort.',
  },
]
