import { useMemo, useState } from 'react'
import type { RoutingAlgorithm } from '../core/types'
import {
  VC_VS_DATAGRAM,
  failCircuit,
  linkName,
  sendDatagramBurst,
  sendDataOnCircuit,
  setupVirtualCircuit,
  teardownCircuit,
} from '../core/circuit'
import { nodeById } from '../core/graph'
import { label } from '../core/routing'
import { useStore } from '../state/store'
import { TopologyCanvas } from '../components/TopologyCanvas'
import { Badge, DataTable, Notice, Panel, SelectField, NumberField } from '../components/ui'
import { makeReport, reportToMarkdown } from '../core/report'
import { downloadText } from './download'

const ALGORITHMS: { value: RoutingAlgorithm; label: string }[] = [
  { value: 'link-state', label: 'Link-state (Dijkstra)' },
  { value: 'distance-vector', label: 'Distance-vector' },
  { value: 'rip', label: 'RIP' },
  { value: 'ospf', label: 'OSPF' },
  { value: 'bgp', label: 'BGP' },
]

export function CircuitModule() {
  const { state } = useStore()
  const topology = state.topology
  const [algorithm, setAlgorithm] = useState<RoutingAlgorithm>(state.packet.algorithm)
  const [srcId, setSrc] = useState(state.packet.srcId)
  const [dstId, setDst] = useState(state.packet.dstId)
  const [startVci, setStartVci] = useState(100)
  const [packets, setPackets] = useState(3)
  const [failLink, setFailLink] = useState('')

  const src = topology.nodes.some((n) => n.id === srcId) ? srcId : topology.nodes[0]?.id ?? ''
  const dst = topology.nodes.some((n) => n.id === dstId) ? dstId : topology.nodes.at(-1)?.id ?? ''

  const setup = useMemo(() => setupVirtualCircuit(topology, algorithm, src, dst, startVci), [topology, algorithm, src, dst, startVci])
  const data = useMemo(() => (setup.ok ? sendDataOnCircuit(setup, packets) : []), [setup, packets])
  const torn = useMemo(() => (setup.ok ? teardownCircuit(setup) : []), [setup])
  const vcFailure = useMemo(
    () => (setup.ok && failLink ? failCircuit(topology, setup, failLink) : null),
    [setup, topology, failLink]
  )

  const burst = useMemo(
    () =>
      sendDatagramBurst({
        topology,
        algorithm,
        srcId: src,
        dstId: dst,
        packets,
        failLinkId: failLink || undefined,
        failAfterPacket: 1,
      }),
    [topology, algorithm, src, dst, packets, failLink]
  )

  const report = () =>
    makeReport({
      id: 'vc-vs-datagram',
      title: `Virtual circuit vs datagram: ${label(topology, src)} → ${label(topology, dst)}`,
      objective: 'Contrast per-call state (set up once, identifiers swapped per hop) with per-packet destination lookup.',
      module: 'Module H — Circuit-switching vs datagram-switching',
      topology,
      configuration: [
        { label: 'Routing used to pick the path', value: algorithm },
        { label: 'Starting VCI', value: String(startVci) },
        { label: 'Packets / burst', value: String(packets) },
        { label: 'Link forced to fail', value: failLink ? linkName(topology, failLink) : 'none' },
      ],
      steps: [
        ...setup.events.map((e) => `Circuit: ${e}`),
        ...burst.events.map((e) => `Datagram: ${e}`),
      ],
      tables: [
        {
          title: 'Call-establishment table (per-call state)',
          columns: ['Router', 'In link', 'In VCI', 'Out link', 'Out VCI', 'Next hop'],
          rows: setup.entries.map((e) => [e.routerLabel, e.incomingLink ?? '—', String(e.incomingVci), e.outgoingLink, String(e.outgoingVci), e.nextHopLabel]),
        },
        {
          title: 'Datagram burst',
          columns: ['Packet', 'Path', 'Cost', 'Arrival', 'Delivered'],
          rows: burst.packets.map((p) => [String(p.index + 1), p.path.map((id) => label(topology, id)).join('→'), p.delivered ? String(p.cost) : '∞', p.delivered ? String(p.arrival) : '—', p.delivered ? 'yes' : 'no']),
        },
      ],
      results: [
        { label: 'Circuit established', value: setup.ok ? `yes, one-way cost ${setup.cost}` : `no — ${setup.failure ?? ''}` },
        { label: 'Circuit broken by failure', value: vcFailure ? (vcFailure.interrupted ? 'yes' : 'no') : 'not tested' },
        { label: 'Datagram arrival out of order', value: burst.outOfOrder ? 'yes' : 'no' },
      ],
      interpretation: [
        setup.ok
          ? 'The circuit path is frozen at setup: every packet reuses the stored (link, VCI) entries and no hop re-looks-up a destination.'
          : 'No circuit could be established on this topology/algorithm.',
        'The datagram network recomputes the lookup for every packet, so a mid-flight table change redirects only the packets that arrive after it — the reason a transport layer must reorder.',
      ],
    })

  return (
    <div className="workspace cols-2">
      <div className="stack">
        <Panel
          title="Endpoints & options"
          actions={<button className="btn sm" onClick={() => downloadText('vc-vs-datagram.md', reportToMarkdown(report()))}>Report</button>}
        >
          <div className="row-grid">
            <SelectField label="Source" value={src} onChange={setSrc} options={topology.nodes.map((n) => ({ value: n.id, label: n.label }))} />
            <SelectField label="Destination" value={dst} onChange={setDst} options={topology.nodes.map((n) => ({ value: n.id, label: n.label }))} />
          </div>
          <SelectField label="Path chosen by" value={algorithm} onChange={(v) => setAlgorithm(v as RoutingAlgorithm)} options={ALGORITHMS} />
          <div className="row-grid">
            <NumberField label="Starting VCI" value={startVci} min={1} max={65535} onChange={(n) => setStartVci(clamp(n, 1, 65535))} />
            <NumberField label="Packets" value={packets} min={1} max={10} onChange={(n) => setPackets(clamp(n, 1, 10))} />
          </div>
          <SelectField
            label="Force a link to fail"
            value={failLink}
            onChange={setFailLink}
            options={[{ value: '', label: '— none —' }, ...topology.links.map((l) => ({ value: l.id, label: linkName(topology, l.id) }))]}
          />
        </Panel>

        <Panel title="Circuit path" hint={setup.ok ? `VCI ${startVci} · one-way cost ${setup.cost}` : setup.failure ?? 'Unavailable'}>
          <div style={{ height: 320 }}>
            <TopologyCanvas
              topology={topology}
              interactive={false}
              sourceId={src}
              destId={dst}
              highlight={{ nodes: setup.path, links: setup.links }}
            />
          </div>
        </Panel>

        <Panel title="Side by side">
          <DataTable columns={['Aspect', 'Virtual circuit', 'Datagram']} rows={VC_VS_DATAGRAM.map((r) => [r.aspect, r.circuit, r.datagram])} />
        </Panel>
      </div>

      <div className="stack">
        <Panel title="1 · Call setup" actions={<Badge tone={setup.ok ? 'ok' : 'bad'}>{setup.ok ? 'CONNECT' : 'FAILED'}</Badge>}>
          <EventList lines={setup.events} />
          {setup.ok ? (
            <div className="mt">
              <DataTable
                columns={['Router', 'In VCI', 'Out link', 'Out VCI', 'Next hop']}
                rows={setup.entries.map((e) => [e.routerLabel, String(e.incomingVci), e.outgoingLink, String(e.outgoingVci), e.nextHopLabel])}
              />
            </div>
          ) : null}
        </Panel>

        <Panel title="2 · Data on the circuit">
          <EventList lines={data} tone="packet" />
          {vcFailure ? <Notice tone={vcFailure.interrupted ? 'bad' : 'warn'}>{vcFailure.note}</Notice> : null}
        </Panel>

        <Panel title="3 · Tear down">
          <EventList lines={torn} tone="muted" />
        </Panel>

        <Panel title="Datagram burst" hint={burst.disclaimer} actions={<Badge tone={burst.outOfOrder ? 'warn' : 'ok'}>{burst.outOfOrder ? 'out of order' : 'in order'}</Badge>}>
          <DataTable
            columns={['Pk', 'Path', 'Cost', 'Arrival', 'Note']}
            rows={burst.packets.map((p) => [String(p.index + 1), p.path.map((id) => nodeById(topology, id)?.label ?? id).join('→'), p.delivered ? String(p.cost) : '∞', p.delivered ? String(p.arrival) : '—', p.delivered ? '' : 'dropped'])}
          />
          <EventList lines={burst.events} tone="info" />
        </Panel>
      </div>
    </div>
  )
}

function EventList({ lines, tone }: { lines: string[]; tone?: 'packet' | 'muted' | 'info' }) {
  if (!lines.length) return <p className="hint">Nothing to show yet.</p>
  return (
    <ol className="stack" style={{ gap: 6, margin: 0, paddingLeft: 20 }}>
      {lines.map((l, i) => (
        <li key={i} className="small" style={{ color: tone === 'muted' ? 'var(--text-faint)' : 'var(--text-dim)' }}>
          {l}
        </li>
      ))}
    </ol>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
