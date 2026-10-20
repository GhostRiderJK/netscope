import { useMemo, useState } from 'react'
import { computeFragments, reassemble } from '../core/fragmentation'
import { useStore } from '../state/store'
import { reportForFragments, reportToMarkdown } from '../core/report'
import { Badge, DataTable, Notice, Panel, NumberField, SelectField, Checkbox, formatNum } from '../components/ui'
import { downloadText } from './download'

const COLORS = ['#315ccb', '#3f796e', '#c76b35', '#6b5a8f', '#4c565e', '#b23a2e']

export function FragmentationModule() {
  const { state } = useStore()
  const topology = state.topology
  const [datagramBytes, setDatagram] = useState(4000)
  const [headerLength, setHeader] = useState(20)
  const [mtu, setMtu] = useState(1500)
  const [dontFragment, setDf] = useState(false)
  const [identification, setId] = useState(0x1a2c)
  const [linkId, setLinkId] = useState('')

  const applyLink = (id: string) => {
    setLinkId(id)
    const link = topology.links.find((l) => l.id === id)
    if (link) setMtu(link.mtu)
  }

  const plan = useMemo(
    () => computeFragments({ datagramBytes, headerLength, mtu, dontFragment, identification }),
    [datagramBytes, headerLength, mtu, dontFragment, identification]
  )
  const rebuilt = useMemo(() => (plan.ok && plan.fragments.length ? reassemble(plan.fragments) : { ok: false, bytes: 0 }), [plan])

  const dropTone = plan.dropped ? 'bad' : plan.ok ? 'ok' : 'warn'

  return (
    <div className="workspace cols-2">
      <div className="stack">
        <Panel
          title="Datagram & link"
          actions={
            <button className="btn sm" onClick={() => downloadText('fragmentation.md', reportToMarkdown(reportForFragments(topology, plan, linkId || undefined)))}>
              Report
            </button>
          }
        >
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <button className="btn sm ghost" onClick={() => { setDatagram(4000); setHeader(20); setMtu(1500); setDf(false) }}>Chapter 4 example</button>
            <button className="btn sm ghost" onClick={() => { setDatagram(4000); setHeader(20); setMtu(576); setDf(false) }}>MTU-lab (576 B)</button>
            <button className="btn sm ghost" onClick={() => { setDatagram(4000); setHeader(20); setMtu(1500); setDf(true) }}>DF=1 drop</button>
          </div>
          <div className="row-grid">
            <NumberField label="Datagram (B, incl. header)" value={datagramBytes} min={20} max={65535} onChange={(n) => setDatagram(clamp(n, 20, 65535))} />
            <NumberField label="Header length (B)" value={headerLength} min={20} max={60} step={4} onChange={(n) => setHeader(clampRound4(n))} invalid={!plan.ok && !Number.isInteger(headerLength / 4)} />
            <NumberField label="Link MTU (B)" value={mtu} min={1} max={65535} onChange={(n) => { setMtu(clamp(n, 1, 65535)); setLinkId('') }} />
            <NumberField label="Identification" value={identification} min={0} max={65535} onChange={(n) => setId(clamp(n, 0, 65535))} />
          </div>
          {topology.links.length ? (
            <SelectField
              label="Copy MTU from a link"
              value={linkId}
              onChange={applyLink}
              options={[{ value: '', label: '— manual —' }, ...topology.links.map((l) => ({ value: l.id, label: `${l.id} · MTU ${l.mtu}` }))]}
            />
          ) : null}
          <Checkbox label="Don't Fragment (DF=1)" checked={dontFragment} onChange={setDf} />
        </Panel>

        <Panel title="Arithmetic">
          <div className="stat-grid">
            <Stat label="Payload (B)" value={formatNum(plan.payloadBytes)} />
            <Stat label="Data per fragment (B)" value={formatNum(plan.chunk)} />
            <Stat label="Fragments" value={String(plan.fragments.length)} />
            <Stat label="Bytes on wire" value={formatNum(plan.bytesOnWire)} />
          </div>
          <div className="kv mt">
            <span className="k">Header overhead</span>
            <span className="v">{formatNum(plan.overheadBytes)} B</span>
          </div>
          <div className="kv">
            <span className="k">Needs fragmentation</span>
            <span className="v">{plan.needsFragmentation ? 'yes' : 'no'}</span>
          </div>
          <div className="kv">
            <span className="k">Reassembly</span>
            <span className="v">
              {rebuilt.ok ? `ok — ${rebuilt.bytes} B rebuilt` : rebuilt.error ?? '—'}
            </span>
          </div>
          <div className="btn-row mt">
            <Badge tone={dropTone}>{plan.dropped ? 'dropped (DF)' : plan.ok ? (plan.needsFragmentation ? 'fragmented' : 'passes whole') : 'invalid'}</Badge>
            <Badge tone={rebuilt.ok ? 'ok' : 'bad'}>{rebuilt.ok ? 'reassembles exactly' : 'does not reassemble'}</Badge>
          </div>
        </Panel>

        {plan.warnings.length ? (
          <Panel title="Notes">
            <div className="stack" style={{ gap: 6 }}>
              {plan.warnings.map((w, i) => (
                <Notice key={i} tone="warn">{w}</Notice>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>

      <div className="stack">
        {plan.error ? <Notice tone="bad">{plan.error}</Notice> : null}
        {plan.dropped ? <Notice tone="bad">{plan.dropReason}</Notice> : null}

        <Panel title="Fragment layout" hint="Width is each fragment's share of the original payload.">
          {plan.fragments.length ? (
            <div className="frag-bar">
              {plan.fragments.map((f, i) => (
                <div
                  key={f.index}
                  className="frag-seg"
                  style={{ width: `${(f.payloadBytes / Math.max(1, plan.payloadBytes)) * 100}%`, background: COLORS[i % COLORS.length] }}
                  title={`Fragment ${f.index + 1}: ${f.payloadBytes} B data`}
                >
                  {f.payloadBytes}B
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">No fragments — the datagram is not split (or was dropped).</p>
          )}
          {plan.fragments.length ? (
            <p className="hint mt">{plan.detail}</p>
          ) : null}
        </Panel>

        {plan.fragments.length ? (
          <Panel title="Fragment table" hint="Every fragment repeats the header; offsets are in 8-byte units. Scroll sideways if needed.">
            <DataTable
              columns={['#', 'Data', 'Total', 'Off ×8', 'Off B', 'MF', 'ID']}
              rows={plan.fragments.map((f) => [
                String(f.index + 1),
                String(f.payloadBytes),
                String(f.totalLength),
                String(f.offsetUnits),
                String(f.offsetBytes),
                f.moreFragments ? '1' : '0',
                String(f.identification),
              ])}
            />
            <p className="hint mt">
              Bytes on wire: <strong>{plan.bytesOnWire} B</strong> vs the original {datagramBytes} B — {plan.overheadBytes} B is repeated-header overhead.
            </p>
          </Panel>
        ) : null}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v" style={{ fontSize: 16 }}>{value}</div>
    </div>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n)))
}

function clampRound4(n: number): number {
  return clamp(Math.round(n / 4) * 4, 20, 60)
}
