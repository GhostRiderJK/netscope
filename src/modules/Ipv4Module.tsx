import { useMemo, useState } from 'react'
import {
  PRIVATE_BLOCKS,
  addressClassOf,
  aggregate,
  binaryOctets,
  cidrOverlap,
  deliveryDecision,
  describeSubnet,
  matchBytes,
  parseIpv4,
  sameSubnet,
  toBinary32,
} from '../core/ipv4'
import { reportForSubnet, reportToMarkdown } from '../core/report'
import { Badge, DataTable, Notice, Panel, TextField, NumberField, formatNum } from '../components/ui'
import { downloadText } from './download'

const QUICK: { label: string; address: string; prefix: number }[] = [
  { label: 'Worked example 192.168.10.130/26', address: '192.168.10.130', prefix: 26 },
  { label: 'Point-to-point /31', address: '192.168.1.1', prefix: 31 },
  { label: 'Host route /32', address: '10.0.0.7', prefix: 32 },
  { label: 'Default route /0', address: '0.0.0.0', prefix: 0 },
]

export function Ipv4Module() {
  const [address, setAddress] = useState('192.168.10.130')
  const [prefix, setPrefix] = useState(26)
  const [hostA, setHostA] = useState('192.168.10.130')
  const [hostB, setHostB] = useState('192.168.10.150')
  const [gateway, setGateway] = useState('192.168.10.190')

  const info = useMemo(() => describeSubnet(address, prefix), [address, prefix])
  const parsed = useMemo(() => parseIpv4(address), [address])
  const same = useMemo(() => sameSubnet(hostA, hostB, prefix), [hostA, hostB, prefix])
  const decision = useMemo(() => deliveryDecision(hostA, prefix, '8.8.8.8', gateway), [hostA, prefix, gateway])

  const mask = info.ok ? info.maskBinary : ''
  const addrBits = parsed.ok ? toBinary32(parsed.value) : ''

  return (
    <div className="workspace cols-2">
      <div className="stack">
        <Panel
          title="Address & prefix"
          actions={
            <button className="btn sm" onClick={() => downloadText('ipv4-subnet.md', reportToMarkdown(reportForSubnet(info, { a: hostA, b: hostB, prefix })))}>
              Report
            </button>
          }
        >
          <div className="btn-row" style={{ marginBottom: 12 }}>
            {QUICK.map((q) => (
              <button key={q.label} className="btn sm ghost" onClick={() => { setAddress(q.address); setPrefix(q.prefix) }}>
                {q.label}
              </button>
            ))}
          </div>
          <TextField label="IPv4 address" value={address} mono invalid={!parsed.ok} onChange={setAddress} placeholder="192.168.10.130" />
          <div className="row-grid">
            <NumberField label="Prefix length (/0–32)" value={prefix} min={0} max={32} onChange={(n) => setPrefix(Number.isFinite(n) ? Math.max(0, Math.min(32, Math.round(n))) : 0)} />
            <div className="field">
              <label>Mask</label>
              <input type="range" min={0} max={32} value={prefix} onChange={(e) => setPrefix(Number(e.target.value))} />
            </div>
          </div>
          {!parsed.ok ? <Notice tone="bad">{parsed.error}</Notice> : null}
          {info.ok ? null : parsed.ok && info.error ? <Notice tone="bad">{info.error}</Notice> : null}
        </Panel>

        <Panel title="Two-host test" hint="Are two addresses on the same subnet?">
          <div className="row-grid">
            <TextField label="Host A" value={hostA} mono onChange={setHostA} />
            <TextField label="Host B" value={hostB} mono onChange={setHostB} />
          </div>
          <TextField label="Default gateway (router on Host A's subnet)" value={gateway} mono onChange={setGateway} placeholder="192.168.10.190" />
          {same.ok ? (
            <div className="btn-row mt">
              <Badge tone={same.shared ? 'ok' : 'info'}>{same.shared ? 'Same subnet' : 'Different subnets'}</Badge>
              <span className="chip">A → {same.networkA}</span>
              <span className="chip">B → {same.networkB}</span>
            </div>
          ) : (
            <Notice tone="bad">{same.error}</Notice>
          )}
          <p className="hint mt">{decision.reason}</p>
        </Panel>

        <PrivateBlocks />
      </div>

      <div className="stack">
        <Panel title="32-bit view" hint="Blue = network bits, dim = host bits.">
          {info.ok ? (
            <div className="stack" style={{ gap: 10 }}>
              <BitRow caption="Address" bits={addrBits} split={prefix} />
              <BitRow caption="Netmask" bits={mask} split={prefix} />
              <div className="small muted">The mask is all-ones up to bit {prefix}; the address AND mask gives the network, address AND wildcard gives the broadcast.</div>
            </div>
          ) : (
            <Notice tone="bad">Enter a valid address and prefix to see the bit view.</Notice>
          )}
        </Panel>

        {info.ok ? (
          <Panel title={`Subnet ${info.network}/${info.prefix}`}>
            <div className="stat-grid">
              <Stat label="Mask" value={info.mask} />
              <Stat label="Wildcard" value={info.wildcard} />
              <Stat label="Network" value={info.network} />
              <Stat label="Broadcast" value={info.broadcast} />
              <Stat label="First usable" value={info.firstUsable ?? '—'} />
              <Stat label="Last usable" value={info.lastUsable ?? '—'} />
              <Stat label="Total addresses" value={formatNum(info.total)} />
              <Stat label="Usable hosts" value={formatNum(info.usable)} />
            </div>
            <div className="kv mt">
              <span className="k">Binary address</span>
              <span className="v">{binaryOctets(parsed.value)}</span>
            </div>
            <div className="kv">
              <span className="k">Classful view</span>
              <span className="v">{addressClassOf(address)}</span>
            </div>
            <div className="kv">
              <span className="k">Network / host bits</span>
              <span className="v">{info.networkBits} / {info.hostBits}</span>
            </div>
            {info.special ? <Notice tone="info" >{info.note}</Notice> : <p className="hint mt">{info.note}</p>}
          </Panel>
        ) : null}

        <CidrTools />
      </div>
    </div>
  )
}

function CidrTools() {
  const [a, setA] = useState('192.168.10.0')
  const [pa, setPa] = useState(24)
  const [b, setB] = useState('192.168.11.0')
  const [pb, setPb] = useState(24)
  const agg = useMemo(() => aggregate(a, pa, b, pb), [a, pa, b, pb])
  const overlap = useMemo(() => cidrOverlap(a, pa, b, pb), [a, pa, b, pb])
  return (
    <Panel title="Supernetting & overlap" hint="CIDR aggregation and the collision check.">
      <div className="row-grid">
        <TextField label="Block A" value={a} mono onChange={setA} />
        <NumberField label="A prefix" value={pa} min={0} max={32} onChange={(n) => setPa(clampP(n))} />
        <TextField label="Block B" value={b} mono onChange={setB} />
        <NumberField label="B prefix" value={pb} min={0} max={32} onChange={(n) => setPb(clampP(n))} />
      </div>
      <div className="btn-row mt">
        <Badge tone={overlap.ok && overlap.overlaps ? 'bad' : 'ok'}>{overlap.overlaps ? 'Overlap' : 'Disjoint'}</Badge>
        <span className="chip">Aggregate: {agg.block ?? '—'}</span>
      </div>
      <p className="hint mt">{overlap.detail}</p>
      <p className="hint">{agg.detail}</p>
    </Panel>
  )
}

function PrivateBlocks() {
  return (
    <Panel title="Well-known blocks">
      <DataTable
        columns={['Block', 'Range', 'Use']}
        rows={PRIVATE_BLOCKS.map((p) => [p.block, p.range, p.use])}
      />
    </Panel>
  )
}

function BitRow({ caption, bits, split }: { caption: string; bits: string; split: number }) {
  if (!bits) return null
  const octets = matchBytes(bits)
  return (
    <div>
      <div className="section-title">{caption}</div>
      <div className="bit-grid">
        {octets.map((octet, oi) =>
          octet.split('').map((bit, bi) => {
            const idx = oi * 8 + bi
            const isNet = idx < split
            const edge = bi === 7 ? ' octet-edge' : ''
            return (
              <span key={idx} className={`bit ${isNet ? 'net' : 'host'}${edge}`}>
                {bit}
              </span>
            )
          })
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v" style={{ fontSize: 15 }}>{value}</div>
    </div>
  )
}

function clampP(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(32, Math.round(n))) : 0
}
