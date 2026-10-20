import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from 'react'
import type { LinkStatus, NetLink, NetNode, RoutingAlgorithm, Topology } from '../core/types'
import { DEFAULT_TOPOLOGY_ID, blankTopology, cloneTopology, presetById } from '../core/presets'
import { parseTopologyJson, topologyToJson } from '../core/serialize'

export type ModuleId =
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

export interface SavedTopology {
  id: string
  name: string
  savedAt: string
  json: string
}

export interface PacketConfig {
  algorithm: RoutingAlgorithm
  srcId: string
  dstId: string
  packetBytes: number
  headerLength: number
  initialTtl: number
  dontFragment: boolean
  count: number
  speed: number
}

export interface AppState {
  topology: Topology
  activeModule: ModuleId
  selectedNodeId: string | null
  selectedLinkId: string | null
  savedTopologies: SavedTopology[]
  packet: PacketConfig
}

export type Action =
  | { type: 'loadPreset'; id: string }
  | { type: 'newBlank' }
  | { type: 'replaceTopology'; topology: Topology }
  | { type: 'renameTopology'; name: string }
  | { type: 'setModule'; module: ModuleId }
  | { type: 'selectNode'; id: string | null }
  | { type: 'selectLink'; id: string | null }
  | { type: 'addNode'; node: NetNode }
  | { type: 'updateNode'; id: string; patch: Partial<NetNode> }
  | { type: 'moveNode'; id: string; x: number; y: number }
  | { type: 'removeNode'; id: string }
  | { type: 'addLink'; link: NetLink }
  | { type: 'updateLink'; id: string; patch: Partial<NetLink> }
  | { type: 'cycleLinkStatus'; id: string }
  | { type: 'removeLink'; id: string }
  | { type: 'setPacket'; patch: Partial<PacketConfig> }
  | { type: 'saveCurrent'; id: string }
  | { type: 'loadSaved'; id: string }
  | { type: 'deleteSaved'; id: string }

const STORAGE_KEY = 'netscope.state.v1'

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

function defaultPacket(topology: Topology): PacketConfig {
  const routers = topology.nodes.filter((n) => n.kind === 'router')
  const endpoints = topology.nodes.filter((n) => n.kind !== 'router')
  const src = endpoints[0] ?? routers[0] ?? topology.nodes[0]
  const dst = [...endpoints].reverse()[0] ?? routers.at(-1) ?? topology.nodes.at(-1)
  return {
    algorithm: 'link-state',
    srcId: src?.id ?? '',
    dstId: dst && dst.id !== src?.id ? dst.id : routers.find((r) => r.id !== src?.id)?.id ?? '',
    packetBytes: 512,
    headerLength: 20,
    initialTtl: 64,
    dontFragment: false,
    count: 3,
    speed: 1,
  }
}

function pickValidPacket(topology: Topology, packet: PacketConfig): PacketConfig {
  const ok = (id: string) => topology.nodes.some((n) => n.id === id)
  return {
    ...packet,
    srcId: ok(packet.srcId) ? packet.srcId : topology.nodes[0]?.id ?? '',
    dstId: ok(packet.dstId) && packet.dstId !== packet.srcId ? packet.dstId : topology.nodes.find((n) => n.id !== (ok(packet.srcId) ? packet.srcId : ''))?.id ?? '',
  }
}

function initialState(): AppState {
  const topology = presetById(DEFAULT_TOPOLOGY_ID)
  return {
    topology,
    activeModule: 'studio',
    selectedNodeId: null,
    selectedLinkId: null,
    savedTopologies: [],
    packet: defaultPacket(topology),
  }
}

function loadPersisted(): AppState {
  const fallback = initialState()
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<AppState>
    const base = parsed.topology ? cloneTopology(parsed.topology) : fallback.topology
    return {
      topology: base,
      activeModule: parsed.activeModule ?? 'studio',
      selectedNodeId: null,
      selectedLinkId: null,
      savedTopologies: Array.isArray(parsed.savedTopologies) ? parsed.savedTopologies : [],
      packet: parsed.packet ? pickValidPacket(base, { ...fallback.packet, ...parsed.packet }) : defaultPacket(base),
    }
  } catch {
    return fallback
  }
}

function reducer(state: AppState, action: Action): AppState {
  const t = state.topology
  switch (action.type) {
    case 'loadPreset': {
      const topology = presetById(action.id)
      return { ...state, topology, selectedNodeId: null, selectedLinkId: null, packet: defaultPacket(topology) }
    }
    case 'newBlank': {
      const topology = blankTopology()
      return { ...state, topology, selectedNodeId: null, selectedLinkId: null, packet: defaultPacket(topology) }
    }
    case 'replaceTopology':
      return { ...state, topology: action.topology, selectedNodeId: null, selectedLinkId: null, packet: defaultPacket(action.topology) }
    case 'renameTopology':
      return { ...state, topology: { ...t, name: action.name } }
    case 'setModule':
      return { ...state, activeModule: action.module }
    case 'selectNode':
      return { ...state, selectedNodeId: action.id, selectedLinkId: null }
    case 'selectLink':
      return { ...state, selectedLinkId: action.id, selectedNodeId: null }
    case 'addNode':
      return { ...state, topology: { ...t, nodes: [...t.nodes, action.node] }, selectedNodeId: action.node.id }
    case 'updateNode':
      return {
        ...state,
        topology: { ...t, nodes: t.nodes.map((n) => (n.id === action.id ? { ...n, ...action.patch } : n)) },
      }
    case 'moveNode':
      return {
        ...state,
        topology: { ...t, nodes: t.nodes.map((n) => (n.id === action.id ? { ...n, x: action.x, y: action.y } : n)) },
      }
    case 'removeNode': {
      const nodes = t.nodes.filter((n) => n.id !== action.id).map((n) => (n.gateway === action.id ? { ...n, gateway: undefined } : n))
      const links = t.links.filter((l) => l.a !== action.id && l.b !== action.id)
      const topology: Topology = { ...t, nodes, links }
      return {
        ...state,
        topology,
        selectedNodeId: null,
        packet: pickValidPacket(topology, state.packet),
      }
    }
    case 'addLink':
      return { ...state, topology: { ...t, links: [...t.links, action.link] }, selectedLinkId: action.link.id }
    case 'updateLink':
      return { ...state, topology: { ...t, links: t.links.map((l) => (l.id === action.id ? { ...l, ...action.patch } : l)) } }
    case 'cycleLinkStatus': {
      const order: LinkStatus[] = ['active', 'congested', 'failed']
      return {
        ...state,
        topology: {
          ...t,
          links: t.links.map((l) => (l.id === action.id ? { ...l, status: order[(order.indexOf(l.status) + 1) % order.length]! } : l)),
        },
      }
    }
    case 'removeLink': {
      return {
        ...state,
        topology: { ...t, links: t.links.filter((l) => l.id !== action.id) },
        selectedLinkId: null,
      }
    }
    case 'setPacket':
      return { ...state, packet: { ...state.packet, ...action.patch } }
    case 'saveCurrent': {
      const entry: SavedTopology = { id: action.id, name: t.name, savedAt: new Date().toISOString(), json: topologyToJson(t) }
      const others = state.savedTopologies.filter((s) => s.id !== action.id)
      return { ...state, savedTopologies: [entry, ...others].slice(0, 24) }
    }
    case 'loadSaved': {
      const saved = state.savedTopologies.find((s) => s.id === action.id)
      if (!saved) return state
      const result = parseTopologyJson(saved.json)
      if (!result.ok || !result.value) return state
      const topology = result.value
      return { ...state, topology, selectedNodeId: null, selectedLinkId: null, packet: defaultPacket(topology) }
    }
    case 'deleteSaved':
      return { ...state, savedTopologies: state.savedTopologies.filter((s) => s.id !== action.id) }
    default:
      return state
  }
}

interface Store {
  state: AppState
  dispatch: Dispatch<Action>
}

const StoreContext = createContext<Store | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadPersisted)

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ topology: state.topology, activeModule: state.activeModule, savedTopologies: state.savedTopologies, packet: state.packet })
      )
    } catch {
      /* quota or private mode — persistence is best-effort */
    }
  }, [state.topology, state.activeModule, state.savedTopologies, state.packet])

  const value = useMemo(() => ({ state, dispatch }), [state])
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside AppProvider')
  return ctx
}
