import { describe, expect, it } from 'vitest'
import { computeFragments, reassemble } from './fragmentation'

describe('The assignment fragmentation example', () => {
  // 4000 B datagram = 20 B header + 3980 B data, MTU 1500.
  const plan = computeFragments({ datagramBytes: 4000, headerLength: 20, mtu: 1500, dontFragment: false, identification: 0x1a2c })

  it('splits into the documented payloads', () => {
    expect(plan.ok).toBe(true)
    expect(plan.needsFragmentation).toBe(true)
    expect(plan.payloadBytes).toBe(3980)
    expect(plan.fragments.map((f) => f.payloadBytes)).toEqual([1480, 1480, 1020])
  })

  it('computes offsets in 8-byte units', () => {
    expect(plan.fragments.map((f) => f.offsetUnits)).toEqual([0, 185, 370])
    expect(plan.fragments.map((f) => f.offsetBytes)).toEqual([0, 1480, 2960])
  })

  it('sets the More Fragments flag on every fragment but the last', () => {
    expect(plan.fragments.map((f) => (f.moreFragments ? 1 : 0))).toEqual([1, 1, 0])
  })

  it('repeats the header and accounts for the overhead', () => {
    expect(plan.fragments.map((f) => f.totalLength)).toEqual([1500, 1500, 1040])
    expect(plan.bytesOnWire).toBe(4040)
    expect(plan.overheadBytes).toBe(40)
    plan.fragments.forEach((f) => expect(f.identification).toBe(0x1a2c))
  })

  it('reassembles to exactly the original payload', () => {
    expect(plan.reassembles).toBe(true)
    const back = reassemble(plan.fragments)
    expect(back.ok).toBe(true)
    expect(back.bytes).toBe(3980)
  })

  it('covers the byte ranges with no gap or overlap', () => {
    expect(plan.fragments.map((f) => f.range)).toEqual([
      [0, 1479],
      [1480, 2959],
      [2960, 3979],
    ])
  })
})

describe('Fragmentation boundary cases', () => {
  it('leaves a datagram that fits the MTU whole', () => {
    const plan = computeFragments({ datagramBytes: 1500, headerLength: 20, mtu: 1500, dontFragment: false, identification: 1 })
    expect(plan.needsFragmentation).toBe(false)
    expect(plan.fragments).toHaveLength(1)
    expect(plan.fragments[0]!.payloadBytes).toBe(1480)
    expect(plan.fragments[0]!.moreFragments).toBe(false)
  })

  it('splits one byte over the limit into two fragments', () => {
    const plan = computeFragments({ datagramBytes: 1501, headerLength: 20, mtu: 1500, dontFragment: false, identification: 1 })
    expect(plan.fragments.map((f) => f.payloadBytes)).toEqual([1480, 1])
    expect(plan.fragments.map((f) => f.offsetUnits)).toEqual([0, 185])
    expect(plan.fragments.map((f) => (f.moreFragments ? 1 : 0))).toEqual([1, 0])
  })

  it('drops a non-multiple-of-8 chunk down to a legal offset', () => {
    const plan = computeFragments({ datagramBytes: 1400, headerLength: 20, mtu: 576, dontFragment: false, identification: 7 })
    // 576 - 20 = 556 B, which is not a multiple of 8, so only 552 B of data rides each fragment.
    expect(plan.chunk).toBe(552)
    expect(plan.fragments.map((f) => f.payloadBytes)).toEqual([552, 552, 276])
    expect(plan.fragments.map((f) => f.offsetUnits)).toEqual([0, 69, 138])
    expect(plan.warnings.join(' ')).toMatch(/multiple of 8/)
    expect(reassemble(plan.fragments).bytes).toBe(1380)
  })

  it('drops the datagram when DF is set and fragmentation is required', () => {
    const plan = computeFragments({ datagramBytes: 4000, headerLength: 20, mtu: 1500, dontFragment: true, identification: 3 })
    expect(plan.dropped).toBe(true)
    expect(plan.fragments).toHaveLength(0)
    expect(plan.dropReason).toMatch(/Fragmentation Needed and DF Set/)
    expect(plan.dropReason).toMatch(/ICMP Destination Unreachable/)
  })

  it('never drops a datagram that fits, even with DF set', () => {
    const plan = computeFragments({ datagramBytes: 100, headerLength: 20, mtu: 1500, dontFragment: true, identification: 3 })
    expect(plan.dropped).toBe(false)
    expect(plan.needsFragmentation).toBe(false)
  })

  it('rejects an MTU too small to carry anything', () => {
    const plan = computeFragments({ datagramBytes: 4000, headerLength: 20, mtu: 24, dontFragment: false, identification: 1 })
    expect(plan.ok).toBe(false)
    expect(plan.error).toMatch(/too little to fragment/)
  })

  it('rejects impossible inputs', () => {
    expect(computeFragments({ datagramBytes: 10, headerLength: 20, mtu: 1500, dontFragment: false, identification: 1 }).ok).toBe(false)
    expect(computeFragments({ datagramBytes: 100, headerLength: 21, mtu: 1500, dontFragment: false, identification: 1 }).ok).toBe(false)
    expect(computeFragments({ datagramBytes: 100, headerLength: 20, mtu: 0, dontFragment: false, identification: 1 }).ok).toBe(false)
  })

  it('refuses to exceed the 13-bit offset field', () => {
    const plan = computeFragments({ datagramBytes: 70000, headerLength: 20, mtu: 1500, dontFragment: false, identification: 1 })
    expect(plan.ok).toBe(false)
    expect(plan.error).toMatch(/13-bit Fragment Offset/)
  })

  it('warns about MTUs below the IPv4 minimum reassembly size', () => {
    const plan = computeFragments({ datagramBytes: 400, headerLength: 20, mtu: 64, dontFragment: false, identification: 1 })
    expect(plan.warnings.join(' ')).toMatch(/68/)
  })
})
