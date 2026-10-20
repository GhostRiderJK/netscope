/** IPv4 fragmentation arithmetic (RFC 791 rules, as taught in Chapter 4). */

export interface FragmentInput {
  /** Total size of the original datagram including its header. */
  datagramBytes: number
  /** IPv4 header length in bytes (IHL x 4). */
  headerLength: number
  /** MTU of the outgoing link in bytes. */
  mtu: number
  dontFragment: boolean
  identification: number
}

export interface FragmentRow {
  index: number
  payloadBytes: number
  totalLength: number
  /** Byte offset of this fragment's data in the original payload. */
  offsetBytes: number
  /** Value written into the 13-bit Fragment Offset field (units of 8 bytes). */
  offsetUnits: number
  moreFragments: boolean
  identification: number
  /** Payload slice, as [firstByte, lastByte] indices into the original data. */
  range: [number, number]
}

export interface FragmentPlan {
  ok: boolean
  error?: string
  input: FragmentInput
  payloadBytes: number
  /** Largest data payload a non-final fragment can carry on this link. */
  chunk: number
  needsFragmentation: boolean
  dropped: boolean
  dropReason?: string
  fragments: FragmentRow[]
  /** Sum of fragment payloads equals the original payload. */
  reassembles: boolean
  bytesOnWire: number
  overheadBytes: number
  detail: string
  warnings: string[]
}

export const MIN_FRAGMENT_PAYLOAD = 8
export const MIN_REASSEMBLY_MTU = 68

export function computeFragments(input: FragmentInput): FragmentPlan {
  const base: FragmentPlan = {
    ok: false,
    input,
    payloadBytes: 0,
    chunk: 0,
    needsFragmentation: false,
    dropped: false,
    fragments: [],
    reassembles: false,
    bytesOnWire: 0,
    overheadBytes: 0,
    detail: '',
    warnings: [],
  }

  const headerLength = Math.round(input.headerLength)
  const datagramBytes = Math.round(input.datagramBytes)
  const mtu = Math.round(input.mtu)

  if (!Number.isInteger(headerLength) || headerLength < 20 || headerLength > 60 || headerLength % 4 !== 0) {
    return { ...base, error: 'The IPv4 header must be 20–60 bytes in multiples of 4 (IHL x 4).' }
  }
  if (!Number.isInteger(mtu) || mtu < 1) {
    return { ...base, error: 'MTU must be a positive integer number of bytes.' }
  }
  if (!Number.isInteger(datagramBytes) || datagramBytes < headerLength) {
    return { ...base, error: 'A datagram cannot be smaller than its own header.' }
  }

  const payload = datagramBytes - headerLength
  const rawChunk = mtu - headerLength
  const chunk = rawChunk - (rawChunk % 8)
  const warnings: string[] = []

  if (mtu < MIN_REASSEMBLY_MTU) {
    warnings.push(`MTU ${mtu} B is below the 68 B every IPv4 host must be able to reassemble (RFC 791). Real links use at least 68 B.`)
  }
  if (rawChunk > 0 && rawChunk % 8 !== 0) {
    warnings.push(`${rawChunk} B of payload would fit, but every fragment except the last must carry a multiple of 8 bytes, so only ${chunk} B is used per fragment.`)
  }

  if (chunk < MIN_FRAGMENT_PAYLOAD) {
    return {
      ...base,
      error: `With a ${headerLength} B header, a ${mtu} B MTU leaves only ${rawChunk} B for data — too little to fragment (each non-final fragment needs at least 8 B of data, aligned to 8).`,
      payloadBytes: payload,
      chunk: Math.max(rawChunk, 0),
    }
  }

  if (payload === 0) {
    return {
      ...base,
      ok: true,
      payloadBytes: 0,
      chunk,
      needsFragmentation: false,
      fragments: [row(0, 0, headerLength, 0, false, input)],
      reassembles: true,
      bytesOnWire: headerLength,
      overheadBytes: 0,
      detail: 'A header-only datagram: nothing to fragment.',
      warnings,
    }
  }

  if (payload <= chunk) {
    const only = row(0, payload, payload + headerLength, 0, false, input)
    return {
      ...base,
      ok: true,
      payloadBytes: payload,
      chunk,
      needsFragmentation: false,
      dropped: false,
      fragments: [only],
      reassembles: true,
      bytesOnWire: payload + headerLength,
      overheadBytes: 0,
      detail: `The ${payload} B payload fits the ${mtu} B MTU (${chunk} B of data per fragment), so the datagram crosses unfragmented. DF=${input.dontFragment ? 1 : 0} has no effect here.`,
      warnings,
    }
  }

  if (input.dontFragment) {
    return {
      ...base,
      ok: true,
      payloadBytes: payload,
      chunk,
      needsFragmentation: true,
      dropped: true,
      dropReason: `Payload ${payload} B exceeds the ${chunk} B that fits one fragment, and DF=1 forbids splitting it. The router discards the datagram and sends ICMP Destination Unreachable (Type 3, Code 4 — "Fragmentation Needed and DF Set") back to the source, quoting the ${mtu} B next-hop MTU. That is how Path MTU Discovery learns the link limit.`,
      fragments: [],
      reassembles: false,
      bytesOnWire: 0,
      overheadBytes: 0,
      detail: 'No forwarding happens: the datagram dies at the router that cannot fragment it.',
      warnings,
    }
  }

  const sizes: number[] = []
  let remaining = payload
  while (remaining > chunk) {
    sizes.push(chunk)
    remaining -= chunk
  }
  sizes.push(remaining)

  const fragments: FragmentRow[] = []
  let offsetBytes = 0
  for (let i = 0; i < sizes.length; i += 1) {
    const size = sizes[i]!
    const isLast = i === sizes.length - 1
    if (offsetBytes % 8 !== 0) {
      return { ...base, error: `Internal arithmetic error: offset ${offsetBytes} is not 8-byte aligned.` }
    }
    fragments.push(row(i, size, size + headerLength, offsetBytes, !isLast, input))
    offsetBytes += size
  }

  const maxOffsetUnits = 8191
  if (fragments.some((f) => f.offsetUnits > maxOffsetUnits)) {
    return {
      ...base,
      error: `The 13-bit Fragment Offset field counts 8-byte blocks, so it can only describe payload up to ${maxOffsetUnits} × 8 = ${maxOffsetUnits * 8} bytes. This datagram is too large to fragment — a real sender would drop it.`,
      payloadBytes: payload,
      chunk,
    }
  }

  const bytesOnWire = fragments.reduce((sum, f) => sum + f.totalLength, 0)
  return {
    ...base,
    ok: true,
    payloadBytes: payload,
    chunk,
    needsFragmentation: true,
    dropped: false,
    fragments,
    reassembles: fragments.reduce((sum, f) => sum + f.payloadBytes, 0) === payload,
    bytesOnWire,
    overheadBytes: bytesOnWire - datagramBytes,
    detail: `The ${payload} B payload is split into ${fragments.length} fragments of ${chunk} B (last one ${sizes.at(-1)} B). Each fragment repeats the ${headerLength} B header, so ${bytesOnWire} B cross the link instead of ${datagramBytes} B — ${bytesOnWire - datagramBytes} B of pure header overhead.`,
    warnings,
  }
}

function row(index: number, payloadBytes: number, totalLength: number, offsetBytes: number, moreFragments: boolean, input: FragmentInput): FragmentRow {
  return {
    index,
    payloadBytes,
    totalLength,
    offsetBytes,
    offsetUnits: offsetBytes / 8,
    moreFragments,
    identification: input.identification,
    range: [offsetBytes, offsetBytes + payloadBytes - 1],
  }
}

/** Rebuild the byte layout from a fragment list to prove nothing was lost. */
export function reassemble(fragments: FragmentRow[]): { ok: boolean; bytes: number; error?: string } {
  const sorted = [...fragments].sort((a, b) => a.offsetBytes - b.offsetBytes)
  let expected = 0
  for (const f of sorted) {
    if (f.offsetBytes !== expected) {
      return { ok: false, bytes: expected, error: `Gap or overlap: fragment ${f.index} starts at ${f.offsetBytes}, expected ${expected}.` }
    }
    expected += f.payloadBytes
  }
  return { ok: true, bytes: expected }
}
