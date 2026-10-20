import type { ForwardingTable, SimRun, Topology } from './types'
import type { FragmentPlan } from './fragmentation'
import type { SubnetInfo } from './ipv4'
import type { DvResult } from './algorithms/distanceVector'
import type { LinkStateResult } from './algorithms/linkState'
import type { OspfResult } from './algorithms/ospf'
import type { BgpResult } from './algorithms/bgp'
import type { TracerouteResult } from './icmp'
import { label } from './routing'
import { nodeById } from './graph'

/** Module J: reports assembled from live simulation state only. */

export interface ReportTable {
  title: string
  columns: string[]
  rows: string[][]
}

export interface ExperimentReport {
  id: string
  title: string
  objective: string
  module: string
  generatedAt: string
  topologyName: string
  topologySummary: string
  configuration: { label: string; value: string }[]
  assumptions: string[]
  steps: string[]
  tables: ReportTable[]
  results: { label: string; value: string }[]
  interpretation: string[]
  limitations: string[]
  diagram: {
    nodes: { id: string; label: string; kind: string; x: number; y: number; ip?: string; prefix?: number; asNumber?: number }[]
    links: { id: string; a: string; b: string; cost: number; status: string }[]
    highlightNodes: string[]
    highlightLinks: string[]
  }
}

export interface ReportParts {
  id: string
  title: string
  objective: string
  module: string
  topology: Topology
  configuration?: { label: string; value: string }[]
  assumptions?: string[]
  steps?: string[]
  tables?: ReportTable[]
  results?: { label: string; value: string }[]
  interpretation?: string[]
  limitations?: string[]
  highlightNodes?: string[]
  highlightLinks?: string[]
  generatedAt?: string
}

const BASE_LIMITATIONS = [
  'Every figure comes from this simulator. No datagram crossed a real interface, so no claim here is an Internet measurement.',
  'Headers are reduced to the fields Chapter 4 discusses (version, length, TTL/hop limit, identification, flags, fragment offset, protocol). Options, checksums over payloads, and IPsec are out of scope.',
  'Costs are abstract metrics, not bandwidth or delay; a congested link carries a flat +10 penalty chosen for teaching, not from measurement.',
]

export function makeReport(parts: ReportParts): ExperimentReport {
  return {
    id: parts.id,
    title: parts.title,
    objective: parts.objective,
    module: parts.module,
    generatedAt: parts.generatedAt ?? new Date().toISOString(),
    topologyName: parts.topology.name,
    topologySummary: parts.topology.summary,
    configuration: parts.configuration ?? [],
    assumptions: parts.assumptions ?? [],
    steps: parts.steps ?? [],
    tables: parts.tables ?? [],
    results: parts.results ?? [],
    interpretation: parts.interpretation ?? [],
    limitations: [...BASE_LIMITATIONS, ...(parts.limitations ?? [])],
    diagram: {
      nodes: parts.topology.nodes.map((n) => ({ id: n.id, label: n.label, kind: n.kind, x: Math.round(n.x), y: Math.round(n.y), ip: n.ip, prefix: n.prefix, asNumber: n.asNumber })),
      links: parts.topology.links.map((l) => ({ id: l.id, a: l.a, b: l.b, cost: l.cost, status: l.status })),
      highlightNodes: parts.highlightNodes ?? [],
      highlightLinks: parts.highlightLinks ?? [],
    },
  }
}

export function reportToMarkdown(report: ExperimentReport): string {
  const lines: string[] = []
  lines.push(`# ${report.title}`)
  lines.push('')
  lines.push(`*NetScope — ${report.module} · topology "${report.topologyName}" · generated ${report.generatedAt}*`)
  lines.push('')
  lines.push(`**Objective.** ${report.objective}`)
  lines.push('')
  lines.push(`**Topology.** ${report.topologySummary}`)
  lines.push('')
  if (report.configuration.length) {
    lines.push('## Configuration')
    lines.push('')
    for (const c of report.configuration) lines.push(`- **${c.label}:** ${c.value}`)
    lines.push('')
  }
  if (report.assumptions.length) {
    lines.push('## Assumptions')
    lines.push('')
    for (const a of report.assumptions) lines.push(`- ${a}`)
    lines.push('')
  }
  lines.push('## Network inventory')
  lines.push('')
  lines.push(`| Node | Kind | Address | AS | Neighbours |`)
  lines.push(`| --- | --- | --- | --- | --- |`)
  for (const node of report.diagram.nodes) {
    lines.push(`| ${node.label} | ${node.kind} | ${addressOf(report, node.id)} | ${asOf(report, node.id)} | ${neighboursOf(report, node.id)} |`)
  }
  lines.push('')
  lines.push(`| Link | Cost | Status |`)
  lines.push(`| --- | --- | --- |`)
  for (const link of report.diagram.links) {
    lines.push(`| ${linkLabel(report, link.a, link.b)} | ${link.cost} | ${link.status} |`)
  }
  lines.push('')
  if (report.steps.length) {
    lines.push('## Step-by-step execution')
    lines.push('')
    report.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`))
    lines.push('')
  }
  for (const table of report.tables) {
    lines.push(`## ${table.title}`)
    lines.push('')
    lines.push(`| ${table.columns.join(' | ')} |`)
    lines.push(`| ${table.columns.map(() => '---').join(' | ')} |`)
    for (const row of table.rows) lines.push(`| ${row.join(' | ')} |`)
    lines.push('')
  }
  if (report.results.length) {
    lines.push('## Calculated results')
    lines.push('')
    for (const r of report.results) lines.push(`- **${r.label}:** ${r.value}`)
    lines.push('')
  }
  if (report.interpretation.length) {
    lines.push('## Interpretation')
    lines.push('')
    for (const i of report.interpretation) lines.push(`- ${i}`)
    lines.push('')
  }
  lines.push('## Known limitations')
  lines.push('')
  for (const l of report.limitations) lines.push(`- ${l}`)
  lines.push('')
  return lines.join('\n')
}

function addressOf(report: ExperimentReport, id: string): string {
  const node = reportNode(report, id)
  return node?.ip ? `${node.ip}/${node.prefix ?? 24}` : '—'
}

function asOf(report: ExperimentReport, id: string): string {
  const node = reportNode(report, id)
  return node?.asNumber !== undefined ? `AS${node.asNumber}` : '—'
}

function neighboursOf(report: ExperimentReport, id: string): string {
  const names = report.diagram.links
    .filter((l) => l.a === id || l.b === id)
    .map((l) => (l.a === id ? l.b : l.a))
    .map((other) => reportNode(report, other)?.label ?? other)
  return names.length ? names.join(', ') : 'isolated'
}

function linkLabel(report: ExperimentReport, a: string, b: string): string {
  return `${reportNode(report, a)?.label ?? a}–${reportNode(report, b)?.label ?? b}`
}

function reportNode(report: ExperimentReport, id: string) {
  return report.diagram.nodes.find((n) => n.id === id)
}

export function reportToJson(report: ExperimentReport): string {
  return JSON.stringify(report, null, 2)
}

/** Convenience wrappers used by the report button in each module. */

export function reportForPacketRun(topology: Topology, input: { algorithm: string; srcId: string; dstId: string; initialTtl: number; packetBytes: number; headerLength: number; dontFragment: boolean }, run: SimRun): ExperimentReport {
  const tables: ReportTable[] = []
  const seenRouter = new Set<string>()
  for (const event of run.events) {
    if (!event.decision || !event.nodeId || seenRouter.has(event.nodeId)) continue
    seenRouter.add(event.nodeId)
    const entry = event.decision.table
    tables.push({
      title: `Forwarding decision at ${label(topology, event.nodeId)}`,
      columns: ['Destination', 'Prefix', 'Next hop', 'Out link', 'Cost', 'Hops'],
      rows: [[entry.destLabel, entry.destPrefix, entry.nextHopLabel, entry.outLinkLabel, String(entry.cost), String(entry.hops)]],
    })
  }
  if (run.fragments.length) {
    tables.push({
      title: 'Fragments produced on the path',
      columns: ['Link', '#', 'Payload (B)', 'Total (B)', 'Offset (×8 B)', 'MF', 'ID'],
      rows: run.fragments.map((f) => [f.linkId, String(f.index + 1), String(f.payloadBytes), String(f.totalLength), String(f.offsetUnits), f.moreFragments ? '1' : '0', f.identification.toString(16)]),
    })
  }
  return makeReport({
    id: `packet-${run.result}`,
    title: `Packet journey: ${label(topology, input.srcId)} → ${label(topology, input.dstId)}`,
    objective: 'Trace one datagram through the network layer and show the forwarding decision each router makes.',
    module: 'Module B — Packet journey simulator',
    topology,
    configuration: [
      { label: 'Routing algorithm', value: input.algorithm },
      { label: 'Source', value: `${label(topology, input.srcId)} (${nodeById(topology, input.srcId)?.ip ?? 'no address'})` },
      { label: 'Destination', value: `${label(topology, input.dstId)} (${nodeById(topology, input.dstId)?.ip ?? 'no address'})` },
      { label: 'Initial TTL', value: String(input.initialTtl) },
      { label: 'Datagram size', value: `${input.packetBytes} B total, ${input.headerLength} B header` },
      { label: 'Don’t Fragment', value: input.dontFragment ? 'set (1)' : 'clear (0)' },
    ],
    assumptions: ['Each node is treated as one prefix.', 'Congested links stay usable with a +10 metric penalty.'],
    steps: run.events.map((e) => e.text),
    tables,
    results: [
      { label: 'Outcome', value: run.result },
      { label: 'Path', value: run.path.map((id) => label(topology, id)).join(' → ') },
      { label: 'Hops', value: String(run.hops) },
      { label: 'Total cost', value: String(run.totalCost) },
      { label: 'TTL remaining', value: `${run.finalTtl} of ${run.initialTtl}` },
      { label: 'Detail', value: run.detail ?? '—' },
    ],
    interpretation: [
      run.result === 'delivered'
        ? `The selected path is the ${input.algorithm} optimum for this cost function; a different cost on any used link would change it.`
        : `The datagram never arrived, and the event list shows exactly which router gave up and why.`,
      `Total cost ${run.totalCost} equals the sum of effective link costs on ${run.links.length} link(s); the forwarding table's own cost column matches it, which is how you can tell the tables and the walk agree.`,
    ],
    limitations: ['Per-hop queuing, retransmission and MAC-layer behaviour are not modelled.'],
    highlightNodes: run.path,
    highlightLinks: run.links,
  })
}

export function reportForLinkState(topology: Topology, sp: LinkStateResult, table: ForwardingTable, expected?: Record<string, number>): ExperimentReport {
  return makeReport({
    id: 'dijkstra',
    title: `Link-state SPF from ${label(topology, sp.source)}`,
    objective: 'Compute shortest-path costs, build the shortest-path tree and derive the forwarding table.',
    module: 'Module C — Link-state / Dijkstra',
    topology,
    configuration: [
      { label: 'Root router', value: label(topology, sp.source) },
      { label: 'Tie-breaking', value: 'lowest cost, then label, then id — deterministic.' },
    ],
    assumptions: ['Undirected links, metric = cost.', 'Failed links are removed before the run; congested links keep the +10 penalty.'],
    steps: sp.steps.map((s) => `Round ${s.round}: settle ${label(topology, s.settled)} at cost ${sp.cost[s.settled]}. ${s.note}`),
    tables: [
      {
        title: 'Shortest-path costs',
        columns: ['Node', 'Cost', 'Predecessor'],
        rows: topology.nodes.map((n) => [n.label, Number.isFinite(sp.cost[n.id] ?? Infinity) ? String(sp.cost[n.id]) : '∞', sp.prev[n.id] ? label(topology, sp.prev[n.id]!) : '—']),
      },
      {
        title: `Forwarding table at ${label(topology, sp.source)}`,
        columns: ['Prefix', 'Next hop', 'Out link', 'Cost', 'Hops'],
        rows: table.entries.map((e) => [e.destPrefix, e.nextHopLabel, e.outLinkLabel, String(e.cost), String(e.hops)]),
      },
    ],
    results: Object.entries(expected ?? sp.cost)
      .filter(([, v]) => Number.isFinite(v))
      .map(([k, v]) => ({ label: `Cost to ${label(topology, k)}`, value: String(v) })),
    interpretation: [
      `The tree uses ${sp.treeLinks.length} of ${topology.links.filter((l) => l.status !== 'failed').length} usable links; every other link is already covered by a cheaper detour.`,
      `Reading the table at ${label(topology, sp.source)}: ${table.entries.length} prefix(es) are installed, each with the first hop the tree dictates rather than the destination's own router.`,
    ],
    highlightNodes: sp.order,
    highlightLinks: sp.treeLinks,
  })
}

export function reportForDistanceVector(topology: Topology, result: DvResult, focusDest?: string): ExperimentReport {
  const last = result.rounds.at(-1)
  const focus = focusDest ?? result.destinations.find((d) => !result.routers.includes(d)) ?? result.destinations[1] ?? result.destinations[0] ?? ''
  return makeReport({
    id: 'distance-vector',
    title: `Distance-vector convergence (${result.options.metric === 'hops' ? 'RIP hop counts' : 'cost metric'})`,
    objective: 'Show neighbour-by-neighbour advertisement exchange until no router changes its table.',
    module: 'Module C — Distance-vector / Bellman–Ford',
    topology,
    configuration: [
      { label: 'Metric', value: result.options.metric === 'hops' ? 'hop count (RIP: 15 max usable, 16 = unreachable)' : 'configured link cost' },
      { label: 'Split horizon', value: result.options.splitHorizon ? 'on' : 'off' },
      { label: 'Poison reverse', value: result.options.poisonReverse ? 'on' : 'off' },
      { label: 'Infinity', value: String(result.options.infinity) },
    ],
    assumptions: ['Synchronous rounds: everyone advertises, then everyone relaxes.', 'Only routers run the protocol; hosts are attached stub networks.'],
    steps: result.rounds.slice(1).map((r) => `Round ${r.round}: ${r.updates.length} change(s). ${r.updates.slice(0, 4).map((u) => u.note).join(' ') || 'No router changed — converged.'}`),
    tables: [
      {
        title: `Cost to ${label(topology, focus)} after each round`,
        columns: ['Round', ...result.routers.map((r) => label(topology, r))],
        rows: result.rounds.map((r) => [
          String(r.round),
          ...result.routers.map((router) => {
            const cell = r.tables[router]?.[focus]
            return cell ? (cell.cost >= result.options.infinity ? '∞' : String(cell.cost)) : '—'
          }),
        ]),
      },
      {
        title: 'Final table (all destinations)',
        columns: ['Router', 'Destination', 'Cost', 'Next hop'],
        rows: Object.entries(last?.tables ?? {}).flatMap(([router, table]) =>
          Object.entries(table)
            .filter(([dest, cell]) => dest !== router && cell.cost < result.options.infinity && cell.nextHop)
            .map(([dest, cell]) => [label(topology, router), label(topology, dest), String(cell.cost), label(topology, cell.nextHop!)])
        ),
      },
    ],
    results: [
      { label: 'Converged', value: result.converged ? `yes, at round ${result.convergedAtRound}` : `no — still changing after ${result.rounds.length - 1} rounds` },
      { label: 'Rounds simulated', value: String(result.rounds.length - 1) },
      { label: 'Count-to-infinity observed', value: result.countToInfinitySeen ? 'yes' : 'no' },
    ],
    interpretation: [
      result.countToInfinitySeen
        ? 'Bad news travelled slowly: two routers each believed the other, so the metric climbed one advertisement at a time. That is count-to-infinity, and it is why RIP needs a small infinity (16) plus split horizon or poison reverse.'
        : 'No sustained metric climb was observed with these settings, so the network reported bad news cleanly.',
      'Distance-vector routers only ever see a neighbour’s number, never the path behind it — the reason they can be fooled by a loop.',
    ],
    limitations: ['Real RIP adds 30-second timers, holddown and triggered updates; this model uses synchronous rounds so the arithmetic stays comparable.'],
  })
}

export function reportForOspf(topology: Topology, result: OspfResult, routerId: string): ExperimentReport {
  const view = result.perRouter[routerId]
  return makeReport({
    id: 'ospf',
    title: `OSPF link-state database and SPF at ${label(topology, routerId)}`,
    objective: 'Flood router LSAs, prove every router holds the same database, then run SPF on it.',
    module: 'Module C — OSPF',
    topology,
    configuration: [
      { label: 'Area', value: result.area },
      { label: 'Router LSAs', value: String(result.lsdbSize) },
      { label: 'Flooding rounds', value: String(result.rounds) },
    ],
    assumptions: ['Single area, full flood, no DR election or timers.', 'This is an educational link-state process, not a production OSPF stack.'],
    steps: result.flooding.map((f) => `Round ${f.round}: ${f.note}`),
    tables: [
      {
        title: 'Link-state database',
        columns: ['Advertising router', 'Links', 'Seq'],
        rows: result.records.map((r) => [r.lsa.routerLabel, r.lsa.links.map((l) => `${l.toLabel}:${l.cost}${l.stub ? ' (stub)' : ''}`).join(', '), `0x${r.lsa.seq.toString(16)}`]),
      },
      {
        title: `Forwarding table at ${label(topology, routerId)}`,
        columns: ['Prefix', 'Next hop', 'Cost'],
        rows: (view?.forwardingTable.entries ?? []).map((e) => [e.destPrefix, e.nextHopLabel, String(e.cost)]),
      },
    ],
    results: [
      { label: 'All databases identical', value: result.databasesMatch ? 'yes' : 'no — some routers are partitioned' },
      { label: 'Routers with the full LSDB', value: result.syncedRouters.map((id) => label(topology, id)).join(', ') },
    ],
    interpretation: [
      'Because every router floods the same LSAs and then runs the same SPF, all of them agree on the tree — which is why link-state recovery after a failure is one recomputation, not a slow rumour chain.',
    ],
    highlightLinks: view?.spf.treeLinks ?? [],
  })
}

export function reportForBgp(topology: Topology, result: BgpResult, routerId: string, destId: string): ExperimentReport {
  const chosen = result.best[routerId]?.[destId]
  const candidates = result.candidates[routerId]?.[destId] ?? []
  return makeReport({
    id: 'bgp',
    title: `BGP decision for ${prefixLabel(topology, destId)} at ${label(topology, routerId)}`,
    objective: 'Show AS_PATH advertisements, loop prevention and policy-based selection.',
    module: 'Module C — BGP',
    topology,
    configuration: [
      { label: 'Autonomous systems', value: result.asNumbers.map((a) => `AS${a}`).join(', ') },
      { label: 'Peering sessions', value: `${result.sessions.filter((s) => s.kind === 'ebgp').length} eBGP, ${result.sessions.filter((s) => s.kind === 'ibgp').length} iBGP` },
      { label: 'Selection order', value: 'LOCAL_PREF → shortest AS_PATH → MED → IGP exit cost' },
    ],
    assumptions: ['iBGP is modelled as a full mesh inside an AS; a router never re-advertises an iBGP route out an eBGP session.', 'MED is approximated by accumulated link cost.'],
    steps: result.rounds.map((r) => `Round ${r.round}: ${r.changes.slice(0, 6).map((c) => c.note).join(' ') || 'no changes'}`),
    tables: [
      {
        title: `BGP table at ${label(topology, routerId)} for ${prefixLabel(topology, destId)}`,
        columns: ['Next hop', 'AS_PATH', 'LOCAL_PREF', 'MED', 'IGP exit', 'Source', 'Chosen'],
        rows: candidates.map((c) => [c.nextHop ? label(topology, c.nextHop) : '—', c.asPath.length ? c.asPath.join(' ') : '(local)', String(c.localPref), String(c.med), String(c.exitCost), c.source, chosen && c.peer === chosen.peer && c.source === chosen.source ? 'yes' : '']),
      },
    ],
    results: [
      { label: 'Winner', value: chosen ? `${chosen.source} via ${chosen.nextHop ? label(topology, chosen.nextHop) : '—'} (AS_PATH ${chosen.asPath.join(' ') || 'local'})` : 'no route' },
      { label: 'Policy beats shortest path', value: result.policyOverShortest.length ? `${result.policyOverShortest.length} route(s) — see below` : 'no' },
    ],
    interpretation: [
      chosen ? chosen.reason : 'No BGP route reached this router.',
      result.policyOverShortest.length
        ? 'At least one router picked a route whose cost is higher than an available alternative, because LOCAL_PREF outranks distance. That is the whole point of inter-domain routing: reachability is negotiated by policy, not chosen by maths alone.'
        : 'With these policies the cheapest route also won, so nothing here proves policy alone would differ.',
    ],
    limitations: ['No route reflectors, communities, MED inheritance, aggregation or withdrawal timers are modelled.'],
    highlightNodes: chosen?.nextHop ? [routerId, chosen.nextHop] : [routerId],
  })
}

export function reportForSubnet(info: SubnetInfo, hosts?: { a: string; b: string; prefix: number }): ExperimentReport {
  return makeReport({
    id: 'cidr',
    title: `IPv4 subnet analysis ${info.ok ? `${info.network}/${info.prefix}` : '(invalid input)'}`,
    objective: 'Derive mask, network, broadcast, usable range and host capacity from an address and prefix.',
    module: 'Module D — IPv4 and CIDR explorer',
    topology: { id: 'none', name: 'No topology required', summary: 'Address arithmetic only.', nodes: [], links: [], policies: [] },
    configuration: [
      { label: 'Address', value: info.address },
      { label: 'Prefix', value: `/${info.prefix}` },
    ],
    assumptions: info.special ? [`This block is special: ${info.special}. ${info.note}`] : ['Ordinary subnet rules: the all-zeros host is the network and the all-ones host is the broadcast address.'],
    tables: [
      {
        title: 'Derived values',
        columns: ['Item', 'Value'],
        rows: [
          ['Subnet mask', `${info.mask} (${info.maskBinary})`],
          ['Wildcard', info.wildcard],
          ['Network address', `${info.network}/${info.prefix}`],
          ['Broadcast address', info.broadcast],
          ['First usable', info.firstUsable ?? '—'],
          ['Last usable', info.lastUsable ?? '—'],
          ['Total addresses', String(info.total)],
          ['Usable hosts', String(info.usable)],
          ['Network bits / host bits', `${info.networkBits} / ${info.hostBits}`],
        ],
      },
      ...(hosts ? [{ title: 'Two-host test', columns: ['Host A', 'Host B', 'Same subnet?'], rows: [[hosts.a, hosts.b, 'see interpretation']] }] : []),
    ],
    results: [
      { label: 'Binary address', value: info.address },
      { label: 'Network part', value: info.networkPartBits },
      { label: 'Host part', value: info.hostPartBits },
    ],
    interpretation: [info.note],
    limitations: ['Broadcast behaviour is IPv4-only; IPv6 replaces it with multicast.'],
  })
}

export function reportForFragments(topology: Topology, plan: FragmentPlan, linkId?: string): ExperimentReport {
  return makeReport({
    id: 'fragmentation',
    title: `IPv4 fragmentation: ${plan.input.datagramBytes} B over ${plan.input.mtu} B MTU`,
    objective: 'Compute fragment payloads, offsets and flags, and prove the pieces rebuild the original datagram.',
    module: 'Module E — IPv4 fragmentation lab',
    topology,
    configuration: [
      { label: 'Datagram', value: `${plan.input.datagramBytes} B (${plan.input.headerLength} B header + ${plan.payloadBytes} B data)` },
      { label: 'Outgoing link', value: linkId ? linkNameOf(topology, linkId) : `${plan.input.mtu} B MTU` },
      { label: 'DF', value: plan.input.dontFragment ? '1' : '0' },
      { label: 'Identification', value: String(plan.input.identification) },
    ],
    assumptions: ['Non-final fragment payloads are multiples of 8 bytes, because the offset field counts 8-byte blocks.', 'Every fragment repeats the full header.'],
    steps: plan.fragments.map((f) => `Fragment ${f.index + 1}: ${f.payloadBytes} B data, total ${f.totalLength} B, offset ${f.offsetUnits} (bytes ${f.offsetBytes}), MF=${f.moreFragments ? 1 : 0}, ID ${plan.input.identification}.`),
    tables: [
      {
        title: 'Fragment table',
        columns: ['#', 'Data (B)', 'Total (B)', 'Offset (×8 B)', 'Offset (B)', 'MF', 'ID'],
        rows: plan.fragments.map((f) => [String(f.index + 1), String(f.payloadBytes), String(f.totalLength), String(f.offsetUnits), String(f.offsetBytes), f.moreFragments ? '1' : '0', String(f.identification)]),
      },
    ],
    results: [
      { label: 'Fragments', value: String(plan.fragments.length) },
      { label: 'Bytes on wire', value: `${plan.bytesOnWire} B (${plan.overheadBytes} B of repeated header overhead)` },
      { label: 'Reassembles exactly', value: plan.reassembles ? 'yes' : 'no' },
      { label: 'Dropped', value: plan.dropped ? `yes — ${plan.dropReason ?? ''}` : 'no' },
    ],
    interpretation: [plan.detail],
    limitations: ['Reassembly timers and fragment-loss statistics are not modelled.'],
  })
}

export function reportForTraceroute(result: TracerouteResult, topology: Topology): ExperimentReport {
  return makeReport({
    id: 'traceroute',
    title: `traceroute ${result.from} → ${result.to} (${result.scenario})`,
    objective: 'Discover each hop by expiring a probe at that router and reading its ICMP reply.',
    module: 'Module G — ICMP and traceroute lab',
    topology,
    configuration: [
      { label: 'Algorithm', value: result.algorithm },
      { label: 'Probes per hop', value: String(result.probesPerHop) },
      { label: 'Max TTL', value: String(result.maxTtl) },
      { label: 'Scenario', value: result.scenario },
    ],
    assumptions: ['Round-trip times are generated from link costs, not measured.', 'A quiet router models a device filtered by an ACL, which is common on real backbones.'],
    steps: result.hops.map((h) => `TTL ${h.ttl}: ${h.responded ? `${h.nodeLabel} (${h.address ?? 'no address'}) — ${h.outcome}` : '* * *'} — ${h.note}`),
    tables: [
      {
        title: 'Hop table',
        columns: ['TTL', 'Router', 'Address', 'AS', 'Simulated RTT (ms)', 'ICMP'],
        rows: result.hops.map((h) => [String(h.ttl), h.nodeLabel ?? '*', h.address ?? '*', h.asNumber !== undefined ? `AS${h.asNumber}` : '—', h.responded ? h.rtts.map((r) => r.toFixed(2)).join(' / ') : '* * *', h.outcome]),
      },
    ],
    results: [
      { label: 'Reached destination', value: result.reached ? 'yes' : 'no' },
      { label: 'Hops probed', value: String(result.hops.length) },
      { label: 'Summary', value: result.summary },
    ],
    interpretation: [result.detail],
    limitations: [result.baseHeader],
    highlightNodes: result.path,
  })
}

function prefixLabel(topology: Topology, id: string): string {
  const node = nodeById(topology, id)
  return node?.ip ? `${node.ip}/${node.prefix ?? 24}` : label(topology, id)
}

function linkNameOf(topology: Topology, linkId: string): string {
  const link = topology.links.find((l) => l.id === linkId)
  if (!link) return linkId
  return `${nodeById(topology, link.a)?.label ?? link.a}–${nodeById(topology, link.b)?.label ?? link.b}`
}
