import { useMemo, useState } from 'react'
import { computeFragments } from '../core/fragmentation'
import { describeSubnet, sameSubnet } from '../core/ipv4'
import { compressIpv6, parseIpv6 } from '../core/ipv6'
import { dijkstra } from '../core/algorithms/linkState'
import { label } from '../core/routing'
import type { Topology } from '../core/types'
import { Badge, Notice, Panel } from '../components/ui'
import { useStore } from '../state/store'

interface Challenge {
  id: string
  title: string
  prompt: string
  placeholder: string
  grade: (answer: string) => { ok: boolean; detail: string }
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

export function ChallengeModule() {
  const { state } = useStore()
  const topology = state.topology
  const challenges = useMemo(() => buildChallenges(topology), [topology])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [results, setResults] = useState<Record<string, { ok: boolean; detail: string } | undefined>>({})

  const solved = Object.values(results).filter((r) => r?.ok).length

  function check(c: Challenge) {
    const result = c.grade(answers[c.id] ?? '')
    setResults((prev) => ({ ...prev, [c.id]: result }))
  }

  return (
    <div className="workspace">
      <div className="stack">
        <Panel title="Chapter 4 challenges" hint="Every target here is recomputed from the live topology with the same engine the other modules use — no fixed answer key.">
          <div className="btn-row">
            <Badge tone={solved === challenges.length && challenges.length ? 'ok' : 'info'}>
              {solved} / {challenges.length} solved
            </Badge>
            <span className="chip">
              On topology: <strong style={{ color: 'var(--text)' }}>{topology.name}</strong>
            </span>
            {solved < challenges.length ? (
              <button className="btn sm ghost" onClick={() => { setAnswers({}); setResults({}) }}>Reset</button>
            ) : (
              <Notice tone="ok">All solved on this topology. Switch preset in the studio to try fresh numbers.</Notice>
            )}
          </div>
        </Panel>

        <div className="comparison">
          {challenges.map((c) => {
            const r = results[c.id]
            return (
              <Panel key={c.id} title={c.title}>
                <p className="small" style={{ color: 'var(--text-dim)', margin: '0 0 10px' }}>{c.prompt}</p>
                <div className="row">
                  <input
                    className={r && !r.ok ? 'invalid' : undefined}
                    value={answers[c.id] ?? ''}
                    placeholder={c.placeholder}
                    onChange={(e) => setAnswers((a) => ({ ...a, [c.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === 'Enter' && check(c)}
                  />
                  <button className="btn sm primary" onClick={() => check(c)}>Check</button>
                </div>
                {r ? (
                  <div className="mt">
                    <Badge tone={r.ok ? 'ok' : 'bad'}>{r.ok ? 'Correct' : 'Not yet'}</Badge>
                    <div className="small" style={{ color: r.ok ? 'var(--text-dim)' : 'var(--warn)', marginTop: 6 }}>{r.detail}</div>
                  </div>
                ) : null}
              </Panel>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function buildChallenges(topology: Topology): Challenge[] {
  const routers = topology.nodes.filter((n) => n.kind === 'router')
  const hosts = topology.nodes.filter((n) => n.kind !== 'router')
  const src = routers[0] ?? topology.nodes[0]
  const dst = pickFarthest(topology, routers.at(-1)?.id ?? src?.id ?? '')
  const reachable = src && dst && src.id !== dst && Number.isFinite(dijkstra(topology, src.id).cost[dst])

  const subnetNode = hosts.find((h) => h.ip && h.prefix !== undefined) ?? topology.nodes.find((n) => n.ip && n.prefix !== undefined)
  const frag = computeFragments({ datagramBytes: 4000, headerLength: 20, mtu: 1500, dontFragment: false, identification: 1 })
  const frag2 = frag.fragments[1]
  const six = topology.nodes.find((n) => n.ip && n.ip.includes(':'))?.ip ?? '2001:db8:0:0:0:1:2:3'

  const out: Challenge[] = []

  if (subnetNode?.ip && subnetNode.prefix !== undefined) {
    const info = describeSubnet(subnetNode.ip, subnetNode.prefix)
    out.push({
      id: 'subnet',
      title: 'Find the network',
      prompt: `For ${subnetNode.label} at ${subnetNode.ip}/${subnetNode.prefix}, what is the network (subnet) address? Answer as a.b.c.d.`,
      placeholder: 'e.g. 192.168.10.128',
      grade: (a) =>
        info.ok
          ? norm(a) === norm(info.network)
            ? { ok: true, detail: `Right — ${info.mask} keeps the high ${info.prefix} bits, so ${subnetNode.ip} lands in ${info.network}/${info.prefix}. It has ${info.usable} usable hosts.` }
            : { ok: false, detail: `Not quite. AND ${subnetNode.ip} with mask ${info.mask} bit by bit — the host part goes to zero.` }
          : { ok: false, detail: 'That node has an invalid address.' },
    })
    out.push({
      id: 'hosts',
      title: 'Host capacity',
      prompt: `How many assignable host addresses does the ${subnetNode.ip}/${subnetNode.prefix} block have (exclude network and broadcast unless the prefix is /31 or /32)?`,
      placeholder: 'a number',
      grade: (a) =>
        info.ok
          ? Number(a) === info.usable
            ? { ok: true, detail: `Correct: ${info.usable} = 2^${info.hostBits} − 2 (all-zeros is the network, all-ones is the broadcast).` }
            : { ok: false, detail: `Remember 2^(32 − ${info.prefix}) total minus the two reserved addresses, unless it is a /31 or /32.` }
          : { ok: false, detail: 'Invalid block.' },
    })
  }

  if (hosts.length && src) {
    const host = hosts.find((h) => h.ip && h.prefix !== undefined) ?? hosts[0]!
    const other = topology.nodes.find((n) => n.ip && n.id !== host.id && n.ip !== host.ip)
    if (host.ip && host.prefix !== undefined && other?.ip) {
      const same = sameSubnet(host.ip, other.ip, host.prefix)
      const wantsGateway = same.ok ? !same.shared : true
      const hostNet = same.ok ? `${same.networkA}/${host.prefix}` : 'its own subnet'
      const otherNet = same.ok ? `${same.networkB}/${host.prefix}` : 'another network'
      const reason = wantsGateway
        ? `${other.ip} ANDed with the ${host.prefix}-bit mask gives ${otherNet}, which differs from ${host.label}'s ${hostNet}. The host cannot ARP for a device on another network, so it forwards to its default gateway.`
        : `Both ${host.ip} and ${other.ip} ANDed with the ${host.prefix}-bit mask give ${hostNet} — the same subnet. The host ARPs for the destination's MAC and delivers directly, no gateway involved.`
      out.push({
        id: 'decision',
        title: 'Direct or via gateway?',
        prompt: `${host.label} (${host.ip}/${host.prefix}) wants to reach ${other.ip} (${other.label}). Does it ARP for the destination directly, or forward to its gateway? Answer "direct" or "gateway".`,
        placeholder: 'direct / gateway',
        grade: (a) => {
          const got = norm(a)
          if (got !== 'direct' && got !== 'gateway') return { ok: false, detail: 'Type either "direct" or "gateway".' }
          const correct = wantsGateway ? 'gateway' : 'direct'
          return got === correct
            ? { ok: true, detail: reason }
            : { ok: false, detail: `Compare both addresses ANDed with the ${host.prefix}-bit mask first — if the networks match it is direct, otherwise it needs the gateway.` }
        },
      })
    }
  }

  if (reachable && src && dst) {
    const sp = dijkstra(topology, src.id)
    const cost = sp.cost[dst]!
    out.push({
      id: 'dijkstra',
      title: 'Shortest cost',
      prompt: `Run Dijkstra from ${label(topology, src.id)} to ${label(topology, dst)} on this topology. What is the minimum total cost (a congested link adds +10)?`,
      placeholder: 'a number',
      grade: (a) =>
        Number(a) === cost
          ? { ok: true, detail: `Correct. The tree reaches ${label(topology, dst)} at cost ${cost}: ${sp.order.length} routers settled along the way.` }
          : { ok: false, detail: 'Work the table: settle the cheapest unsettled node, relax its neighbours, repeat. Costs accumulate along the chosen tree.' },
    })
  }

  if (frag.ok && frag2) {
    out.push({
      id: 'frag',
      title: 'Second fragment',
      prompt: 'A 4000 B datagram with a 20 B header crosses a 1500 B MTU. How many BYTES of data does the second fragment carry, and what value goes in its Fragment Offset field (in 8-byte units)? Answer like "1480 370".',
      placeholder: 'dataBytes offsetUnits',
      grade: (a) => {
        const parts = a.trim().split(/\s+/)
        const ok = parts[0] === String(frag2.payloadBytes) && parts[1] === String(frag2.offsetUnits)
        return ok
          ? { ok: true, detail: `Yes — fragment 2 carries ${frag2.payloadBytes} B at offset ${frag2.offsetUnits}×8 = ${frag2.offsetBytes} B, MF=${frag2.moreFragments ? 1 : 0}.` }
          : { ok: false, detail: 'Each non-final fragment holds a multiple of 8 bytes: floor((MTU − header)/8)×8 of data, and the offset is the previous fragment’s cumulative data divided by 8.' }
      },
    })
  }

  if (parseIpv6(six).ok) {
    const compressed = compressIpv6(six)
    out.push({
      id: 'ipv6',
      title: 'Compress IPv6',
      prompt: `Write ${six} in RFC 5952 compressed form (longest leftmost run of zeros becomes "::", leading zeros in each group dropped).`,
      placeholder: 'e.g. 2001:db8::1:2:3',
      grade: (a) =>
        norm(a) === norm(compressed)
          ? { ok: true, detail: `Correct: ${compressed}.` }
          : { ok: false, detail: 'Only the single longest run of all-zero groups may collapse to "::", and it must be the leftmost if runs tie. Never use "::" for one group.' },
    })
  }

  return out
}

function pickFarthest(topology: Topology, from: string): string | undefined {
  if (!from) return undefined
  const sp = dijkstra(topology, from)
  let best: string | undefined
  let bestCost = -1
  for (const n of topology.nodes) {
    const c = sp.cost[n.id]
    if (Number.isFinite(c) && n.id !== from && c > bestCost) {
      bestCost = c
      best = n.id
    }
  }
  return best
}
