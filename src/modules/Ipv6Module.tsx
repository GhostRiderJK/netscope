import { useMemo, useState } from 'react'
import {
  IPV4_VS_IPV6,
  IPV6_ADDRESS_TYPES,
  NEXT_HEADER_NUMBERS,
  compressIpv6,
  describeIpv6Header,
  expandIpv6,
  interfaceIdFromMac,
  parseIpv6,
  sameIpv6Prefix,
} from '../core/ipv6'
import { makeReport, reportToMarkdown } from '../core/report'
import type { Topology } from '../core/types'
import { Badge, DataTable, Notice, Panel, TextField, NumberField, SelectField } from '../components/ui'
import { downloadText } from './download'

const EMPTY_TOPOLOGY: Topology = { id: 'none', name: 'No topology required', summary: 'IPv6 address and header arithmetic only.', nodes: [], links: [], policies: [] }

const QUICK6: { label: string; value: string }[] = [
  { label: 'Global', value: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' },
  { label: 'Compressed', value: '2001:db8::1' },
  { label: 'Loopback', value: '::1' },
  { label: 'Unspecified', value: '::' },
  { label: 'Embedded IPv4', value: '::ffff:192.0.2.128' },
  { label: 'Link-local', value: 'fe80::1' },
]

export function Ipv6Module() {
  const [address, setAddress] = useState('2001:0db8:85a3::8a2e:0370:7334')
  const [other, setOther] = useState('2001:0db8:85a3:0000:0000:0000:0000:0001')
  const [prefix, setPrefix] = useState(48)
  const [mac, setMac] = useState('02:42:ac:11:00:02')

  const parsed = useMemo(() => parseIpv6(address), [address])
  const expanded = parsed.ok ? expandIpv6(address) : ''
  const compressed = parsed.ok ? compressIpv6(address) : ''
  const compare = useMemo(() => sameIpv6Prefix(address, other, prefix), [address, other, prefix])
  const iid = useMemo(() => interfaceIdFromMac(mac), [mac])

  const groups = expanded.split(':')

  return (
    <div className="workspace cols-2">
      <div className="stack">
        <Panel
          title="Address"
          actions={
            <button
              className="btn sm"
              disabled={!parsed.ok}
              onClick={() =>
                downloadText(
                  'ipv6-address.md',
                  reportToMarkdown(
                    makeReport({
                      id: 'ipv6',
                      title: `IPv6 address analysis ${compressed}`,
                      objective: 'Expand, compress and inspect a 128-bit IPv6 address and derive a SLAAC interface identifier.',
                      module: 'Module F — IPv6 explorer',
                      topology: EMPTY_TOPOLOGY,
                      configuration: [
                        { label: 'Input', value: address },
                        { label: 'Expanded', value: expanded },
                        { label: 'Compressed (RFC 5952)', value: compressed },
                      ],
                      results: [
                        { label: 'Prefix comparison', value: compare.ok ? (compare.shared ? 'same' : 'different') : compare.error ?? '' },
                        { label: 'Interface ID from MAC', value: iid.ok ? `${iid.value}` : iid.error ?? '' },
                      ],
                      interpretation: ['IPv6 has no broadcast and routers never fragment; the source fragments using a Fragment extension header guided by ICMPv6 Packet Too Big.'],
                    })
                  )
                )
              }
            >
              Report
            </button>
          }
        >
          <div className="btn-row" style={{ marginBottom: 12 }}>
            {QUICK6.map((q) => (
              <button key={q.label} className="btn sm ghost" onClick={() => setAddress(q.value)}>
                {q.label}
              </button>
            ))}
          </div>
          <TextField label="IPv6 address" value={address} mono invalid={!parsed.ok} onChange={setAddress} />
          {!parsed.ok ? <Notice tone="bad">{parsed.error}</Notice> : null}
          {parsed.ok ? (
            <>
              <div className="kv"><span className="k">Expanded</span><span className="v">{expanded}</span></div>
              <div className="kv"><span className="k">Compressed (RFC 5952)</span><span className="v">{compressed}</span></div>
            </>
          ) : null}
        </Panel>

        <Panel title="128-bit view" hint="Eight 16-bit groups; hex over binary.">
          {parsed.ok ? (
            <div className="nibble-grid">
              {groups.map((g, i) => (
                <div key={i} className="nibble">
                  <div className="hex">{g}</div>
                  <div className="bin">{Number.parseInt(g, 16).toString(2).padStart(16, '0')}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">Enter a valid address.</p>
          )}
        </Panel>

        <Panel title="Prefix & SLAAC">
          <div className="row-grid">
            <TextField label="Second address" value={other} mono onChange={setOther} />
            <NumberField label="Compare prefix (/0–128)" value={prefix} min={0} max={128} onChange={(n) => setPrefix(Number.isFinite(n) ? Math.max(0, Math.min(128, Math.round(n))) : 0)} />
          </div>
          {compare.ok ? (
            <div className="btn-row mt">
              <Badge tone={compare.shared ? 'ok' : 'info'}>{compare.shared ? 'Same prefix' : 'Different prefix'}</Badge>
              <span className="chip">A → {compare.networkA}</span>
              <span className="chip">B → {compare.networkB}</span>
            </div>
          ) : (
            <Notice tone="bad">{compare.error}</Notice>
          )}
          <TextField label="MAC (EUI-64)" value={mac} mono onChange={setMac} placeholder="02:42:ac:11:00:02" />
          {iid.ok ? (
            <div className="kv mt"><span className="k">Interface identifier</span><span className="v">{iid.value}</span></div>
          ) : (
            <p className="hint">{iid.error}</p>
          )}
          {iid.ok && parsed.ok ? <p className="hint">With a /64, combine any subnet prefix and this IID for a SLAAC address.</p> : null}
        </Panel>
      </div>

      <div className="stack">
        <HeaderBuilder />
        <Panel title="Address types">
          <DataTable columns={['Type', 'Prefix', 'Scope', 'Note']} rows={IPV6_ADDRESS_TYPES.map((t) => [t.name, t.prefix, t.scope, t.note])} />
        </Panel>
        <Panel title="IPv4 vs IPv6" hint="The Chapter 4 comparison.">
          <DataTable columns={['Aspect', 'IPv4', 'IPv6']} rows={IPV4_VS_IPV6.map((r) => [r.aspect, r.v4, r.v6])} />
        </Panel>
      </div>
    </div>
  )
}

function HeaderBuilder() {
  const [trafficClass, setTc] = useState(0)
  const [flowLabel, setFlow] = useState(0)
  const [payloadLength, setPayload] = useState(1220)
  const [nextHeader, setNh] = useState(6)
  const [hopLimit, setHop] = useState(64)

  const header = useMemo(
    () => describeIpv6Header({ trafficClass, flowLabel, payloadLength, nextHeader, hopLimit }),
    [trafficClass, flowLabel, payloadLength, nextHeader, hopLimit]
  )

  return (
    <Panel
      title="40-byte base header"
      actions={<Badge tone={header.ok ? 'ok' : 'bad'}>{header.ok ? `${header.totalBytes} bytes` : 'invalid'}</Badge>}
    >
      <div className="row-grid">
        <NumberField label="Traffic Class (0–255)" value={trafficClass} min={0} max={255} onChange={(n) => setTc(clamp(n, 0, 255))} />
        <NumberField label="Flow Label" value={flowLabel} min={0} max={1048575} onChange={(n) => setFlow(clamp(n, 0, 1048575))} />
        <NumberField label="Payload Length (B)" value={payloadLength} min={0} max={65535} onChange={(n) => setPayload(clamp(n, 0, 65535))} />
        <NumberField label="Hop Limit (TTL)" value={hopLimit} min={0} max={255} onChange={(n) => setHop(clamp(n, 0, 255))} />
      </div>
      <SelectField
        label="Next Header"
        value={String(nextHeader)}
        onChange={(v) => setNh(Number(v))}
        options={Object.entries(NEXT_HEADER_NUMBERS).map(([k, name]) => ({ value: k, label: `${k} — ${name}` }))}
      />
      {!header.ok ? <Notice tone="bad">{header.error}</Notice> : null}
      {header.ok ? (
        <DataTable
          columns={['Field', 'Bits', 'Value']}
          rows={header.fields.map((f) => [f.name, String(f.bits), f.value])}
        />
      ) : null}
      <p className="hint mt">Fixed 40 bytes, no options field and no header checksum. “Payload Length” counts bytes after this header, unlike IPv4’s total-length field.</p>
    </Panel>
  )
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.round(n)))
}
