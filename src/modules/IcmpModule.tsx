import { useMemo, useState } from 'react'
import type { RoutingAlgorithm } from '../core/types'
import type { TracerouteScenario } from '../core/icmp'
import { ICMP_MESSAGES, RTT_DISCLAIMER, runTraceroute, simulatePing } from '../core/icmp'
import { nodeById } from '../core/graph'
import { useStore } from '../state/store'
import { TopologyCanvas } from '../components/TopologyCanvas'
import { Badge, DataTable, Notice, Panel, SelectField, NumberField } from '../components/ui'
import { reportForTraceroute, reportToMarkdown } from '../core/report'
import { downloadText } from './download'

const ALGORITHMS: { value: RoutingAlgorithm; label: string }[] = [
  { value: 'link-state', label: 'Link-state (Dijkstra)' },
  { value: 'distance-vector', label: 'Distance-vector' },
  { value: 'rip', label: 'RIP' },
  { value: 'ospf', label: 'OSPF' },
  { value: 'bgp', label: 'BGP' },
]

const SCENARIOS: { value: TracerouteScenario; label: string }[] = [
  { value: 'success', label: 'Normal path (reaches destination)' },
  { value: 'unreachable', label: 'Router with no route (ICMP Unreachable)' },
  { value: 'filtered-router', label: 'Filtered hop (a router stays silent)' },
  { value: 'ttl-too-small', label: 'Max TTL too small (never arrives)' },
  { value: 'loop', label: 'Forwarding loop (only TTL kills it)' },
]

export function IcmpModule() {
  const { state } = useStore()
  const topology = state.topology
  const routers = useMemo(() => topology.nodes.filter((n) => n.kind === 'router'), [topology])
  const [algorithm, setAlgorithm] = useState<RoutingAlgorithm>(state.packet.algorithm)
  const [fromId, setFrom] = useState(state.packet.srcId)
  const [toId, setTo] = useState(state.packet.dstId)
  const [scenario, setScenario] = useState<TracerouteScenario>('success')
  const [probes, setProbes] = useState(3)
  const [maxTtl, setMaxTtl] = useState(8)
  const [silentId, setSilent] = useState(routers[0]?.id ?? '')

  const from = topology.nodes.some((n) => n.id === fromId) ? fromId : topology.nodes[0]?.id ?? ''
  const to = topology.nodes.some((n) => n.id === toId) ? toId : topology.nodes.at(-1)?.id ?? ''
  const silent = topology.nodes.some((n) => n.id === silentId) ? silentId : routers[0]?.id ?? ''

  const loopPath = useMemo(() => {
    const ids = routers.slice(0, 3).map((r) => r.id)
    if (ids.length < 2) return undefined
    return [from, ...ids, ids[ids.length - 1]!, ids[0]!, ids[ids.length - 1]!]
  }, [routers, from])

  const result = useMemo(
    () =>
      runTraceroute({
        topology,
        algorithm,
        fromId: from,
        toId: to,
        probesPerHop: probes,
        maxTtl: scenario === 'ttl-too-small' ? Math.min(maxTtl, 3) : maxTtl,
        scenario,
        silentRouterId: silent,
        loopPath,
      }),
    [topology, algorithm, from, to, probes, maxTtl, scenario, silent, loopPath]
  )

  const ping = useMemo(
    () => simulatePing({ topology, algorithm, fromId: from, toId: to, count: probes }),
    [topology, algorithm, from, to, probes]
  )

  const outcomeTone = result.reached ? 'ok' : result.scenario === 'unreachable' ? 'bad' : 'warn'

  return (
    <div className="workspace cols-2">
      <div className="stack">
        <Panel
          title="traceroute setup"
          actions={
            <button className="btn sm" onClick={() => downloadText('traceroute.md', reportToMarkdown(reportForTraceroute(result, topology)))}>
              Report
            </button>
          }
        >
          <div className="row-grid">
            <SelectField label="Source" value={from} onChange={setFrom} options={topology.nodes.map((n) => ({ value: n.id, label: n.label }))} />
            <SelectField label="Destination" value={to} onChange={setTo} options={topology.nodes.map((n) => ({ value: n.id, label: n.label }))} />
          </div>
          <SelectField label="Routing algorithm" value={algorithm} onChange={(v) => setAlgorithm(v as RoutingAlgorithm)} options={ALGORITHMS} />
          <SelectField label="Scenario" value={scenario} onChange={(v) => setScenario(v as TracerouteScenario)} options={SCENARIOS} />
          {scenario === 'filtered-router' ? (
            <SelectField label="Silent router" value={silent} onChange={setSilent} options={routers.map((r) => ({ value: r.id, label: r.label }))} />
          ) : null}
          <div className="row-grid">
            <NumberField label="Probes per hop" value={probes} min={1} max={5} onChange={(n) => setProbes(clamp(n, 1, 5))} />
            <NumberField label="Max TTL" value={maxTtl} min={1} max={30} onChange={(n) => setMaxTtl(clamp(n, 1, 30))} />
          </div>
        </Panel>

        <Panel title="Path" hint={`${result.path.map((id) => nodeById(topology, id)?.label ?? id).join(' → ')}`}>
          <div style={{ height: 340 }}>
            <TopologyCanvas
              topology={topology}
              interactive={false}
              sourceId={from}
              destId={to}
              highlight={{ nodes: result.path, links: [] }}
            />
          </div>
        </Panel>

        <Notice tone="warn">{RTT_DISCLAIMER}</Notice>
      </div>

      <div className="stack">
        <Panel title="traceroute output" actions={<Badge tone={outcomeTone}>{result.reached ? 'reached' : 'no reply'}</Badge>}>
          <div className="small muted" style={{ marginBottom: 8 }}>
            traceroute to {result.to} ({nodeById(topology, to)?.ip ?? result.to}), {result.maxTtl} hops max, {probes} probes per hop
          </div>
          <DataTable
            columns={['#', 'Host', 'Sim RTT (ms)', 'ICMP']}
            rows={result.hops.map((h) => [
              String(h.ttl),
              h.responded ? `${h.nodeLabel}${h.address ? ` (${h.address})` : ''}${h.asNumber !== undefined ? ` AS${h.asNumber}` : ''}` : '* * *',
              h.responded ? h.rtts.map((r) => r.toFixed(2)).join(' / ') : '*',
              h.outcome,
            ])}
          />
          <Notice tone={outcomeTone === 'ok' ? 'ok' : 'warn'} >
            <div style={{ fontWeight: 600, marginBottom: 3 }}>{result.summary}</div>
            <div className="small">{result.detail}</div>
          </Notice>
        </Panel>

        <Panel title="ping" hint="Same simulated latencies, echo request/reply.">
          <pre className="mono small" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', margin: 0 }}>
            {ping.lines.join('\n')}
          </pre>
          <div className="stat-grid mt">
            <Stat label="Sent" value={String(ping.sent)} />
            <Stat label="Received" value={String(ping.received)} />
            <Stat label="Loss" value={`${ping.loss}%`} />
            <Stat label="min / avg / max" value={ping.received ? `${ping.min.toFixed(2)} / ${ping.avg.toFixed(2)} / ${ping.max.toFixed(2)} ms` : '—'} />
          </div>
        </Panel>

        <Panel title="ICMP messages" hint="What each reply means.">
          <DataTable columns={['Type', 'Code', 'When']} rows={ICMP_MESSAGES.map((m) => [m.type, m.code, m.when])} />
        </Panel>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v" style={{ fontSize: 14 }}>{value}</div>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
