import type { ReactNode } from 'react'
import { AppProvider, useStore, type ModuleId } from './state/store'
import { PRESETS } from './core/presets'
import { StudioModule } from './modules/StudioModule'
import { PacketModule } from './modules/PacketModule'
import { RoutingModule } from './modules/RoutingModule'
import { Ipv4Module } from './modules/Ipv4Module'
import { FragmentationModule } from './modules/FragmentationModule'
import { Ipv6Module } from './modules/Ipv6Module'
import { IcmpModule } from './modules/IcmpModule'
import { CircuitModule } from './modules/CircuitModule'
import { ChallengeModule } from './modules/ChallengeModule'
import { ReportModule } from './modules/ReportModule'

interface NavEntry {
  id: ModuleId
  icon: string
  label: string
  group: string
}

const NAV: NavEntry[] = [
  { id: 'studio', icon: '◉', label: 'Topology studio', group: 'Explore' },
  { id: 'packet', icon: '➤', label: 'Packet journey', group: 'Explore' },
  { id: 'routing', icon: '⚙', label: 'Routing algorithms', group: 'Explore' },
  { id: 'ipv4', icon: '⊞', label: 'IPv4 & CIDR', group: 'Addressing' },
  { id: 'frag', icon: '▤', label: 'Fragmentation lab', group: 'Addressing' },
  { id: 'ipv6', icon: '⬡', label: 'IPv6 explorer', group: 'Addressing' },
  { id: 'icmp', icon: '⇄', label: 'ICMP & traceroute', group: 'Diagnosis' },
  { id: 'circuit', icon: '⛓', label: 'VC vs datagram', group: 'Diagnosis' },
  { id: 'challenges', icon: '★', label: 'Challenge mode', group: 'Learn' },
  { id: 'report', icon: '▤', label: 'Experiment report', group: 'Learn' },
]

function renderModule(id: ModuleId): ReactNode {
  switch (id) {
    case 'studio':
      return <StudioModule />
    case 'packet':
      return <PacketModule />
    case 'routing':
      return <RoutingModule />
    case 'ipv4':
      return <Ipv4Module />
    case 'frag':
      return <FragmentationModule />
    case 'ipv6':
      return <Ipv6Module />
    case 'icmp':
      return <IcmpModule />
    case 'circuit':
      return <CircuitModule />
    case 'challenges':
      return <ChallengeModule />
    case 'report':
      return <ReportModule />
    default:
      return null
  }
}

const MODULE_TITLES: Record<ModuleId, { title: string; sub: string }> = {
  studio: { title: 'Network topology studio', sub: 'Build, break and save the network everything else simulates on.' },
  packet: { title: 'Packet journey simulator', sub: 'Send a datagram and inspect every router decision, hop by hop.' },
  routing: { title: 'Routing algorithm comparison', sub: 'Dijkstra, distance-vector, RIP, OSPF and BGP on the same topology.' },
  ipv4: { title: 'IPv4 & CIDR explorer', sub: 'Mask, network, broadcast, usable range and the 32-bit view.' },
  frag: { title: 'IPv4 fragmentation lab', sub: 'Split a datagram across an MTU and prove it reassembles.' },
  ipv6: { title: 'IPv6 explorer', sub: 'Expand, compress, compare prefixes and read the 40-byte header.' },
  icmp: { title: 'ICMP & traceroute lab', sub: 'Walk a path with rising TTL and read the replies.' },
  circuit: { title: 'Virtual circuit vs datagram', sub: 'Per-call state against per-packet lookup, side by side.' },
  challenges: { title: 'Interactive challenges', sub: 'Solve routing, addressing and failure puzzles with instant feedback.' },
  report: { title: 'Chapter 4 experiment report', sub: 'Generate printable evidence straight from live simulation state.' },
}

function Shell() {
  const { state, dispatch } = useStore()
  const groups = [...new Set(NAV.map((n) => n.group))]
  const preset = PRESETS.find((p) => p.id === state.topology.id)
  const heading = MODULE_TITLES[state.activeModule]

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" fill="#fff" />
              <circle cx="5" cy="6" r="2" fill="#22d3ee" />
              <circle cx="19" cy="6" r="2" fill="#22d3ee" />
              <circle cx="6" cy="19" r="2" fill="#22d3ee" />
              <g stroke="#22d3ee" strokeWidth="1.2" opacity="0.85">
                <line x1="12" y1="12" x2="5" y2="6" />
                <line x1="12" y1="12" x2="19" y2="6" />
                <line x1="12" y1="12" x2="6" y2="19" />
              </g>
            </svg>
          </div>
          <div>
            <div className="name">NetScope</div>
            <div className="tag">Inside the Internet</div>
          </div>
        </div>

        {groups.map((group) => (
          <div key={group}>
            <div className="nav-group-label">{group}</div>
            {NAV.filter((n) => n.group === group).map((n) => (
              <button
                key={n.id}
                className={`nav-item${state.activeModule === n.id ? ' active' : ''}`}
                onClick={() => dispatch({ type: 'setModule', module: n.id })}
              >
                <span className="nav-ico">{n.icon}</span>
                <span>{n.label}</span>
              </button>
            ))}
          </div>
        ))}

        <div className="sidebar-footer">
          Computer Networks · Chapter 4 — the network layer. All simulations are deterministic and run entirely in your browser.
        </div>
      </aside>

      <header className="topbar">
        <div>
          <div className="topbar-title">{heading.title}</div>
          <div className="topbar-sub">{heading.sub}</div>
        </div>
        <div className="spacer" />
        <div className="pill-list">
          <span className="chip">
            Topology: <strong style={{ color: 'var(--text)' }}>{state.topology.name}</strong>
            {preset ? ' (preset)' : state.topology.id === 'custom' ? ' (custom)' : ''}
          </span>
          <span className="chip">{state.topology.nodes.length} nodes · {state.topology.links.length} links</span>
        </div>
      </header>

      <main className="main">{renderModule(state.activeModule)}</main>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
