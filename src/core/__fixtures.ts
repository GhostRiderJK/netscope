import type { NetLink, NetNode, Topology } from './types'

/** Hand-built fixtures for the tests, deliberately independent of the presets. */

const n = (id: string, x: number, y: number, extra: Partial<NetNode> = {}): NetNode => ({
  id,
  label: id,
  kind: 'router',
  x,
  y,
  ...extra,
})

const l = (a: string, b: string, cost: number, mtu = 1500, status: NetLink['status'] = 'active'): NetLink => ({
  id: `l-${a}-${b}`,
  a,
  b,
  cost,
  mtu,
  status,
})

/** The assignment figure: A–B 2, A–C 5, B–C 2, B–D 4, C–D 1, C–E 6, D–E 3. */
export function chapterFixture(): Topology {
  return {
    id: 'fixture',
    name: 'Chapter 4 fixture',
    summary: 'Five routers, seven links.',
    nodes: [n('A', 100, 300), n('B', 300, 150), n('C', 300, 450), n('D', 550, 300), n('E', 750, 300)],
    links: [l('A', 'B', 2), l('A', 'C', 5), l('B', 'C', 2), l('B', 'D', 4), l('C', 'D', 1), l('C', 'E', 6), l('D', 'E', 3)],
    policies: [],
  }
}

/** A–B–C line, C–D link is the one tests break. */
export function chainFixture(): Topology {
  return {
    id: 'chain',
    name: 'Chain',
    summary: 'Four routers in a line plus a stub host.',
    nodes: [n('R1', 100, 200), n('R2', 300, 200), n('R3', 500, 200), n('R4', 700, 200), { ...n('H1', 700, 380), kind: 'host', ip: '10.0.0.10', prefix: 24, gateway: 'R4' }],
    links: [l('R1', 'R2', 1), l('R2', 'R3', 1), l('R3', 'R4', 1), l('R4', 'H1', 1)],
    policies: [],
  }
}

/** Two-node dependency that produces count to infinity when RB–SV dies. */
export function countInfinityFixture(): Topology {
  return {
    id: 'count',
    name: 'Count to infinity',
    summary: 'SV hangs off RB only; RA reaches SV through RB.',
    nodes: [n('RA', 200, 200), n('RB', 450, 200), n('RC', 325, 400), { ...n('SV', 700, 200), kind: 'server', ip: '10.9.9.5', prefix: 24, gateway: 'RB' }],
    links: [l('RA', 'RB', 1), l('RA', 'RC', 5), l('RB', 'RC', 5), l('RB', 'SV', 1)],
    policies: [],
  }
}

/** Long hop chain used for the RIP 15/16 boundary. */
export function hopChain(routers: number): Topology {
  const nodes: NetNode[] = []
  const links: NetLink[] = []
  for (let i = 0; i < routers; i += 1) {
    nodes.push(n(`R${i}`, 80 + i * 90, 200))
    if (i > 0) links.push(l(`R${i - 1}`, `R${i}`, 1))
  }
  return { id: 'hopchain', name: 'Hop chain', summary: `R0 … R${routers - 1}`, nodes, links, policies: [] }
}

/** Three ASes in a row with a cheap detour that policy can override. */
export function bgpFixture(): Topology {
  return {
    id: 'bgp',
    name: 'BGP policy fixture',
    summary: 'AS1 dual-homed to AS2 (long) and AS3 (short); AS1 prefers AS2.',
    nodes: [
      n('C1', 150, 150, { asNumber: 1 }),
      n('C2', 150, 400, { asNumber: 1 }),
      n('A1', 450, 150, { asNumber: 2 }),
      n('B1', 450, 400, { asNumber: 3 }),
      n('D1', 780, 280, { asNumber: 4 }),
      { ...n('SV', 780, 480), kind: 'server', ip: '203.0.113.10', prefix: 24, gateway: 'D1' },
    ],
    links: [
      { id: 'l-C1-C2', a: 'C1', b: 'C2', cost: 1, mtu: 1500, status: 'active' },
      { id: 'l-C1-A1', a: 'C1', b: 'A1', cost: 9, mtu: 1500, status: 'active' },
      { id: 'l-C2-B1', a: 'C2', b: 'B1', cost: 1, mtu: 1500, status: 'active' },
      { id: 'l-A1-D1', a: 'A1', b: 'D1', cost: 9, mtu: 1500, status: 'active' },
      { id: 'l-B1-D1', a: 'B1', b: 'D1', cost: 1, mtu: 1500, status: 'active' },
      { id: 'l-D1-SV', a: 'D1', b: 'SV', cost: 1, mtu: 1500, status: 'active' },
    ],
    policies: [{ asNumber: 1, peerAs: 2, localPref: 200, reason: 'Contract with AS2.' }],
  }
}
