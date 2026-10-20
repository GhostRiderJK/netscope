import type { NetLink, NetNode, Topology } from './types'

/**
 * Preset topologies. Each one exists to make a specific Chapter 4 idea visible;
 * every number in them is used by at least one module.
 */

const node = (
  id: string,
  label: string,
  kind: NetNode['kind'],
  x: number,
  y: number,
  extra: Partial<NetNode> = {}
): NetNode => ({ id, label, kind, x, y, ...extra })

const link = (id: string, a: string, b: string, cost: number, mtu = 1500, status: NetLink['status'] = 'active'): NetLink => ({
  id,
  a,
  b,
  cost,
  mtu,
  status,
})

/** 1 — Small campus network. Local delivery vs gateway delivery. */
const campus: Topology = {
  id: 'campus',
  name: 'Campus core',
  summary: 'Two access routers under a core router. PC-1 and PC-2 share a /26, so PC-1 reaches PC-2 without any routing lookup — but the server is remote.',
  nodes: [
    node('r1', 'R1 Core', 'router', 600, 150),
    node('r2', 'R2 West', 'router', 320, 320),
    node('r3', 'R3 East', 'router', 880, 320),
    node('pc1', 'PC-1', 'host', 150, 470, { ip: '192.168.10.130', prefix: 26, gateway: 'r2', note: 'The assignment worked example address.' }),
    node('pc2', 'PC-2', 'host', 330, 540, { ip: '192.168.10.150', prefix: 26, gateway: 'r2' }),
    node('sv1', 'Web Server', 'server', 950, 500, { ip: '192.168.20.10', prefix: 24, gateway: 'r3' }),
  ],
  links: [
    link('l-r1-r2', 'r1', 'r2', 2),
    link('l-r1-r3', 'r1', 'r3', 2),
    link('l-r2-r3', 'r2', 'r3', 9, 1500, 'congested'),
    link('l-r2-pc1', 'r2', 'pc1', 1),
    link('l-r2-pc2', 'r2', 'pc2', 1),
    link('l-r3-sv1', 'r3', 'sv1', 1),
  ],
  policies: [],
}

/** 2 — Multi-route network split into four autonomous systems. */
const internet: Topology = {
  id: 'internet-core',
  name: 'Multi-AS Internet core',
  summary: 'Campus AS171 is multi-homed to ISP-A (AS200) and ISP-B (AS300), both reaching the data centre AS400. LOCAL_PREF 200 on the AS200 session makes campus traffic take the physically longer route.',
  nodes: [
    node('h1', 'Client PC', 'host', 60, 300, { ip: '172.16.10.10', prefix: 24, gateway: 'r1' }),
    node('r1', 'CE1', 'router', 240, 180, { asNumber: 171 }),
    node('r2', 'CE2', 'router', 240, 420, { asNumber: 171 }),
    node('r3', 'ISP-A1', 'router', 540, 140, { asNumber: 200 }),
    node('r4', 'ISP-A2', 'router', 540, 400, { asNumber: 200 }),
    node('r5', 'ISP-B', 'router', 800, 280, { asNumber: 300 }),
    node('r6', 'DC-Edge', 'router', 1040, 300, { asNumber: 400 }),
    node('sv1', 'Game Server', 'server', 1060, 520, { ip: '203.0.113.10', prefix: 24, gateway: 'r6' }),
  ],
  links: [
    link('l-h1-r1', 'h1', 'r1', 1),
    link('l-r1-r2', 'r1', 'r2', 1),
    link('l-r1-r3', 'r1', 'r3', 3),
    link('l-r2-r5', 'r2', 'r5', 2),
    link('l-r3-r4', 'r3', 'r4', 1),
    link('l-r3-r5', 'r3', 'r5', 5),
    link('l-r4-r6', 'r4', 'r6', 4),
    link('l-r5-r6', 'r5', 'r6', 2),
    link('l-r6-sv1', 'r6', 'sv1', 1),
  ],
  policies: [
    {
      asNumber: 171,
      peerAs: 200,
      localPref: 200,
      reason: 'Transit contract with ISP-A: AS171 steers all outbound traffic through AS200 regardless of IGP distance.',
    },
  ],
}

/** 3 — Designed to break: the only route to the server dies, and DV counts to infinity. */
const failure: Topology = {
  id: 'failure-lab',
  name: 'Failure lab (count to infinity)',
  summary: 'Server SV is only reachable through RB. When link RB–SV fails, RA and RB each believe the other can still reach SV, so the metric climbs one advertisement at a time until it hits infinity.',
  nodes: [
    node('pc1', 'Workstation', 'host', 80, 300, { ip: '10.8.8.10', prefix: 24, gateway: 'ra' }),
    node('ra', 'RA', 'router', 340, 300),
    node('rb', 'RB', 'router', 660, 300),
    node('rc', 'RC', 'router', 500, 520),
    node('sv', 'Backup Server', 'server', 920, 300, { ip: '10.9.9.5', prefix: 24, gateway: 'rb', note: 'Single-homed: losing RB–SV makes it unreachable.' }),
  ],
  links: [
    link('l-pc-ra', 'pc1', 'ra', 1),
    link('l-ra-rb', 'ra', 'rb', 1),
    link('l-ra-rc', 'ra', 'rc', 5),
    link('l-rb-rc', 'rb', 'rc', 5),
    link('l-rb-sv', 'rb', 'sv', 1),
  ],
  policies: [],
}

/** 4 — The assignment figure: five routers, seven links, hand-checked expected costs. */
const chapterExample: Topology = {
  id: 'chapter4-example',
  name: 'Chapter 4 worked example (A–E)',
  summary: 'Exactly the assignment topology. Dijkstra from A gives A 0, B 2, C 4, D 5, E 8, and B is the next hop for B, C, D and E.',
  nodes: [
    node('A', 'A', 'router', 140, 300),
    node('B', 'B', 'router', 420, 160),
    node('C', 'C', 'router', 420, 440),
    node('D', 'D', 'router', 700, 300),
    node('E', 'E', 'router', 980, 300),
  ],
  links: [
    link('l-A-B', 'A', 'B', 2),
    link('l-A-C', 'A', 'C', 5),
    link('l-B-C', 'B', 'C', 2),
    link('l-B-D', 'B', 'D', 4),
    link('l-C-D', 'C', 'D', 1),
    link('l-C-E', 'C', 'E', 6),
    link('l-D-E', 'D', 'E', 3),
  ],
  policies: [],
}

/** 5 — One deliberately small MTU in the middle, for fragmentation and DF. */
const mtuLab: Topology = {
  id: 'mtu-lab',
  name: 'MTU / fragmentation lab',
  summary: 'Ethernet at both ends, a 576 B legacy link in the middle. A 4000 B datagram must be split twice, or dropped outright when DF is set.',
  nodes: [
    node('pc', 'Sender PC', 'host', 140, 300, { ip: '192.0.2.10', prefix: 24, gateway: 'r1' }),
    node('r1', 'R1', 'router', 420, 300),
    node('r2', 'R2', 'router', 720, 300, { note: 'Serial interface, MTU 576 B.' }),
    node('sv', 'Receiver SV', 'server', 1000, 300, { ip: '198.51.100.20', prefix: 24, gateway: 'r2' }),
  ],
  links: [
    link('l-pc-r1', 'pc', 'r1', 1, 1500),
    link('l-r1-r2', 'r1', 'r2', 2, 576),
    link('l-r2-sv', 'r2', 'sv', 1, 1500),
  ],
  policies: [],
}

export const PRESETS: Topology[] = [campus, internet, failure, chapterExample, mtuLab]

export const DEFAULT_TOPOLOGY_ID = campus.id

export function presetById(id: string): Topology {
  const found = PRESETS.find((p) => p.id === id) ?? PRESETS[0]!
  return cloneTopology(found)
}

export function cloneTopology(topology: Topology): Topology {
  return {
    id: topology.id,
    name: topology.name,
    summary: topology.summary,
    nodes: topology.nodes.map((n) => ({ ...n })),
    links: topology.links.map((l) => ({ ...l })),
    policies: topology.policies.map((p) => ({ ...p })),
  }
}

/** An empty board for the "build your own" flow. */
export function blankTopology(): Topology {
  return {
    id: 'custom',
    name: 'My topology',
    summary: 'Blank canvas. Add a router, add a host, then connect them.',
    nodes: [node('r1', 'R1', 'router', 520, 300), node('h1', 'Host A', 'host', 220, 300, { ip: '10.0.0.10', prefix: 24, gateway: 'r1' })],
    links: [link('l-r1-h1', 'r1', 'h1', 1)],
    policies: [],
  }
}
