import { useMemo, useState } from 'react'
import type { ForwardingTable, RoutingAlgorithm, Topology } from '../core/types'
import { nodeById } from '../core/graph'
import { RoutingEngine, label } from '../core/routing'
import { dijkstra } from '../core/algorithms/linkState'
import {
  countToInfinityTrace,
  dvForwardingTable,
  runDistanceVector,
  type DvMetric,
} from '../core/algorithms/distanceVector'
import { runOspf } from '../core/algorithms/ospf'
import { runBgp } from '../core/algorithms/bgp'
import { useStore } from '../state/store'
import { TopologyCanvas } from '../components/TopologyCanvas'
import { Badge, DataTable, Empty, Notice, Panel, SelectField, Checkbox, formatNum } from '../components/ui'
import {
  reportForBgp,
  reportForDistanceVector,
  reportForLinkState,
  reportForOspf,
  reportToMarkdown,
} from '../core/report'
import { downloadText } from './download'

type Tab = RoutingAlgorithm

const TABS: { id: Tab; name: string }[] = [
  { id: 'link-state', name: 'Link-state (Dijkstra)' },
  { id: 'distance-vector', name: 'Distance-vector' },
  { id: 'rip', name: 'RIP' },
  { id: 'ospf', name: 'OSPF' },
  { id: 'bgp', name: 'BGP' },
]

export function RoutingModule() {
  const { state } = useStore()
  const topology = state.topology
  const [tab, setTab] = useState<Tab>('link-state')

  return (
    <div className="workspace cols-2">
      <div className="stack">
        <Panel title="Protocol" hint="All five run on the exact topology you built — nothing is precomputed.">
          <div className="mini-tab-row">
            {TABS.map((t) => (
              <button key={t.id} className={`tab-btn${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
                {t.name}
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Topology" hint={`${topology.nodes.length} nodes · ${topology.links.length} links`}>
          <div style={{ height: 380 }}>
            <ViewCanvas topology={topology} tab={tab} />
          </div>
        </Panel>
      </div>

      <div className="stack">
        {tab === 'link-state' ? <LinkStateView topology={topology} /> : null}
        {tab === 'distance-vector' || tab === 'rip' ? <DistanceVectorView topology={topology} algorithm={tab} /> : null}
        {tab === 'ospf' ? <OspfView topology={topology} /> : null}
        {tab === 'bgp' ? <BgpView topology={topology} /> : null}
      </div>
    </div>
  )
}

function ViewCanvas({ topology, tab }: { topology: Topology; tab: Tab }) {
  const [root, setRoot] = useState(() => firstRouter(topology))
  const rootId = topology.nodes.some((n) => n.id === root) ? root : firstRouter(topology)

  const highlight = useMemo(() => {
    if (tab === 'link-state') {
      const sp = dijkstra(topology, rootId)
      return { nodes: sp.order, links: sp.treeLinks }
    }
    if (tab === 'ospf') {
      const r = runOspf(topology)
      const view = r.perRouter[rootId]
      return { nodes: view?.spf.order ?? [], links: view?.spf.treeLinks ?? [] }
    }
    if (tab === 'bgp') {
      const r = runBgp(topology)
      const router = topology.nodes.find((n) => n.kind === 'router' && n.asNumber !== undefined)?.id ?? rootId
      const links: string[] = []
      for (const s of r.sessions) {
        if (s.linkId) links.push(s.linkId)
      }
      return { nodes: [router], links }
    }
    const engine = new RoutingEngine(topology, tab === 'rip' ? 'rip' : 'distance-vector')
    const links = new Set<string>()
    for (const n of topology.nodes) {
      if (n.kind !== 'router') continue
      const t = engine.forwardingTable(n.id)
      for (const e of t.entries) if (e.outLink) links.add(e.outLink)
    }
    return { nodes: topology.nodes.filter((n) => n.kind === 'router').map((n) => n.id), links: [...links] }
  }, [topology, tab, rootId])

  const showRoot = tab === 'link-state' || tab === 'ospf'
  return (
    <>
      {showRoot ? (
        <SelectField
          label="Root / viewing router"
          value={rootId}
          onChange={setRoot}
          options={topology.nodes.filter((n) => n.kind === 'router').map((n) => ({ value: n.id, label: n.label }))}
        />
      ) : null}
      <TopologyCanvas topology={topology} interactive highlight={highlight} />
    </>
  )
}

function LinkStateView({ topology }: { topology: Topology }) {
  const [root, setRoot] = useState(() => firstRouter(topology))
  const rootId = topology.nodes.some((n) => n.id === root) ? root : firstRouter(topology)
  const sp = useMemo(() => dijkstra(topology, rootId), [topology, rootId])
  const table = useMemo(() => new RoutingEngine(topology, 'link-state').forwardingTable(rootId), [topology, rootId])

  return (
    <>
      <Panel
        title="Dijkstra run"
        hint={`Shortest-path tree rooted at ${label(topology, rootId)}`}
        actions={
          <button className="btn sm" onClick={() => downloadText(`dijkstra-${rootId}.md`, reportToMarkdown(reportForLinkState(topology, sp, table)))}>
            Report
          </button>
        }
      >
        <SelectField
          label="Root router"
          value={rootId}
          onChange={setRoot}
          options={topology.nodes.filter((n) => n.kind === 'router').map((n) => ({ value: n.id, label: n.label }))}
        />
        <div className="section-title">Settlement order</div>
        <DataTable
          columns={['Round', 'Settled', 'Cost', 'Relaxed']}
          rows={sp.steps.map((s) => [
            String(s.round),
            label(topology, s.settled),
            formatNum(sp.cost[s.settled] ?? Infinity),
            s.relaxations.filter((r) => r.improved).map((r) => `${label(topology, r.to)}→${r.newCost}`).join(', ') || '—',
          ])}
        />
        <div className="section-title mt">Costs from {label(topology, rootId)}</div>
        <DataTable
          columns={['Node', 'Cost', 'Predecessor', 'First hop']}
          rows={topology.nodes
            .filter((n) => n.id !== rootId)
            .map((n) => {
              const entry = table.entries.find((e) => e.dest === n.id)
              return [n.label, formatNum(sp.cost[n.id] ?? Infinity), sp.prev[n.id] ? label(topology, sp.prev[n.id]!) : '—', entry?.nextHopLabel ?? '—']
            })}
        />
      </Panel>
      <ForwardingPanel table={table} topology={topology} />
      <Interpretation
        lines={[
          `The tree settles every reachable node in ${sp.steps.length} rounds. Costs above are the sums of effective link costs (a congested link adds +10).`,
          `Each forwarding entry installs the tree's first hop, not the destination itself — that is why R1 sends toward E through its neighbour rather than E directly.`,
        ]}
      />
    </>
  )
}

function DistanceVectorView({ topology, algorithm }: { topology: Topology; algorithm: Tab }) {
  const isRip = algorithm === 'rip'
  const [metric, setMetric] = useState<DvMetric>(isRip ? 'hops' : 'cost')
  const [splitHorizon, setSplitHorizon] = useState(false)
  const [failureLink, setFailureLink] = useState('')

  const result = useMemo(
    () =>
      runDistanceVector({
        topology,
        options: { metric, infinity: isRip ? 16 : 99, splitHorizon, poisonReverse: false, maxRounds: 40 },
        failedLinks: failureLink ? [failureLink] : [],
      }),
    [topology, metric, splitHorizon, failureLink, isRip]
  )

  const focus = useMemo(() => {
    const nonRouter = topology.nodes.find((n) => n.kind !== 'router')
    return nonRouter?.id ?? topology.nodes.at(-1)?.id ?? ''
  }, [topology])
  const trace = useMemo(() => countToInfinityTrace(result, focus), [result, focus])

  return (
    <>
      <Panel
        title={isRip ? 'RIP (hop count)' : 'Distance-vector (Bellman–Ford)'}
        actions={
          <button className="btn sm" onClick={() => downloadText('distance-vector.md', reportToMarkdown(reportForDistanceVector(topology, result, focus)))}>
            Report
          </button>
        }
      >
        <div className="row-grid">
          <SelectField label="Metric" value={metric} onChange={(v) => setMetric(v as DvMetric)} options={[{ value: 'cost', label: 'Link cost' }, { value: 'hops', label: 'Hop count (RIP)' }]} />
          <SelectField
            label="Force a link down"
            value={failureLink}
            onChange={setFailureLink}
            options={[{ value: '', label: '— none —' }, ...topology.links.map((l) => ({ value: l.id, label: `${label(topology, l.a)}–${label(topology, l.b)}` }))]}
          />
        </div>
        <Checkbox label="Split horizon" checked={splitHorizon} onChange={setSplitHorizon} />
        <div className="btn-row mt">
          <Badge tone={result.converged ? 'ok' : 'warn'}>{result.converged ? `converged at round ${result.convergedAtRound}` : 'still changing'}</Badge>
          <Badge tone={result.countToInfinitySeen ? 'bad' : 'info'}>{result.countToInfinitySeen ? 'count-to-infinity seen' : 'no metric climb'}</Badge>
          <span className="chip">{result.rounds.length - 1} round(s)</span>
        </div>
      </Panel>

      <Panel title={`Cost to ${label(topology, focus)} each round`} hint="Every router only uses its neighbours' advertised numbers.">
        <DataTable
          columns={['Round', ...result.routers.map((r) => label(topology, r))]}
          rows={trace.map((t) => [String(t.round), ...result.routers.map((r) => (t.costs[r]! >= result.options.infinity ? '∞' : String(t.costs[r])))])}
        />
      </Panel>

      <FinalDvTable topology={topology} router={result.routers[0] ?? ''} result={result} />
      <Interpretation
        lines={[
          result.countToInfinitySeen
            ? 'Watch the metric climb by one each round after the failure: two routers trusted each other, so bad news propagated slowly. That is count-to-infinity — why RIP caps at 16 and wants split horizon.'
            : 'The tables settled without a sustained climb here. Try forcing a link down (the failure-lab preset is built for this) to reproduce count-to-infinity.',
          'Distance-vector routers never see the whole path — only a neighbour’s number — which is exactly what makes them vulnerable to a routing loop.',
        ]}
      />
    </>
  )
}

function FinalDvTable({ topology, router, result }: { topology: Topology; router: string; result: ReturnType<typeof runDistanceVector> }) {
  const [selected, setSelected] = useState(router)
  const id = topology.nodes.some((n) => n.id === selected) ? selected : router
  const table = useMemo(() => dvForwardingTable(topology, id, result), [topology, id, result])
  return (
    <>
      <Panel title="Router forwarding tables">
        <SelectField label="Router" value={id} onChange={setSelected} options={result.routers.map((r) => ({ value: r, label: label(topology, r) }))} />
      </Panel>
      <ForwardingPanel table={table} topology={topology} />
    </>
  )
}

function OspfView({ topology }: { topology: Topology }) {
  const result = useMemo(() => runOspf(topology), [topology])
  const routers = topology.nodes.filter((n) => n.kind === 'router')
  const [selected, setSelected] = useState(routers[0]?.id ?? '')
  const id = topology.nodes.some((n) => n.id === selected) ? selected : routers[0]?.id ?? ''
  const view = result.perRouter[id]

  return (
    <>
      <Panel
        title="OSPF link-state database"
        hint={`Area ${result.area} · ${result.lsdbSize} router LSA(s) · flooded in ${result.rounds} round(s)`}
        actions={
          view ? (
            <button className="btn sm" onClick={() => downloadText('ospf.md', reportToMarkdown(reportForOspf(topology, result, id)))}>
              Report
            </button>
          ) : null
        }
      >
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <Badge tone={result.databasesMatch ? 'ok' : 'warn'}>{result.databasesMatch ? 'every router holds the same LSDB' : 'databases differ — partitioned router(s)'}</Badge>
        </div>
        <DataTable
          columns={['LSA origin', 'Links (peer:cost)', 'Seq', 'Holders', 'Complete']}
          rows={result.records.map((r) => [
            r.lsa.routerLabel,
            r.lsa.links.map((l) => `${l.toLabel}:${l.cost}${l.stub ? '*' : ''}`).join(', ') || '—',
            `0x${r.lsa.seq.toString(16)}`,
            String(r.holders.length),
            r.complete ? 'yes' : 'no',
          ])}
        />
        <p className="hint mt">* marks a stub (host/server) link — advertised but not an OSPF router adjacency.</p>
      </Panel>

      <Panel title="SPF + forwarding table at a router">
        <SelectField label="Router" value={id} onChange={setSelected} options={routers.map((n) => ({ value: n.id, label: n.label }))} />
        {view ? (
          <div className="mt">
            <DataTable
              columns={['Prefix', 'Next hop', 'Cost']}
              rows={view.forwardingTable.entries.map((e) => [e.destPrefix, e.nextHopLabel, String(e.cost)])}
            />
          </div>
        ) : null}
      </Panel>

      <Interpretation
        lines={[
          'Each router originates a router LSA, flooding spreads it until all databases match, then every router runs the identical Dijkstra — so they agree on the tree without a slow rumour chain.',
          'This is why link-state recovery after a failure is one recomputation: the whole topology is known, not just a neighbour’s distance.',
        ]}
      />
    </>
  )
}

function BgpView({ topology }: { topology: Topology }) {
  const result = useMemo(() => runBgp(topology), [topology])
  const speakers = topology.nodes.filter((n) => n.kind === 'router' && n.asNumber !== undefined)
  const [router, setRouter] = useState(speakers[0]?.id ?? '')
  const [dest, setDest] = useState(topology.nodes.find((n) => n.kind === 'server')?.id ?? topology.nodes.at(-1)?.id ?? '')
  const rid = topology.nodes.some((n) => n.id === router) ? router : speakers[0]?.id ?? ''
  const did = topology.nodes.some((n) => n.id === dest) ? dest : topology.nodes.at(-1)?.id ?? ''

  if (speakers.length === 0) {
    return (
      <Panel title="BGP">
        <Notice tone="warn">
          This topology has no autonomous systems. Load the “Multi-AS Internet core” preset in the studio, or give routers an AS number in the inspector, to run BGP.
        </Notice>
      </Panel>
    )
  }

  const chosen = result.best[rid]?.[did]
  const candidates = result.candidates[rid]?.[did] ?? []

  return (
    <>
      <Panel
        title="BGP best-path"
        hint={`ASes: ${result.asNumbers.map((a) => `AS${a}`).join(', ')}`}
        actions={
          <button className="btn sm" onClick={() => downloadText('bgp.md', reportToMarkdown(reportForBgp(topology, result, rid, did)))}>
            Report
          </button>
        }
      >
        <div className="row-grid">
          <SelectField label="Evaluating router" value={rid} onChange={setRouter} options={speakers.map((n) => ({ value: n.id, label: `${n.label} (AS${n.asNumber})` }))} />
          <SelectField label="Destination prefix" value={did} onChange={setDest} options={topology.nodes.map((n) => ({ value: n.id, label: nodeById(topology, n.id)?.ip ? `${n.label} ${n.ip}/${n.prefix ?? 24}` : n.label }))} />
        </div>
        <div className="btn-row mt">
          <Badge tone={result.converged ? 'ok' : 'warn'}>{result.converged ? 'converged' : 'propagating'}</Badge>
          <Badge tone={result.policyOverShortest.length ? 'info' : 'warn'}>
            {result.policyOverShortest.length ? `${result.policyOverShortest.length} policy-over-shortest pick(s)` : 'cheapest route also won'}
          </Badge>
        </div>
      </Panel>

      <Panel title={`BGP table at ${label(topology, rid)} for ${label(topology, did)}`}>
        {candidates.length === 0 ? (
          <Empty>No BGP route reached this router for that destination.</Empty>
        ) : (
          <DataTable
            columns={['Source', 'Next hop', 'AS_PATH', 'LOCAL_PREF', 'MED', 'IGP exit', 'Chosen']}
            rows={candidates.map((c) => [
              c.source,
              c.nextHop ? label(topology, c.nextHop) : '—',
              c.asPath.length ? c.asPath.join(' ') : '(local)',
              String(c.localPref),
              String(c.med),
              String(c.exitCost),
              chosen && c.peer === chosen.peer && c.source === chosen.source ? '✔' : '',
            ])}
          />
        )}
        {chosen ? <p className="hint mt">{chosen.reason}</p> : null}
      </Panel>

      <Interpretation
        lines={[
          'Selection order: LOCAL_PREF (from ingress policy) first, then shortest AS_PATH, then MED, then IGP exit cost.',
          result.policyOverShortest.length
            ? 'At least one router chose a physically longer path because a LOCAL_PREF policy outranked distance. That is the essence of inter-domain routing: reachability is negotiated by policy, not chosen by maths alone.'
            : 'Here the cheapest route also won; edit the AS171 ingress policy on the multi-AS preset to make LOCAL_PREF override distance.',
        ]}
      />
    </>
  )
}

function ForwardingPanel({ table, topology }: { table: ForwardingTable; topology: Topology }) {
  return (
    <Panel title={`Forwarding table · ${label(topology, table.routerId)}`} hint={`${table.entries.length} installed prefix(es)`}>
      {table.entries.length === 0 ? (
        <Empty>This router has no reachable prefixes under the current topology.</Empty>
      ) : (
        <DataTable
          columns={['Prefix', 'Next hop', 'Out link', 'Cost', 'Hops']}
          rows={table.entries.map((e) => [e.destPrefix, e.nextHopLabel, e.outLinkLabel, formatNum(e.cost), String(e.hops)])}
        />
      )}
    </Panel>
  )
}

function Interpretation({ lines }: { lines: string[] }) {
  return (
    <Panel title="What this shows">
      <ul className="stack" style={{ gap: 6, margin: 0, paddingLeft: 18 }}>
        {lines.map((l, i) => (
          <li key={i} className="small" style={{ color: 'var(--text-dim)' }}>
            {l}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

function firstRouter(topology: Topology): string {
  return topology.nodes.find((n) => n.kind === 'router')?.id ?? topology.nodes[0]?.id ?? ''
}
