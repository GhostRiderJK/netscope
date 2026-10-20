import { useMemo, useState } from 'react'
import type { NetNode, Topology } from '../core/types'
import { PRESETS } from '../core/presets'
import { validateTopology } from '../core/graph'
import { parseTopologyJson, topologyToJson } from '../core/serialize'
import { useStore, uid } from '../state/store'
import { TopologyCanvas, type CanvasTool } from '../components/TopologyCanvas'
import { Badge, Empty, Notice, Panel, SelectField, TextField, NumberField } from '../components/ui'

export function StudioModule() {
  const { state, dispatch } = useStore()
  const topology = state.topology
  const [tool, setTool] = useState<CanvasTool>('select')
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [importMsg, setImportMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null)

  const routers = useMemo(() => topology.nodes.filter((n) => n.kind === 'router'), [topology])
  const issues = useMemo(() => validateTopology(topology), [topology])
  const node = topology.nodes.find((n) => n.id === state.selectedNodeId) ?? null
  const link = topology.links.find((l) => l.id === state.selectedLinkId) ?? null

  const tools: { id: CanvasTool; label: string }[] = [
    { id: 'select', label: 'Select / move' },
    { id: 'connect', label: 'Connect' },
    { id: 'add-router', label: 'Add router' },
    { id: 'add-host', label: 'Add host' },
    { id: 'add-server', label: 'Add server' },
    { id: 'delete', label: 'Delete' },
  ]

  function newId(prefix: string, taken: Set<string>): string {
    let id = uid(prefix)
    let i = 0
    while (taken.has(id)) id = uid(`${prefix}${i++}`)
    return id
  }

  function handleNodeClick(id: string) {
    if (tool === 'delete') {
      dispatch({ type: 'removeNode', id })
      return
    }
    if (tool === 'connect') {
      if (!pendingFrom) {
        setPendingFrom(id)
        dispatch({ type: 'selectNode', id })
      } else if (pendingFrom !== id) {
        const exists = topology.links.some((l) => (l.a === pendingFrom && l.b === id) || (l.a === id && l.b === pendingFrom))
        if (!exists) dispatch({ type: 'addLink', link: { id: newId('l', new Set(topology.links.map((l) => l.id))), a: pendingFrom, b: id, cost: 1, mtu: 1500, status: 'active' } })
        setPendingFrom(null)
      } else {
        setPendingFrom(null)
      }
      return
    }
    dispatch({ type: 'selectNode', id })
  }

  function handleLinkClick(id: string) {
    if (tool === 'delete') dispatch({ type: 'removeLink', id })
    else dispatch({ type: 'selectLink', id })
  }

  function handleAddAt(x: number, y: number) {
    const kind = tool === 'add-router' ? 'router' : tool === 'add-host' ? 'host' : 'server'
    const taken = new Set(topology.nodes.map((n) => n.id))
    const seq = topology.nodes.filter((n) => n.kind === kind).length + 1
    const label = kind === 'router' ? `R${seq}` : kind === 'host' ? `PC-${seq}` : `SV${seq}`
    const nodeToAdd: NetNode = { id: newId(kind[0]!, taken), label, kind, x, y }
    dispatch({ type: 'addNode', node: nodeToAdd })
  }

  function doExport() {
    const blob = new Blob([topologyToJson(topology)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${topology.id || 'topology'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function doImport() {
    const result = parseTopologyJson(importText)
    if (!result.ok || !result.value) {
      setImportMsg({ tone: 'bad', text: result.error ?? 'Import failed.' })
      return
    }
    dispatch({ type: 'replaceTopology', topology: result.value })
    setImportMsg({ tone: result.warnings.length ? 'warn' : 'ok', text: `Imported "${result.value.name}".${result.warnings.length ? ` ${result.warnings.length} warning(s).` : ''}` })
    setImportText('')
  }

  function saveCustom() {
    dispatch({ type: 'saveCurrent', id: uid('saved') })
  }

  return (
    <div className="workspace cols-sim">
      <div className="stack">
        <Panel title="Presets">
          <div className="stack" style={{ gap: 8 }}>
            {PRESETS.map((p) => (
              <button
                key={p.id}
                className={`preset-card${topology.id === p.id ? ' active' : ''}`}
                onClick={() => dispatch({ type: 'loadPreset', id: p.id })}
              >
                <div className="pc-name">{p.name}</div>
                <div className="pc-sum">{p.summary}</div>
              </button>
            ))}
            <button className="btn ghost sm" onClick={() => dispatch({ type: 'newBlank' })}>New blank topology</button>
          </div>
        </Panel>

        <Panel title="Saved on this device" hint="Persisted in your browser.">
          {state.savedTopologies.length === 0 ? (
            <p className="hint">Nothing saved yet. Use “Save current” below the canvas.</p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {state.savedTopologies.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button className="btn sm ghost" style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => dispatch({ type: 'loadSaved', id: s.id })}>
                    {s.name}
                  </button>
                  <button className="btn sm danger" onClick={() => dispatch({ type: 'deleteSaved', id: s.id })}>✕</button>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <div className="stack">
        <section className="panel intro">
          <div className="intro-index">01 — Topology studio</div>
          <h2 className="intro-title">Build the network, then send a packet through it.</h2>
          <p className="intro-body">
            NetScope is a hands-on lab for the network layer. Arrange routers, hosts and servers, set link costs,
            then break a link and watch every routing decision recompute. Everything you see is calculated live in
            your browser from this topology — nothing is faked.
          </p>
          <div className="btn-row">
            <button className="btn primary" onClick={() => dispatch({ type: 'setModule', module: 'packet' })}>Start a packet journey</button>
            <button className="btn ghost" onClick={() => dispatch({ type: 'setModule', module: 'routing' })}>Compare routing algorithms</button>
          </div>
        </section>

        <Panel
          title="Network topology studio"
          hint={`${topology.nodes.length} nodes · ${topology.links.length} links · ${routers.length} routers`}
          actions={
            <>
              <button className="btn sm" onClick={saveCustom}>Save current</button>
              <button className="btn sm" onClick={doExport}>Export JSON</button>
            </>
          }
        >
          <div className="btn-row" style={{ marginBottom: 12 }}>
            {tools.map((t) => (
              <button key={t.id} className={`btn sm${tool === t.id ? ' primary' : ''}`} onClick={() => { setTool(t.id); setPendingFrom(null) }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ height: 460 }}>
            <TopologyCanvas
              topology={topology}
              tool={tool}
              selectedNodeId={state.selectedNodeId}
              selectedLinkId={state.selectedLinkId}
              pendingLinkFrom={pendingFrom}
              sourceId={state.packet.srcId}
              destId={state.packet.dstId}
              onAddNodeAt={handleAddAt}
              onNodeClick={handleNodeClick}
              onLinkClick={handleLinkClick}
              onMoveNode={(id, x, y) => dispatch({ type: 'moveNode', id, x, y })}
              onBackgroundClick={() => { dispatch({ type: 'selectNode', id: null }); setPendingFrom(null) }}
            />
          </div>
          {issues.length > 0 ? (
            <div className="mt stack" style={{ gap: 4 }}>
              {issues.map((issue, i) => (
                <div key={i} className="small" style={{ color: issue.level === 'error' ? 'var(--bad)' : 'var(--warn)' }}>
                  {issue.level === 'error' ? '●' : '○'} {issue.message}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt small muted">Topology is structurally valid — every simulation module can run on it.</div>
          )}
        </Panel>

        <Panel title="Import topology">
          <textarea
            value={importText}
            placeholder='Paste NetScope topology JSON here…'
            onChange={(e) => setImportText(e.target.value)}
          />
          <div className="btn-row mt">
            <button className="btn primary sm" onClick={doImport} disabled={!importText.trim()}>Import</button>
            {importMsg ? <Notice tone={importMsg.tone}>{importMsg.text}</Notice> : null}
          </div>
        </Panel>
      </div>

      <div className="stack inspector">
        <Panel title="Inspector" hint={node ? `Editing ${node.label}` : link ? 'Editing link' : 'Select a node or link'}>
          {!node && !link ? (
            <Empty>Nothing selected. Click a node or a link on the canvas.</Empty>
          ) : node ? (
            <NodeEditor node={node} routers={routers} />
          ) : link ? (
            <LinkEditor link={link} topology={topology} />
          ) : null}
        </Panel>

        <Panel title="Source → destination">
          <SelectField
            label="Source"
            value={state.packet.srcId}
            onChange={(v) => dispatch({ type: 'setPacket', patch: { srcId: v } })}
            options={topology.nodes.map((n) => ({ value: n.id, label: n.label }))}
          />
          <SelectField
            label="Destination"
            value={state.packet.dstId}
            onChange={(v) => dispatch({ type: 'setPacket', patch: { dstId: v } })}
            options={topology.nodes.map((n) => ({ value: n.id, label: n.label }))}
          />
          <button className="btn sm" onClick={() => dispatch({ type: 'setModule', module: 'packet' })}>Send a packet →</button>
        </Panel>
      </div>
    </div>
  )
}

function NodeEditor({ node, routers }: { node: NetNode; routers: NetNode[] }) {
  const { dispatch } = useStore()
  const patch = (p: Partial<NetNode>) => dispatch({ type: 'updateNode', id: node.id, patch: p })
  const invalidIp = node.ip !== undefined && node.ip !== '' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(node.ip)
  return (
    <>
      <TextField label="Label" value={node.label} onChange={(v) => patch({ label: v })} />
      <SelectField
        label="Kind"
        value={node.kind}
        onChange={(v) => patch({ kind: v })}
        options={[
          { value: 'router', label: 'Router' },
          { value: 'host', label: 'Host' },
          { value: 'server', label: 'Server' },
        ]}
      />
      <TextField label="IPv4 address" value={node.ip ?? ''} placeholder="192.168.10.130" invalid={invalidIp} onChange={(v) => patch({ ip: v || undefined })} />
      <NumberField label="Prefix length" value={node.prefix ?? 24} min={0} max={32} onChange={(n) => patch({ prefix: Number.isFinite(n) ? Math.max(0, Math.min(32, Math.round(n))) : undefined })} />
      {node.kind !== 'router' ? (
        <SelectField
          label="Default gateway"
          value={node.gateway ?? ''}
          onChange={(v) => patch({ gateway: v || undefined })}
          options={[{ value: '', label: '— none —' }, ...routers.map((r) => ({ value: r.id, label: r.label }))]}
        />
      ) : (
        <NumberField label="Autonomous system (BGP)" value={node.asNumber ?? 0} min={0} onChange={(n) => patch({ asNumber: Number.isFinite(n) && n > 0 ? Math.round(n) : undefined })} />
      )}
      <TextField label="Note" value={node.note ?? ''} onChange={(v) => patch({ note: v || undefined })} />
      <div className="btn-row mt">
        <button className="btn sm danger" onClick={() => dispatch({ type: 'removeNode', id: node.id })}>Delete node</button>
      </div>
    </>
  )
}

function LinkEditor({ link, topology }: { link: Topology['links'][number]; topology: Topology }) {
  const { dispatch } = useStore()
  const a = topology.nodes.find((n) => n.id === link.a)
  const b = topology.nodes.find((n) => n.id === link.b)
  const patch = (p: Partial<typeof link>) => dispatch({ type: 'updateLink', id: link.id, patch: p })
  return (
    <>
      <div className="kv"><span className="k">Endpoints</span><span className="v">{a?.label ?? link.a} ↔ {b?.label ?? link.b}</span></div>
      <div className="kv"><span className="k">Link id</span><span className="v">{link.id}</span></div>
      <NumberField label="Cost (metric)" value={link.cost} min={1} onChange={(n) => patch({ cost: Number.isFinite(n) ? Math.max(1, Math.round(n)) : 1 })} />
      <NumberField label="MTU (bytes)" value={link.mtu} min={68} max={65535} onChange={(n) => patch({ mtu: Number.isFinite(n) ? Math.round(n) : 1500 })} />
      <Field2 label="Status">
        <div className="btn-row">
          <button className={`btn sm${link.status === 'active' ? ' primary' : ''}`} onClick={() => patch({ status: 'active' })}>Active</button>
          <button className={`btn sm${link.status === 'congested' ? ' primary' : ''}`} onClick={() => patch({ status: 'congested' })}>Congested</button>
          <button className={`btn sm${link.status === 'failed' ? ' primary' : ''}`} onClick={() => patch({ status: 'failed' })}>Failed</button>
        </div>
      </Field2>
      <div className="btn-row mt">
        <Badge tone={link.status === 'failed' ? 'bad' : link.status === 'congested' ? 'warn' : 'ok'}>{link.status}</Badge>
        <button className="btn sm danger" onClick={() => dispatch({ type: 'removeLink', id: link.id })}>Delete link</button>
      </div>
    </>
  )
}

function Field2({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}
