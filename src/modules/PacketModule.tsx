import { useEffect, useMemo, useRef, useState } from 'react'
import type { RoutingAlgorithm } from '../core/types'
import { nodeById, effectiveCost, linkById } from '../core/graph'
import { simulatePacket } from '../core/packetSim'
import { useStore } from '../state/store'
import { TopologyCanvas } from '../components/TopologyCanvas'
import { Badge, Panel, SelectField, NumberField, Checkbox, formatNum } from '../components/ui'

const ALGORITHMS: { value: RoutingAlgorithm; label: string }[] = [
  { value: 'link-state', label: 'Link-state (Dijkstra)' },
  { value: 'distance-vector', label: 'Distance-vector (Bellman–Ford)' },
  { value: 'rip', label: 'RIP (hop count)' },
  { value: 'ospf', label: 'OSPF (link-state)' },
  { value: 'bgp', label: 'BGP (policy)' },
]

export function PacketModule() {
  const { state, dispatch } = useStore()
  const topology = state.topology
  const cfg = state.packet

  const run = useMemo(
    () =>
      simulatePacket({
        topology,
        algorithm: cfg.algorithm,
        srcId: cfg.srcId,
        dstId: cfg.dstId,
        initialTtl: cfg.initialTtl,
        packetBytes: cfg.packetBytes,
        headerLength: cfg.headerLength,
        dontFragment: cfg.dontFragment,
      }),
    [topology, cfg.algorithm, cfg.srcId, cfg.dstId, cfg.initialTtl, cfg.packetBytes, cfg.headerLength, cfg.dontFragment]
  )

  const events = run.events
  const [idx, setIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)

  const reset = () => {
    setPlaying(false)
    setIdx(-1)
  }

  useEffect(() => {
    reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology, cfg.algorithm, cfg.srcId, cfg.dstId, cfg.initialTtl, cfg.packetBytes, cfg.headerLength, cfg.dontFragment])

  useEffect(() => {
    if (!playing) return
    if (idx >= events.length - 1) {
      setPlaying(false)
      return
    }
    timer.current = window.setTimeout(() => setIdx((i) => Math.min(events.length - 1, i + 1)), Math.max(120, 760 / cfg.speed))
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [playing, idx, events.length, cfg.speed])

  const current = idx >= 0 ? events[idx] : null
  const visitedNodes = useMemo(() => events.slice(0, idx + 1).map((e) => e.nodeId).filter(Boolean) as string[], [events, idx])
  const visitedLinks = useMemo(() => events.slice(0, idx + 1).map((e) => e.linkId).filter(Boolean) as string[], [events, idx])
  const routeSoFar = run.path.slice(0, idx + 1)

  const packetAt = useMemo(() => {
    if (!current) return null
    if (current.linkId) {
      const link = linkById(topology, current.linkId)
      const a = link ? nodeById(topology, link.a) : null
      const b = link ? nodeById(topology, link.b) : null
      if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }
    const n = current.nodeId ? nodeById(topology, current.nodeId) : null
    return n ? { x: n.x, y: n.y } : null
  }, [current, topology])

  const costSoFar = useMemo(() => {
    let cost = 0
    for (let i = 1; i < routeSoFar.length; i += 1) {
      const link = topology.links.find((l) => (l.a === routeSoFar[i - 1] && l.b === routeSoFar[i]) || (l.a === routeSoFar[i] && l.b === routeSoFar[i - 1]))
      if (link) cost += effectiveCost(link)
    }
    return cost
  }, [routeSoFar, topology])

  const srcNode = nodeById(topology, cfg.srcId)
  const dstNode = nodeById(topology, cfg.dstId)
  const currentRouter = current?.nodeId ? nodeById(topology, current.nodeId) : null
  const nextHopId = current && run.path.indexOf(cfg.srcId) >= 0 ? routeSoFarLookahead(run.path, visitedNodes) : null
  const nextHop = nextHopId ? nodeById(topology, nextHopId) : null

  const resultTone = run.result === 'delivered' ? 'ok' : run.result === 'routing-loop' || run.result === 'ttl-expired' ? 'warn' : 'bad'

  return (
    <div className="workspace cols-sim">
      <div className="stack">
        <Panel title="Configure the datagram">
          <SelectField label="Source" value={cfg.srcId} onChange={(v) => dispatch({ type: 'setPacket', patch: { srcId: v } })} options={topology.nodes.map((n) => ({ value: n.id, label: n.label }))} />
          <SelectField label="Destination" value={cfg.dstId} onChange={(v) => dispatch({ type: 'setPacket', patch: { dstId: v } })} options={topology.nodes.map((n) => ({ value: n.id, label: n.label }))} />
          <SelectField label="Routing algorithm" value={cfg.algorithm} onChange={(v) => dispatch({ type: 'setPacket', patch: { algorithm: v } })} options={ALGORITHMS} />
          <div className="row-grid">
            <NumberField label="Packet size (B)" value={cfg.packetBytes} min={20} max={65535} onChange={(n) => dispatch({ type: 'setPacket', patch: { packetBytes: clamp(n, 20, 65535) } })} />
            <NumberField label="Header length (B)" value={cfg.headerLength} min={20} max={60} step={4} onChange={(n) => dispatch({ type: 'setPacket', patch: { headerLength: clamp(Math.round(n / 4) * 4, 20, 60) } })} />
            <NumberField label="Initial TTL" value={cfg.initialTtl} min={1} max={255} onChange={(n) => dispatch({ type: 'setPacket', patch: { initialTtl: clamp(n, 1, 255) } })} />
            <NumberField label="Packet count" value={cfg.count} min={1} max={20} onChange={(n) => dispatch({ type: 'setPacket', patch: { count: clamp(n, 1, 20) } })} />
          </div>
          <div className="row-grid">
            <Field label={`Speed · ${cfg.speed}×`}>
              <input type="range" min={0.5} max={4} step={0.5} value={cfg.speed} onChange={(e) => dispatch({ type: 'setPacket', patch: { speed: Number(e.target.value) } })} />
            </Field>
          </div>
          <Checkbox label="Don't Fragment (DF=1)" checked={cfg.dontFragment} onChange={(v) => dispatch({ type: 'setPacket', patch: { dontFragment: v } })} />
        </Panel>

        <Panel title="Result" actions={<Badge tone={resultTone}>{run.result}</Badge>}>
          <div className="kv"><span className="k">Path</span><span className="v">{run.path.map((id) => nodeById(topology, id)?.label ?? id).join(' → ')}</span></div>
          <div className="kv"><span className="k">Hops</span><span className="v">{run.hops}</span></div>
          <div className="kv"><span className="k">Total cost</span><span className="v">{formatNum(run.totalCost)}</span></div>
          <div className="kv"><span className="k">TTL used</span><span className="v">{run.initialTtl - run.finalTtl} (→ {run.finalTtl})</span></div>
          {run.fragments.length ? <div className="kv"><span className="k">Fragments</span><span className="v">{run.fragments.length} on {new Set(run.fragments.map((f) => f.linkId)).size} link(s)</span></div> : null}
          <p className="hint mt">{run.detail}</p>
        </Panel>
      </div>

      <div className="stack">
        <Panel title="Live journey" hint={playing ? 'Animating real simulation events…' : idx >= 0 ? 'Paused on a step.' : 'Press Play to send the datagram.'}>
          <div style={{ height: 420 }}>
            <TopologyCanvas
              topology={topology}
              sourceId={cfg.srcId}
              destId={cfg.dstId}
              highlight={{ nodes: visitedNodes, links: visitedLinks }}
              routePath={idx < 0 ? run.path : undefined}
              packetAt={packetAt}
              interactive={false}
            />
          </div>
          <div className="btn-row mt" style={{ justifyContent: 'center' }}>
            <button className="btn primary" onClick={() => (idx >= events.length - 1 ? (setIdx(0), setPlaying(true)) : setPlaying((p) => !p))}>
              {playing ? '⏸ Pause' : idx >= events.length - 1 ? '⟲ Replay' : '▶ Play'}
            </button>
            <button className="btn" onClick={() => { setPlaying(false); setIdx((i) => Math.min(events.length - 1, i + 1)) }}>⏭ Step</button>
            <button className="btn ghost" onClick={reset}>⏹ Reset</button>
          </div>
          <div className="small muted" style={{ textAlign: 'center', marginTop: 6 }}>
            Step {Math.max(0, idx + 1)} / {events.length} · datagram {cfg.count > 1 ? `1 of ${cfg.count} identical packets share this route` : '1'}
          </div>
        </Panel>
      </div>

      <div className="stack inspector">
        <Panel title="Packet inspection">
          <div className="kv"><span className="k">Source IP</span><span className="v">{srcNode?.ip ?? srcNode?.label ?? '—'}</span></div>
          <div className="kv"><span className="k">Dest IP</span><span className="v">{dstNode?.ip ?? dstNode?.label ?? '—'}</span></div>
          <div className="kv"><span className="k">Current router</span><span className="v">{currentRouter?.label ?? '—'}</span></div>
          <div className="kv"><span className="k">Next hop</span><span className="v">{nextHop?.label ?? '—'}</span></div>
          <div className="kv"><span className="k">Out link</span><span className="v">{current?.linkId ? linkById(topology, current.linkId)?.id ?? '—' : '—'}</span></div>
          <div className="kv"><span className="k">TTL now</span><span className="v">{current ? current.ttl : run.initialTtl}</span></div>
          <div className="kv"><span className="k">On wire</span><span className="v">{current ? current.packetSize : cfg.packetBytes} B</span></div>
          <div className="kv"><span className="k">Cost so far</span><span className="v">{formatNum(costSoFar)}</span></div>
          {current ? (
            <div className="notice info mt" style={{ fontSize: 12.5 }}>
              <div style={{ fontWeight: 600, marginBottom: 3 }}>{current.text}</div>
              <div className="muted">{current.why}</div>
            </div>
          ) : (
            <p className="hint mt">Select Play or Step to see the router's forwarding decision here.</p>
          )}
        </Panel>

        <Panel title="Event timeline" hint={`${events.length} events`}>
          <div className="timeline">
            {events.map((e, i) => (
              <div key={e.index} className={`event ${e.kind}${i === idx ? ' active' : ''}`} onClick={() => { setPlaying(false); setIdx(i) }}>
                <span className="idx">{i + 1}</span>
                <span className="dot" />
                <div>
                  <div>{e.text}</div>
                  {i === idx ? <div className="why">{e.why}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

function routeSoFarLookahead(path: string[], visited: string[]): string | null {
  if (visited.length === 0) return path[1] ?? null
  const last = visited[visited.length - 1]!
  const i = path.indexOf(last)
  return i >= 0 && i + 1 < path.length ? path[i + 1]! : null
}
