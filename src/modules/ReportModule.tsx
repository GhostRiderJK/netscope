import { useMemo, useState } from 'react'
import type { RoutingAlgorithm } from '../core/types'
import { RoutingEngine } from '../core/routing'
import { dijkstra } from '../core/algorithms/linkState'
import { runDistanceVector } from '../core/algorithms/distanceVector'
import { runOspf } from '../core/algorithms/ospf'
import { runBgp } from '../core/algorithms/bgp'
import { computeFragments } from '../core/fragmentation'
import { describeSubnet } from '../core/ipv4'
import { runTraceroute } from '../core/icmp'
import { simulatePacket } from '../core/packetSim'
import type { ExperimentReport } from '../core/report'
import {
  reportForBgp,
  reportForDistanceVector,
  reportForFragments,
  reportForLinkState,
  reportForOspf,
  reportForPacketRun,
  reportForSubnet,
  reportForTraceroute,
  reportToJson,
  reportToMarkdown,
} from '../core/report'
import { useStore } from '../state/store'
import { Notice, Panel, SelectField } from '../components/ui'
import { copyText, downloadText } from './download'

type ReportKind = 'packet' | 'link-state' | 'distance-vector' | 'ospf' | 'bgp' | 'subnet' | 'fragmentation' | 'traceroute'

const KINDS: { id: ReportKind; label: string }[] = [
  { id: 'packet', label: 'Packet journey' },
  { id: 'link-state', label: 'Link-state / Dijkstra' },
  { id: 'distance-vector', label: 'Distance-vector / RIP' },
  { id: 'ospf', label: 'OSPF' },
  { id: 'bgp', label: 'BGP' },
  { id: 'subnet', label: 'IPv4 subnet analysis' },
  { id: 'fragmentation', label: 'Fragmentation' },
  { id: 'traceroute', label: 'Traceroute' },
]

export function ReportModule() {
  const { state } = useStore()
  const topology = state.topology
  const [kind, setKind] = useState<ReportKind>('packet')
  const [view, setView] = useState<'preview' | 'markdown' | 'json'>('preview')

  const report: ExperimentReport | null = useMemo(() => {
    try {
      return buildReport(kind, topology, state)
    } catch {
      return null
    }
  }, [kind, topology, state])

  const md = report ? reportToMarkdown(report) : ''
  const json = report ? reportToJson(report) : ''

  return (
    <div className="workspace cols-2">
      <div className="stack">
        <Panel title="Choose an experiment" hint="The report is generated live from the current topology and settings.">
          <SelectField label="Report type" value={kind} onChange={(v) => setKind(v as ReportKind)} options={KINDS.map((k) => ({ value: k.id, label: k.label }))} />
        </Panel>

        {report ? (
          <Panel title={report.title} hint={`Generated ${report.generatedAt}`}>
            <div className="stat-grid" style={{ marginBottom: 10 }}>
              <div className="stat"><div className="k">Module</div><div className="v" style={{ fontSize: 13 }}>{report.module}</div></div>
              <div className="stat"><div className="k">Topology</div><div className="v" style={{ fontSize: 13 }}>{report.topologyName}</div></div>
            </div>
            <p className="small" style={{ color: 'var(--text-dim)', margin: '0 0 10px' }}>{report.objective}</p>
            <div className="btn-row">
              <button className="btn sm" onClick={() => downloadText(`${report.id}.md`, md)}>Download .md</button>
              <button className="btn sm" onClick={() => downloadText(`${report.id}.json`, json, 'application/json')}>Download .json</button>
              <button className="btn sm ghost" onClick={async () => await copyText(md)}>Copy Markdown</button>
              <button className="btn sm primary" onClick={() => printReport(report)}>Print / PDF</button>
            </div>
          </Panel>
        ) : (
          <Notice tone="warn">This report could not be generated. Check your topology is valid (Studio shows validation).</Notice>
        )}
      </div>

      <div className="stack">
        <Panel title="Report preview">
          <div className="mini-tab-row">
            <button className={`tab-btn${view === 'preview' ? ' active' : ''}`} onClick={() => setView('preview')}>Preview</button>
            <button className={`tab-btn${view === 'markdown' ? ' active' : ''}`} onClick={() => setView('markdown')}>Markdown</button>
            <button className={`tab-btn${view === 'json' ? ' active' : ''}`} onClick={() => setView('json')}>JSON</button>
          </div>
          {view === 'preview' && report ? <ReportHtml report={report} /> : null}
          {view === 'markdown' ? (
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', maxHeight: '70vh', overflow: 'auto' }}>{md}</pre>
          ) : null}
          {view === 'json' ? (
            <pre className="mono small" style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', maxHeight: '70vh', overflow: 'auto' }}>{json}</pre>
          ) : null}
        </Panel>
      </div>
    </div>
  )
}

function buildReport(kind: ReportKind, topology: ReturnType<typeof useStore>['state']['topology'], state: ReturnType<typeof useStore>['state']): ExperimentReport | null {
  const routers = topology.nodes.filter((n) => n.kind === 'router')
  const cfg = state.packet

  switch (kind) {
    case 'packet': {
      const run = simulatePacket({
        topology,
        algorithm: cfg.algorithm,
        srcId: cfg.srcId,
        dstId: cfg.dstId,
        initialTtl: cfg.initialTtl,
        packetBytes: cfg.packetBytes,
        headerLength: cfg.headerLength,
        dontFragment: cfg.dontFragment,
      })
      return reportForPacketRun(topology, cfg, run)
    }
    case 'link-state': {
      const root = routers[0]?.id ?? topology.nodes[0]?.id ?? ''
      const sp = dijkstra(topology, root)
      const table = new RoutingEngine(topology, 'link-state').forwardingTable(root)
      return reportForLinkState(topology, sp, table)
    }
    case 'distance-vector': {
      const result = runDistanceVector({ topology, options: { metric: 'cost', infinity: 99, splitHorizon: false, poisonReverse: false, maxRounds: 40 } })
      return reportForDistanceVector(topology, result)
    }
    case 'ospf': {
      const router = routers[0]?.id ?? ''
      const result = runOspf(topology)
      return reportForOspf(topology, result, router)
    }
    case 'bgp': {
      const speakers = topology.nodes.filter((n) => n.kind === 'router' && n.asNumber !== undefined)
      if (speakers.length === 0) return null
      const router = speakers[0]?.id ?? ''
      const dest = topology.nodes.find((n) => n.kind === 'server')?.id ?? topology.nodes.at(-1)?.id ?? ''
      const result = runBgp(topology)
      return reportForBgp(topology, result, router, dest)
    }
    case 'subnet': {
      const host = topology.nodes.find((n) => n.ip && n.prefix !== undefined)
      const addr = host?.ip ?? '192.168.10.130'
      const prefix = host?.prefix ?? 26
      const info = describeSubnet(addr, prefix)
      return reportForSubnet(info)
    }
    case 'fragmentation': {
      const plan = computeFragments({ datagramBytes: 4000, headerLength: 20, mtu: 1500, dontFragment: false, identification: 0x1a2c })
      return reportForFragments(topology, plan)
    }
    case 'traceroute': {
      const algorithm: RoutingAlgorithm = cfg.algorithm
      const result = runTraceroute({ topology, algorithm, fromId: cfg.srcId, toId: cfg.dstId, probesPerHop: 3 })
      return reportForTraceroute(result, topology)
    }
    default:
      return null
  }
}

function printReport(report: ExperimentReport): void {
  const w = window.open('', '_blank')
  if (!w) return
  const md = reportToMarkdown(report)
  w.document.write(`<html><head><title>${report.title}</title><style>body{font-family:system-ui,sans-serif;max-width:740px;margin:40px auto;font-size:14px;line-height:1.6}h1{font-size:22px;margin-bottom:4px}h2{font-size:16px;margin-top:18px;border-bottom:1px solid #ccc;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin:10px 0}th,td{padding:5px 8px;border:1px solid #ddd;font-size:13px}th{background:#f5f5f5}code{background:#eee;padding:1px 4px;border-radius:3px}hr{border:none;border-top:1px solid #ddd}</style></head><body>${mdToHtml(md)}</body></html>`)
  w.document.close()
  w.focus()
  w.print()
}

function mdToHtml(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inTable = false
  let inList = false
  let inCode = false
  let codeLines: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!
    if (raw.startsWith('```')) {
      if (inCode) { out.push(`<pre>${codeLines.join('\n')}</pre>`); codeLines = []; inCode = false }
      else inCode = true
      continue
    }
    if (inCode) { codeLines.push(esc(raw)); continue }
    if (raw.startsWith('|')) {
      const cells = raw.split('|').slice(1, -1).map((c) => c.trim())
      if (cells.every((c) => /^---+$/.test(c))) continue
      if (!inTable) { out.push('<table>'); inTable = true; out.push('<thead>'); cells.forEach((c) => out.push(`<th>${inline(c)}</th>`)); out.push('</thead><tbody>') }
      else out.push(`<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
      continue
    }
    if (inTable) { out.push('</tbody></table>'); inTable = false }
    if (raw.startsWith('- ')) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(raw.slice(2))}</li>`)
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }
    if (raw.startsWith('# ')) { out.push(`<h1>${inline(raw.slice(2))}</h1>`); continue }
    if (raw.startsWith('## ')) { out.push(`<h2>${inline(raw.slice(3))}</h2>`); continue }
    if (raw.trim() === '') { if (out.length) out.push('<br>'); continue }
    out.push(`<p>${inline(raw)}</p>`)
  }
  if (inTable) out.push('</tbody></table>')
  if (inList) out.push('</ul>')
  if (inCode) out.push(`<pre>${codeLines.join('\n')}</pre>`)
  return out.join('\n')
}

function inline(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`(.+?)`/g, '<code>$1</code>')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function ReportHtml({ report }: { report: ExperimentReport }) {
  return (
    <div style={{ maxHeight: '70vh', overflow: 'auto' }} className="mono small" dangerouslySetInnerHTML={{ __html: mdToHtml(reportToMarkdown(report)) }} />
  )
}
