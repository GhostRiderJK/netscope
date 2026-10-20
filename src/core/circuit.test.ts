import { describe, expect, it } from 'vitest'
import {
  VC_VS_DATAGRAM,
  failCircuit,
  sendDatagramBurst,
  sendDataOnCircuit,
  setupVirtualCircuit,
  teardownCircuit,
} from './circuit'
import { chainFixture, chapterFixture } from './__fixtures'

describe('virtual-circuit setup', () => {
  const setup = setupVirtualCircuit(chainFixture(), 'link-state', 'R1', 'R4', 100)

  it('reserves one path and stores per-hop state', () => {
    expect(setup.ok).toBe(true)
    expect(setup.path).toEqual(['R1', 'R2', 'R3', 'R4'])
    expect(setup.cost).toBe(3)
    expect(setup.links).toEqual(['l-R1-R2', 'l-R2-R3', 'l-R3-R4'])
    expect(setup.entries).toHaveLength(3)
  })

  it('relabels the VCI at every switch', () => {
    expect(setup.entries[0]).toMatchObject({ incomingLink: null, incomingVci: 100, outgoingVci: 100, nextHop: 'R2' })
    expect(setup.entries[1]).toMatchObject({ incomingVci: 100, outgoingVci: 101, nextHop: 'R3' })
    expect(setup.entries[2]).toMatchObject({ incomingVci: 101, outgoingVci: 102, nextHop: 'R4' })
  })

  it('sends data by identifier swap only, with no destination lookup', () => {
    const lines = sendDataOnCircuit(setup, 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('VCI')
    expect(lines[0]).toMatch(/No destination lookup/i)
  })

  it('tears the call down', () => {
    expect(teardownCircuit(setup)).toHaveLength(2)
  })
})

describe('link failure against an established circuit', () => {
  const setup = setupVirtualCircuit(chainFixture(), 'link-state', 'R1', 'R4', 100)
  it('breaks when a link on the circuit dies', () => {
    const r = failCircuit(chainFixture(), setup, 'l-R2-R3')
    expect(r.interrupted).toBe(true)
    expect(r.atRouter).toBe('R2')
  })
  it('leaves an off-circuit failure harmless — switches never re-consult tables', () => {
    const r = failCircuit(chainFixture(), setup, 'l-R4-H1')
    expect(r.interrupted).toBe(false)
    expect(r.note).toMatch(/not part of this circuit/i)
  })
})

describe('datagram burst re-runs tables mid-flight', () => {
  it('forwards each packet from the current tables', () => {
    const burst = sendDatagramBurst({
      topology: chapterFixture(),
      algorithm: 'link-state',
      srcId: 'A',
      dstId: 'E',
      packets: 2,
      failLinkId: 'l-A-B',
      failAfterPacket: 1,
    })
    expect(burst.packets).toHaveLength(2)
    expect(burst.packets.every((p) => p.delivered)).toBe(true)
    expect(burst.packets[0].links).toContain('l-A-B')
    expect(burst.packets[1].links).not.toContain('l-A-B')
    expect(burst.arrivalOrder.sort()).toEqual([0, 1])
    expect(burst.disclaimer).toMatch(/simulated/i)
  })

  it('drops a packet whose recomputed route no longer reaches the destination', () => {
    const burst = sendDatagramBurst({
      topology: chainFixture(),
      algorithm: 'link-state',
      srcId: 'R1',
      dstId: 'R4',
      packets: 2,
      failLinkId: 'l-R2-R3',
      failAfterPacket: 1,
    })
    expect(burst.packets[0].delivered).toBe(true)
    expect(burst.packets[1].delivered).toBe(false)
  })
})

describe('virtual circuit vs datagram teaching table', () => {
  it('covers path choice, lookup, failure and ordering', () => {
    const aspects = VC_VS_DATAGRAM.map((r) => r.aspect)
    expect(aspects).toEqual(expect.arrayContaining(['Path chosen', 'Link or switch failure', 'Ordering']))
  })
})
