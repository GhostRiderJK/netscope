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
  icon: IconName
  label: string
  group: string
}

export type IconName =
  | 'studio'
  | 'packet'
  | 'routing'
  | 'ipv4'
  | 'frag'
  | 'ipv6'
  | 'icmp'
  | 'circuit'
  | 'challenges'
  | 'report'

const NAV: NavEntry[] = [
  { id: 'studio', icon: 'studio', label: 'Topology studio', group: 'Explore' },
  { id: 'packet', icon: 'packet', label: 'Packet journey', group: 'Explore' },
  { id: 'routing', icon: 'routing', label: 'Routing algorithms', group: 'Explore' },
  { id: 'ipv4', icon: 'ipv4', label: 'IPv4 & CIDR', group: 'Addressing' },
  { id: 'frag', icon: 'frag', label: 'Fragmentation lab', group: 'Addressing' },
  { id: 'ipv6', icon: 'ipv6', label: 'IPv6 explorer', group: 'Addressing' },
  { id: 'icmp', icon: 'icmp', label: 'ICMP & traceroute', group: 'Diagnosis' },
  { id: 'circuit', icon: 'circuit', label: 'VC vs datagram', group: 'Diagnosis' },
  { id: 'challenges', icon: 'challenges', label: 'Challenge mode', group: 'Learn' },
  { id: 'report', icon: 'report', label: 'Experiment report', group: 'Learn' },
]

const ICONS: Record<IconName, ReactNode> = {
  studio: (
    <>
      <circle cx="5" cy="6" r="2" />
      <rect x="14" y="4" width="5" height="5" rx="1" />
      <circle cx="8" cy="18" r="2" />
      <path d="M7 7l7 1M9 17l-2-9" />
    </>
  ),
  packet: (
    <>
      <rect x="3" y="8" width="12" height="8" rx="1.5" />
      <path d="M15 12h6M18 9l3 3-3 3" />
    </>
  ),
  routing: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M8 7l8 4M8 17l8-4" />
    </>
  ),
  ipv4: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </>
  ),
  frag: (
    <>
      <rect x="3" y="8" width="6" height="8" rx="1" />
      <rect x="10" y="8" width="4" height="8" rx="1" />
      <rect x="15" y="8" width="6" height="8" rx="1" />
    </>
  ),
  ipv6: (
    <>
      <path d="M12 3l7 4v10l-7 4-7-4V7z" />
      <path d="M12 8v8M8 10v4M16 10v4" />
    </>
  ),
  icmp: (
    <>
      <path d="M4 8h11l-3-3M20 16H9l3 3" />
    </>
  ),
  circuit: (
    <>
      <path d="M8 12a4 4 0 014-4h2a4 4 0 010 8h-2" />
      <path d="M16 12a4 4 0 01-4 4h-2a4 4 0 010-8h2" />
    </>
  ),
  challenges: (
    <>
      <path d="M12 3l2.5 5.3 5.5.8-4 4 1 5.6-5-2.7-5 2.7 1-5.6-4-4 5.5-.8z" />
    </>
  ),
  report: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h7" />
    </>
  ),
}

function Icon({ name }: { name: IconName }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

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
              <circle cx="12" cy="12" r="3" fill="#315ccb" />
              <circle cx="5" cy="6" r="2" fill="#20282d" />
              <circle cx="19" cy="6" r="2" fill="#20282d" />
              <circle cx="6" cy="19" r="2" fill="#20282d" />
              <g stroke="#315ccb" strokeWidth="1.2" opacity="0.6">
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
                <span className="nav-ico">
                  <Icon name={n.icon} />
                </span>
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
