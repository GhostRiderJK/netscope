import { CONGESTION_PENALTY, effectiveCost, isUsable, linkById, nodeById } from './graph'
import { describeSubnet, sameSubnet } from './ipv4'
import { computeFragments } from './fragmentation'
import { RoutingEngine, label, usableDirect, type DvOptions } from './routing'
import type { FragmentInfo, RoutingAlgorithm, SimEvent, SimRun, Topology } from './types'

/**
 * Event kinds where the datagram actually moves over a link. `costUpTo` counts
 * each link once — a fragmented link still costs one crossing.
 */
const TRAVERSAL_KINDS: SimEvent['kind'][] = ['gateway', 'forward', 'fragment', 'deliver']

/**
 * Cumulative cost of the links the packet has genuinely traversed by the time
 * the animation reaches `upToIndex`. Pure and additive: it reads the same
 * events `simulatePacket` produced, so the on-screen running total can never
 * disagree with the final `run.totalCost`.
 */
export function costUpTo(events: SimEvent[], upToIndex: number, topology: Topology): number {
  const counted = new Set<string>()
  let cost = 0
  for (let i = 0; i <= upToIndex && i < events.length; i += 1) {
    const event = events[i]!
    if (!event.linkId || !TRAVERSAL_KINDS.includes(event.kind)) continue
    if (counted.has(event.linkId)) continue
    const link = linkById(topology, event.linkId)
    if (!link) continue
    counted.add(event.linkId)
    cost += effectiveCost(link)
  }
  return cost
}

export interface PacketRunInput {
  topology: Topology
  algorithm: RoutingAlgorithm
  srcId: string
  dstId: string
  initialTtl: number
  /** Total IPv4 datagram size including its header. */
  packetBytes: number
  headerLength: number
  dontFragment?: boolean
  identification?: number
  dvOptions?: Partial<DvOptions>
}

/**
 * Walks one datagram hop by hop using the forwarding decisions the chosen
 * algorithm really computed, and returns the ordered event list that the UI
 * animates. Animation and reporting both read these events, so they can never
 * disagree with the simulation.
 */
export function simulatePacket(input: PacketRunInput): SimRun {
  const topology = input.topology
  const engine = new RoutingEngine(topology, input.algorithm, input.dvOptions)
  const identification = input.identification ?? 0x1a2c
  const headerLength = input.headerLength
  const dontFragment = input.dontFragment ?? false

  const events: SimEvent[] = []
  const fragments: FragmentInfo[] = []
  const path: string[] = []
  const usedLinks: string[] = []

  let ttl = input.initialTtl
  let hop = 0
  let totalCost = 0
  let wireSize = input.packetBytes
  let detail = ''
  let lastCrossResult: SimRun['result'] = 'unreachable'

  const name = (from: string, to: string): string => `${label(topology, from)}–${label(topology, to)}`

  const src = nodeById(topology, input.srcId)
  const dst = nodeById(topology, input.dstId)

  const add = (
    kind: SimEvent['kind'],
    nodeId: string | null,
    linkId: string | null,
    text: string,
    why: string,
    extra: Partial<SimEvent> = {}
  ): void => {
    events.push({
      index: events.length,
      kind,
      nodeId,
      linkId,
      text,
      why,
      ttl,
      hop,
      packetSize: wireSize,
      ...extra,
    })
  }

  const finish = (result: SimRun['result'], why: string): SimRun => ({
    result,
    path,
    links: [...new Set(usedLinks)],
    events,
    totalCost,
    hops: hop,
    initialTtl: input.initialTtl,
    finalTtl: ttl,
    packetSize: input.packetBytes,
    fragments,
    algorithm: input.algorithm,
    detail: why,
  })

  if (!src || !dst) {
    add('drop', null, null, 'Source or destination is missing from this topology.', 'Select two nodes that exist.')
    return finish('unreachable', 'Invalid source or destination node.')
  }

  if (src.id === dst.id) {
    add('deliver', src.id, null, `${src.label} is both sender and receiver — the stack loops the datagram back internally.`, 'A host never sends a packet to itself over the wire.')
    return finish('delivered', 'Source equals destination.')
  }

  add(
    'create',
    src.id,
    null,
    `${src.label} creates a ${input.packetBytes} B datagram for ${addressOf(dst)} with TTL ${input.initialTtl}.`,
    src.kind === 'router'
      ? `${src.label} is a router, so it builds the header and immediately consults its own forwarding table.`
      : `${src.label} is an end system: it fills in source ${addressOf(src)}, destination ${addressOf(dst)}, protocol and TTL, then decides whether the destination is on its own subnet.`
  )

  let cursor = src.id
  path.push(cursor)

  // --- End-system behaviour: prefix test, then a single gateway hand-off. ---
  if (src.kind !== 'router') {
    const prefixTest = hostPrefixTest(topology, src.id, dst.id)
    add('prefix-check', src.id, null, prefixTest.text, prefixTest.why)

    if (prefixTest.mode === 'direct') {
      const link = usableDirect(topology, src.id, dst.id)
      if (!link) {
        detail = `${src.label} and ${dst.label} share a subnet but have no usable link between them.`
        add('drop', src.id, null, detail, 'Same-prefix delivery still needs a physical link — check that the link exists and is not failed.')
        return finish('unreachable', detail)
      }
      if (!crossLink(link.id, src.id, dst.id)) return finish(lastCrossResult, detail)
      path.push(dst.id)
      usedLinks.push(link.id)
      totalCost += effectiveCost(link)
      hop += 1
      add('deliver', dst.id, link.id, `${dst.label} receives the datagram directly on ${name(src.id, dst.id)}; no router was involved.`, 'A same-subnet destination is resolved with ARP and delivered on the local link.')
      return finish('delivered', `Delivered on the local link in 1 hop (cost ${totalCost}).`)
    }

    if (prefixTest.mode !== 'gateway' || !prefixTest.gatewayId) {
      detail = prefixTest.why
      add('drop', src.id, null, `${src.label} has nowhere to send this datagram.`, prefixTest.why)
      return finish('unreachable', detail)
    }

    const gatewayId = prefixTest.gatewayId
    const link = usableDirect(topology, src.id, gatewayId)
    if (!link) {
      detail = `${src.label}'s default gateway ${label(topology, gatewayId)} is not reachable over any usable link.`
      add('drop', src.id, null, detail, 'The gateway must sit on the host’s own subnet and be physically connected.')
      return finish('unreachable', detail)
    }
    add(
      'gateway',
      src.id,
      link.id,
      `${src.label} hands the datagram to its default gateway ${label(topology, gatewayId)} on ${name(src.id, gatewayId)}.`,
      'The host’s frame destination is the gateway’s MAC, but the IP destination stays the final server — that is what makes it forwarding rather than delivery.'
    )
    if (!crossLink(link.id, src.id, gatewayId)) return finish(lastCrossResult, detail)
    usedLinks.push(link.id)
    totalCost += effectiveCost(link)
    path.push(gatewayId)
    cursor = gatewayId
    hop += 1
  }

  // --- Router hop loop. ---
  const visitCount: Record<string, number> = {}
  let iterations = 0
  while (cursor !== dst.id) {
    iterations += 1
    if (iterations > topology.nodes.length * 4) {
      detail = 'The computed tables send this packet around a forwarding loop.'
      add('drop', cursor, null, `${label(topology, cursor)} has been asked to forward in circles — ${iterations} steps without progress.`, 'Loops come from inconsistent tables. Distance-vector protocols heal them slowly (count to infinity); link-state protocols recompute in one SPF run.')
      return finish('routing-loop', detail)
    }

    const decision = engine.decide(cursor, dst.id)
    if (!decision.nextHop) {
      detail = `${label(topology, cursor)} has no route for ${prefixText(dst.id)}.`
      add(
        'drop',
        cursor,
        null,
        `${label(topology, cursor)} finds no entry for ${prefixText(dst.id)} and discards the datagram.`,
        decision.rationale + (hasUsableLink(topology, cursor) ? '' : ` ${label(topology, cursor)} currently has no usable links at all.`)
      )
      if (isRouter(topology, cursor)) {
        add('icmp', cursor, null, `${label(topology, cursor)} returns ICMP Destination Unreachable (Type 3) to ${src.label}.`, 'A router with no route reports the failure instead of staying silent.')
      }
      return finish('unreachable', detail)
    }

    add(
      'lookup',
      cursor,
      null,
      `${label(topology, cursor)} looks up ${prefixText(dst.id)} → next hop ${decision.tableEntry?.nextHopLabel ?? label(topology, decision.nextHop)}, cost ${decision.cost}.`,
      decision.rationale,
      decision.tableEntry ? { decision: { table: decision.tableEntry, rationale: decision.rationale } } : {}
    )

    const link = usableDirect(topology, cursor, decision.nextHop)
    if (!link) {
      detail = `${label(topology, cursor)} points at ${label(topology, decision.nextHop)} but no usable link connects them.`
      add('drop', cursor, null, detail, 'The table is stale relative to the topology — exactly what slow convergence leaves behind after a failure.')
      return finish('unreachable', detail)
    }

    ttl -= 1
    if (ttl <= 0) {
      add('ttl-expired', cursor, null, `${label(topology, cursor)} lowers TTL ${ttl + 1} → 0, discards the datagram and answers ${src.label} with ICMP Time Exceeded (Type 11).`, 'TTL exists to bound a packet’s lifetime so a loop or misconfiguration cannot keep a datagram alive forever.')
      detail = `TTL exhausted at ${label(topology, cursor)} after ${hop + 1} hop(s).`
      return finish('ttl-expired', detail)
    }
    add('ttl-decrement', cursor, null, `${label(topology, cursor)} lowers TTL ${ttl + 1} → ${ttl}.`, 'Every forwarding IPv4 router decrements TTL by one.')

    visitCount[decision.nextHop] = (visitCount[decision.nextHop] ?? 0) + 1
    if (visitCount[decision.nextHop]! > 2) {
      detail = `${label(topology, decision.nextHop)} appears three times in the computed path: a forwarding loop.`
      add('drop', cursor, null, `${label(topology, cursor)} would loop this packet back to ${label(topology, decision.nextHop)} again.`, 'TTL expiry is the safety net; the real bug is inconsistent routing tables.')
      return finish('routing-loop', detail)
    }

    if (!crossLink(link.id, cursor, decision.nextHop)) return finish(lastCrossResult, detail)
    usedLinks.push(link.id)
    totalCost += effectiveCost(link)
    cursor = decision.nextHop
    hop += 1
    path.push(cursor)
  }

  if (dst.kind !== 'router') {
    add('reassemble', dst.id, usedLinks.at(-1) ?? null, `${dst.label} reassembles and accepts the datagram (${input.packetBytes} B, identification ${identification}).`, fragments.length ? 'Reassembly keys on identification plus fragment offset; the payload reconstructs byte-for-byte.' : 'No fragmentation was needed on this path, so nothing to reassemble.')
  }
  add('deliver', dst.id, usedLinks.at(-1) ?? null, `${dst.label} receives the datagram after ${hop} hop(s), TTL ${ttl} remaining, total cost ${totalCost}.`, `Selected route: ${path.map((id) => label(topology, id)).join(' → ')} under ${input.algorithm} routing.`)
  detail = `Delivered over ${hop} hop(s) at total cost ${totalCost}.`
  return finish('delivered', detail)

  /** Move a datagram over one link, fragmenting it if the MTU requires. */
  function crossLink(linkId: string, from: string, to: string): boolean {
    const link = topology.links.find((l) => l.id === linkId)
    if (!link) {
      lastCrossResult = 'unreachable'
      detail = `Link ${linkId} is gone.`
      return false
    }
    const linkLabel = name(from, to)
    if (link.status === 'failed') {
      lastCrossResult = 'unreachable'
      detail = `${linkLabel} is failed.`
      add('drop', from, linkId, `${linkLabel} is down, so ${label(topology, from)} cannot forward onto it.`, 'A failed link removes that edge from every routing calculation once the tables converge.')
      return false
    }

    const plan = computeFragments({
      datagramBytes: input.packetBytes,
      headerLength,
      mtu: link.mtu,
      dontFragment,
      identification,
    })

    if (!plan.ok) {
      lastCrossResult = 'unreachable'
      detail = plan.error ?? 'Fragmentation arithmetic failed.'
      add('drop', from, linkId, `${linkLabel}: ${detail}`, 'This configuration cannot be carried by the link at all.')
      return false
    }

    if (plan.dropped) {
      lastCrossResult = 'df-drop'
      detail = plan.dropReason ?? 'DF set and fragmentation required.'
      add(
        'drop',
        from,
        linkId,
        `${label(topology, from)} cannot fit ${input.packetBytes} B into the ${link.mtu} B MTU of ${linkLabel} and DF=1 forbids splitting it: the datagram is dropped and ICMP Destination Unreachable (Code 4) goes back to the source.`,
        plan.dropReason ?? ''
      )
      return false
    }

    if (plan.needsFragmentation) {
      for (const fragment of plan.fragments) {
        fragments.push({
          linkId,
          index: fragment.index,
          payloadBytes: fragment.payloadBytes,
          totalLength: fragment.totalLength,
          offsetUnits: fragment.offsetUnits,
          moreFragments: fragment.moreFragments,
          identification,
        })
        add(
          'fragment',
          from,
          linkId,
          `${linkLabel} (MTU ${link.mtu} B): fragment ${fragment.index + 1}/${plan.fragments.length} carries ${fragment.payloadBytes} B, offset ${fragment.offsetUnits} × 8 B, MF=${fragment.moreFragments ? 1 : 0}.`,
          plan.detail,
          { packetSize: fragment.totalLength }
        )
      }
      return true
    }

    add(
      'forward',
      from,
      linkId,
      `${label(topology, from)} forwards the datagram to ${label(topology, to)} over ${linkLabel} (cost ${effectiveCost(link)}, MTU ${link.mtu} B).`,
      `The ${input.packetBytes} B datagram fits the ${link.mtu} B MTU, so it crosses whole. Effective cost ${link.cost}${link.status === 'congested' ? ` plus the ${CONGESTION_PENALTY} congestion penalty` : ''}.`
    )
    lastCrossResult = 'unreachable'
    return true
  }

  function prefixText(id: string): string {
    const node = nodeById(topology, id)
    if (!node?.ip) return label(topology, id)
    return `${node.ip}/${node.prefix ?? 24}`
  }
}

function addressOf(node: { label: string; ip?: string }): string {
  return node.ip ?? node.label
}

function isRouter(topology: Topology, id: string): boolean {
  return nodeById(topology, id)?.kind === 'router'
}

function hasUsableLink(topology: Topology, id: string): boolean {
  return topology.links.some((l) => isUsable(l) && (l.a === id || l.b === id))
}

export type HostPrefixMode = 'direct' | 'gateway' | 'none'

export interface HostPrefixTest {
  mode: HostPrefixMode
  text: string
  why: string
  gatewayId?: string
}

/** The end-system half of forwarding: compare prefixes, then pick a gateway. */
export function hostPrefixTest(topology: Topology, from: string, to: string): HostPrefixTest {
  const src = nodeById(topology, from)
  const dst = nodeById(topology, to)
  if (!src || !dst) return { mode: 'none', text: 'Missing node.', why: 'The topology is incomplete.' }

  if (src.ip && dst.ip && src.prefix !== undefined) {
    const own = describeSubnet(src.ip, src.prefix)
    if (!own.ok) return { mode: 'none', text: own.error ?? 'Bad addressing.', why: own.error ?? 'Bad addressing.' }
    const same = sameSubnet(src.ip, dst.ip, src.prefix)
    if (same.ok && same.shared) {
      return {
        mode: 'direct',
        text: `${src.label}: ${dst.ip} is inside its own subnet ${own.network}/${src.prefix}, so it delivers directly on the link.`,
        why: `Both addresses AND with ${own.mask} give ${own.network}: ${dst.ip} needs no router, only a local ARP request.`,
        gatewayId: undefined,
      }
    }
    const dstNet = same.ok && same.networkB ? `${same.networkB}/${src.prefix}` : 'another network'
    const gateway = src.gateway ? nodeById(topology, src.gateway) : undefined
    if (gateway && usableDirect(topology, src.id, gateway.id)) {
      return {
        mode: 'gateway',
        text: `${src.label}: ${dst.ip} is in ${dstNet}, outside ${own.network}/${src.prefix}, so it forwards to its default gateway ${label(topology, gateway.id)}.`,
        why: `The destination does not share ${src.label}'s network bits, so the host cannot ARP for it directly. It hands the datagram to its configured default gateway ${label(topology, gateway.id)}, which knows how to reach ${dstNet}.`,
        gatewayId: gateway.id,
      }
    }
    return {
      mode: 'none',
      text: `${src.label}: ${dst.ip} is outside ${own.network}/${src.prefix} and ${gateway ? 'its default gateway is not reachable over any usable link' : 'no default gateway is set'}, so the datagram cannot leave.`,
      why: 'An end system with no reachable gateway can only talk inside its own subnet.',
    }
  }

  if (src.gateway) {
    return {
      mode: 'gateway',
      text: `${src.label} has no address/prefix pair, so it falls back to its configured gateway ${label(topology, src.gateway)}.`,
      why: 'Without addressing data the simulator uses the default gateway instead of a prefix comparison.',
      gatewayId: src.gateway,
    }
  }
  return {
    mode: 'none',
    text: `${src.label} has neither an address with a prefix nor a gateway, so it cannot decide where to send the datagram.`,
    why: 'Give the host an IPv4 address with a prefix length, or a default gateway, in the inspector.',
  }
}
