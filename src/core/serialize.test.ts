import { describe, expect, it } from 'vitest'
import {
  RUN_SCHEMA,
  TOPOLOGY_SCHEMA,
  parseTopologyJson,
  runToJson,
  topologyToJson,
} from './serialize'
import { bgpFixture, chapterFixture } from './__fixtures'

describe('topology JSON round-trip', () => {
  it('re-imports an exported topology unchanged', () => {
    const source = chapterFixture()
    const text = topologyToJson(source, '2026-01-01T00:00:00.000Z')
    expect(JSON.parse(text).schema).toBe(TOPOLOGY_SCHEMA)
    const parsed = parseTopologyJson(text)
    expect(parsed.ok).toBe(true)
    expect(parsed.warnings).toEqual([])
    expect(parsed.value!.nodes).toHaveLength(5)
    expect(parsed.value!.links).toHaveLength(7)
    expect(parsed.value!.links.map((l) => l.cost)).toEqual([2, 5, 2, 4, 1, 6, 3])
  })

  it('preserves BGP policies through export/import', () => {
    const parsed = parseTopologyJson(topologyToJson(bgpFixture()))
    expect(parsed.value!.policies).toEqual([
      { asNumber: 1, peerAs: 2, localPref: 200, reason: 'Contract with AS2.' },
    ])
  })
})

describe('run export', () => {
  it('wraps a run under the run schema', () => {
    const text = runToJson({ id: 'x' } as never, '2026-01-01T00:00:00.000Z')
    expect(JSON.parse(text).schema).toBe(RUN_SCHEMA)
  })
})

describe('defensive import', () => {
  it('rejects non-JSON and missing arrays', () => {
    expect(parseTopologyJson('not json').ok).toBe(false)
    expect(parseTopologyJson('{"nodes":[]}').error).toMatch(/links/i)
    expect(parseTopologyJson('{"links":[]}').error).toMatch(/nodes/i)
  })

  it('rejects a link that points at an unknown node', () => {
    const r = parseTopologyJson('{"nodes":[{"id":"A"}],"links":[{"id":"l1","a":"A","b":"B"}]}')
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/unknown node/i)
  })

  it('rejects duplicate ids, bad prefixes, bad costs and bad MTUs', () => {
    expect(parseTopologyJson('{"nodes":[{"id":"A"},{"id":"A"}],"links":[]}').error).toMatch(/Duplicate node/i)
    expect(parseTopologyJson('{"nodes":[{"id":"A","prefix":33}],"links":[]}').error).toMatch(/prefix/i)
    expect(
      parseTopologyJson('{"nodes":[{"id":"A"},{"id":"B"}],"links":[{"id":"l1","a":"A","b":"B","cost":0}]}').error
    ).toMatch(/cost/i)
    expect(
      parseTopologyJson('{"nodes":[{"id":"A"},{"id":"B"}],"links":[{"id":"l1","a":"A","b":"B","mtu":50}]}').error
    ).toMatch(/MTU/i)
  })

  it('clears an unknown gateway and warns instead of failing', () => {
    const r = parseTopologyJson(
      '{"nodes":[{"id":"H1","kind":"host","ip":"10.0.0.1","prefix":24,"gateway":"GHOST"}],"links":[]}'
    )
    expect(r.ok).toBe(true)
    expect(r.warnings).toHaveLength(1)
    expect(r.value!.nodes[0]!.gateway).toBeUndefined()
  })

  it('accepts from/to endpoint aliases and a foreign schema with a warning', () => {
    const r = parseTopologyJson(
      '{"schema":"other/2","nodes":[{"id":"A"},{"id":"B"}],"links":[{"id":"l1","from":"A","to":"B","cost":3,"mtu":1500}]}'
    )
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => /Schema/i.test(w))).toBe(true)
    expect(r.value!.links[0]).toMatchObject({ a: 'A', b: 'B', cost: 3 })
  })
})
