/**
 * NetScope core data models.
 *
 * Everything in `src/core` is framework-free and deterministic: the UI only
 * renders what these types and the algorithm functions produce.
 */

export type NodeKind = 'host' | 'router' | 'server'

/** Operational state of a link, drives both colour coding and reachability. */
export type LinkStatus = 'active' | 'failed' | 'congested'

export interface NetNode {
  id: string
  label: string
  kind: NodeKind
  x: number
  y: number
  /** IPv4 address of this node (host primary address or router interface address). */
  ip?: string
  /** Prefix length that the address above belongs to. */
  prefix?: number
  /** Default gateway node id for hosts and servers. */
  gateway?: string
  /** Autonomous system number for routers (BGP). */
  asNumber?: number
  /** True when the router does not answer ICMP echo / time-exceeded probes. */
  silent?: boolean
  /** Short note shown in the inspector. */
  note?: string
}

export interface NetLink {
  id: string
  a: string
  b: string
  /** Routing metric. Integer, >= 1. */
  cost: number
  status: LinkStatus
  /** Link-layer MTU in bytes; used by the packet sim and fragmentation lab. */
  mtu: number
}

export interface BgpPolicy {
  /** AS whose routers apply this LOCAL_PREF when learning from `peerAs`. */
  asNumber: number
  peerAs: number
  localPref: number
  reason?: string
}

export interface Topology {
  id: string
  name: string
  summary: string
  nodes: NetNode[]
  links: NetLink[]
  /** Ingress LOCAL_PREF policies keyed by (as, peerAs). */
  policies: BgpPolicy[]
}

export type RoutingAlgorithm =
  | 'link-state'
  | 'distance-vector'
  | 'rip'
  | 'ospf'
  | 'bgp'

/** One row of a router's forwarding table. */
export interface ForwardingEntry {
  /** Destination node id (each node is modelled as one prefix). */
  dest: string
  destLabel: string
  /** Dest prefix text, e.g. `10.0.3.0/24`, when the node has addressing. */
  destPrefix: string
  nextHop: string
  nextHopLabel: string
  /** Total path cost from the owning router to `dest`. */
  cost: number
  /** Link id used to leave the owning router. */
  outLink: string
  outLinkLabel: string
  /** Number of hops to reach `dest` (RIP metric style). */
  hops: number
}

export interface ForwardingTable {
  routerId: string
  algorithm: RoutingAlgorithm
  entries: ForwardingEntry[]
}

export type PacketResult =
  | 'delivered'
  | 'unreachable'
  | 'ttl-expired'
  | 'routing-loop'
  | 'df-drop'

export type EventKind =
  | 'create'
  | 'prefix-check'
  | 'gateway'
  | 'lookup'
  | 'forward'
  | 'fragment'
  | 'reassemble'
  | 'ttl-decrement'
  | 'ttl-expired'
  | 'icmp'
  | 'deliver'
  | 'drop'

export interface SimEvent {
  index: number
  kind: EventKind
  /** Node where the event happens (null for wire-level events). */
  nodeId: string | null
  linkId: string | null
  /** Human-readable timeline line. */
  text: string
  /** Longer "why" explanation for the inspector. */
  why: string
  ttl: number
  hop: number
  packetSize: number
  /** Set when the event is a routing decision. */
  decision?: {
    table: ForwardingEntry
    rationale: string
  }
}

export interface SimRun {
  result: PacketResult
  /** Node ids visited, in order, including source and final destination. */
  path: string[]
  links: string[]
  events: SimEvent[]
  totalCost: number
  hops: number
  initialTtl: number
  finalTtl: number
  packetSize: number
  /** Fragments produced anywhere along the path, for the header panel. */
  fragments: FragmentInfo[]
  algorithm: RoutingAlgorithm
  /** Unreachable / drop explanation. */
  detail?: string
}

export interface FragmentInfo {
  linkId: string
  index: number
  payloadBytes: number
  totalLength: number
  offsetUnits: number
  moreFragments: boolean
  identification: number
}
