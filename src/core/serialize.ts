import type { NetLink, NetNode, Topology } from './types'
import type { SimRun } from './types'

/**
 * JSON import/export for topologies and experiment runs. Import is defensive:
 * a hand-edited or foreign file must never produce a half-valid topology.
 */

export const TOPOLOGY_SCHEMA = 'netscope.topology/1'
export const RUN_SCHEMA = 'netscope.run/1'

export interface TopologyFile {
  schema: string
  exportedAt: string
  topology: Topology
}

export interface RunFile {
  schema: string
  exportedAt: string
  run: SimRun
}

export function topologyToJson(topology: Topology, at = new Date().toISOString()): string {
  const file: TopologyFile = { schema: TOPOLOGY_SCHEMA, exportedAt: at, topology }
  return JSON.stringify(file, null, 2)
}

export function runToJson(run: SimRun, at = new Date().toISOString()): string {
  const file: RunFile = { schema: RUN_SCHEMA, exportedAt: at, run }
  return JSON.stringify(file, null, 2)
}

export interface ParseResult<T> {
  ok: boolean
  value?: T
  error?: string
  warnings: string[]
}

export function parseTopologyJson(text: string): ParseResult<Topology> {
  const warnings: string[] = []
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: `Not valid JSON: ${(error as Error).message}`, warnings }
  }
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'The file does not contain an object.', warnings }

  const record = data as Record<string, unknown>
  const schema = record.schema ?? record.topology
  if (typeof schema === 'string' && schema !== TOPOLOGY_SCHEMA) {
    warnings.push(`Schema "${schema}" is not ${TOPOLOGY_SCHEMA}; importing anyway after validation.`)
  }
  const body = (record.topology && typeof record.topology === 'object' ? record.topology : record) as Record<string, unknown>
  const rawNodes = body.nodes
  const rawLinks = body.links
  if (!Array.isArray(rawNodes)) return { ok: false, error: 'Missing "nodes" array.', warnings }
  if (!Array.isArray(rawLinks)) return { ok: false, error: 'Missing "links" array.', warnings }

  const nodes: NetNode[] = []
  const seenNodes = new Set<string>()
  for (const [i, raw] of rawNodes.entries()) {
    const parsed = parseNode(raw, i)
    if ('error' in parsed) return { ok: false, error: parsed.error, warnings }
    if (seenNodes.has(parsed.node.id)) return { ok: false, error: `Duplicate node id "${parsed.node.id}".`, warnings }
    seenNodes.add(parsed.node.id)
    nodes.push(parsed.node)
  }

  const links: NetLink[] = []
  const seenLinks = new Set<string>()
  for (const [i, raw] of rawLinks.entries()) {
    const parsed = parseLink(raw, i)
    if ('error' in parsed) return { ok: false, error: parsed.error, warnings }
    if (seenLinks.has(parsed.link.id)) return { ok: false, error: `Duplicate link id "${parsed.link.id}".`, warnings }
    if (!seenNodes.has(parsed.link.a) || !seenNodes.has(parsed.link.b)) {
      return { ok: false, error: `Link "${parsed.link.id}" connects unknown node(s) ${parsed.link.a}/${parsed.link.b}.`, warnings }
    }
    seenLinks.add(parsed.link.id)
    links.push(parsed.link)
  }

  for (const node of nodes) {
    if (node.gateway && !seenNodes.has(node.gateway)) {
      warnings.push(`${node.label} references gateway "${node.gateway}", which does not exist. It was cleared.`)
      node.gateway = undefined
    }
  }

  const rawPolicies = Array.isArray(body.policies) ? body.policies : []
  const policies = rawPolicies.flatMap((p) => {
    const o = p as Record<string, unknown>
    if (typeof o.asNumber !== 'number' || typeof o.peerAs !== 'number' || typeof o.localPref !== 'number') return []
    return [{ asNumber: o.asNumber, peerAs: o.peerAs, localPref: o.localPref, reason: typeof o.reason === 'string' ? o.reason : undefined }]
  })

  return {
    ok: true,
    warnings,
    value: {
      id: typeof body.id === 'string' ? body.id : 'imported',
      name: typeof body.name === 'string' ? body.name : 'Imported topology',
      summary: typeof body.summary === 'string' ? body.summary : 'Imported from a JSON file.',
      nodes,
      links,
      policies,
    },
  }
}

type NodeParse = { node: NetNode } | { error: string }

function parseNode(raw: unknown, index: number): NodeParse {
  const o = raw as Record<string, unknown>
  if (!o || typeof o !== 'object') return { error: `Node #${index + 1} is not an object.` }
  const id = typeof o.id === 'string' && o.id ? o.id : null
  if (!id) return { error: `Node #${index + 1} has no id.` }
  const kind = o.kind === 'router' || o.kind === 'host' || o.kind === 'server' ? o.kind : 'host'
  const x = numberOr(o.x, 200 + index * 60)
  const y = numberOr(o.y, 240)
  const prefix = o.prefix === undefined ? undefined : numberOr(o.prefix, 24)
  if (prefix !== undefined && (prefix < 0 || prefix > 32 || !Number.isInteger(prefix))) {
    return { error: `Node "${id}" has prefix /${prefix}, which is not 0–32.` }
  }
  return {
    node: {
      id,
      label: typeof o.label === 'string' && o.label ? o.label : id,
      kind,
      x,
      y,
      ip: typeof o.ip === 'string' && o.ip ? o.ip : undefined,
      prefix,
      gateway: typeof o.gateway === 'string' && o.gateway ? o.gateway : undefined,
      asNumber: o.asNumber === undefined ? undefined : numberOr(o.asNumber, 0),
      silent: o.silent === true,
      note: typeof o.note === 'string' ? o.note : undefined,
    },
  }
}

type LinkParse = { link: NetLink } | { error: string }

function parseLink(raw: unknown, index: number): LinkParse {
  const o = raw as Record<string, unknown>
  if (!o || typeof o !== 'object') return { error: `Link #${index + 1} is not an object.` }
  const id = typeof o.id === 'string' && o.id ? o.id : `l-${index + 1}`
  const a = typeof o.a === 'string' ? o.a : typeof o.from === 'string' ? o.from : null
  const b = typeof o.b === 'string' ? o.b : typeof o.to === 'string' ? o.to : null
  if (!a || !b) return { error: `Link "${id}" is missing its endpoints.` }
  const cost = numberOr(o.cost, 1)
  if (!Number.isInteger(cost) || cost < 1) return { error: `Link "${id}" cost ${cost} must be an integer ≥ 1.` }
  const mtu = numberOr(o.mtu, 1500)
  if (mtu < 68 || mtu > 65535) return { error: `Link "${id}" MTU ${mtu} must be between 68 and 65535 bytes.` }
  const status = o.status === 'failed' || o.status === 'congested' || o.status === 'active' ? o.status : 'active'
  return { link: { id, a, b, cost, mtu, status } }
}

function numberOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}
