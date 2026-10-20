/** IPv6 address and base-header maths. */

export interface Ipv6Parse {
  ok: boolean
  /** Eight 16-bit groups. */
  groups: number[]
  error?: string
}

const EMPTY = [0, 0, 0, 0, 0, 0, 0, 0]

export function parseIpv6(input: string): Ipv6Parse {
  const raw = input.trim().toLowerCase()
  if (!raw) return { ok: false, groups: [...EMPTY], error: 'Empty address.' }
  if (raw.includes('%')) {
    return { ok: false, groups: [...EMPTY], error: 'Zone/scope IDs (fe80::1%eth0) are a link concern, not part of the address.' }
  }
  if (!/^[0-9a-f:.]+$/.test(raw)) {
    return { ok: false, groups: [...EMPTY], error: 'Only hex digits, colons and (for an embedded IPv4 tail) dots are allowed.' }
  }

  const doubleCount = raw.split('::').length - 1
  if (doubleCount > 1) return { ok: false, groups: [...EMPTY], error: 'More than one "::" — a compressed address may only use it once.' }
  if (raw.startsWith(':::')) return { ok: false, groups: [...EMPTY], error: 'Malformed ":::".' }

  const tailIsIpv4 = /\./.test(raw)
  if (tailIsIpv4 && !/\.[0-9a-f.]*$/.test(raw.split(':').filter(Boolean).at(-1) ?? '')) {
    return { ok: false, groups: [...EMPTY], error: 'An embedded IPv4 part must be the last thing in the address.' }
  }

  const push = (tokens: string[], into: number[]): string | null => {
    for (const token of tokens) {
      if (/^\d+\./.test(token)) {
        const parts = token.split('.')
        if (parts.length !== 4) return `Embedded IPv4 part "${token}" needs four octets.`
        const octets: number[] = []
        for (const p of parts) {
          if (!/^\d{1,3}$/.test(p)) return `Embedded IPv4 octet "${p}" is invalid.`
          const n = Number(p)
          if (n > 255) return `Embedded IPv4 octet ${n} exceeds 255.`
          octets.push(n)
        }
        into.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(token)) return `"${token}" is not 1–4 hex digits.`
      into.push(Number.parseInt(token, 16))
    }
    return null
  }

  let groups: number[]
  if (raw.includes('::')) {
    const [left = '', right = ''] = raw.split('::')
    const leftTokens = left ? left.split(':') : []
    const rightTokens = right ? right.split(':') : []
    if (leftTokens.includes('') || rightTokens.includes('')) {
      return { ok: false, groups: [...EMPTY], error: 'Stray colon next to "::".' }
    }
    const head: number[] = []
    const tail: number[] = []
    const errHead = push(leftTokens, head)
    if (errHead) return { ok: false, groups: [...EMPTY], error: errHead }
    const errTail = push(rightTokens, tail)
    if (errTail) return { ok: false, groups: [...EMPTY], error: errTail }
    const missing = 8 - head.length - tail.length
    if (missing < 1) {
      return { ok: false, groups: [...EMPTY], error: `"::" would have to stand for ${missing} group(s); it may only replace one or more all-zero groups.` }
    }
    groups = [...head, ...Array(missing).fill(0), ...tail]
  } else {
    const tokens = raw.split(':')
    if (tokens.length !== 8 && !tailIsIpv4) {
      return { ok: false, groups: [...EMPTY], error: `${tokens.length} group(s) without "::" compression — an uncompressed IPv6 address needs exactly eight.` }
    }
    groups = []
    const err = push(tokens, groups)
    if (err) return { ok: false, groups: [...EMPTY], error: err }
    if (groups.length !== 8) {
      return { ok: false, groups: [...EMPTY], error: `Expected eight 16-bit groups, got ${groups.length}.` }
    }
  }

  return { ok: true, groups }
}

export function groupsToHex(groups: number[]): string[] {
  return groups.map((g) => (g & 0xffff).toString(16).padStart(4, '0'))
}

/** Full uncompressed form: eight four-digit lowercase groups. */
export function expandIpv6(input: string): string {
  const parsed = parseIpv6(input)
  if (!parsed.ok) return ''
  return groupsToHex(parsed.groups).join(':')
}

/** RFC 5952 canonical compression: longest leftmost run of ≥2 zero groups. */
export function compressIpv6(input: string): string {
  const parsed = parseIpv6(input)
  if (!parsed.ok) return ''
  const g = parsed.groups
  let bestStart = -1
  let bestLen = 0
  let runStart = -1
  for (let i = 0; i <= g.length; i += 1) {
    if (i < g.length && g[i] === 0) {
      if (runStart === -1) runStart = i
    } else if (runStart !== -1) {
      const len = i - runStart
      if (len > bestLen) {
        bestLen = len
        bestStart = runStart
      }
      runStart = -1
    }
  }
  if (bestLen < 2) return groupsToHex(g).map((h) => h.replace(/^0+(?=.)/, '')).join(':')
  const head = g.slice(0, bestStart).map(shortHex)
  const tail = g.slice(bestStart + bestLen).map(shortHex)
  if (head.length === 0 && tail.length === 0) return '::'
  if (head.length === 0) return `::${tail.join(':')}`
  if (tail.length === 0) return `${head.join(':')}::`
  return `${head.join(':')}::${tail.join(':')}`
}

function shortHex(group: number): string {
  const hex = (group & 0xffff).toString(16)
  return hex === '' ? '0' : hex
}

export function ipv6Binary(input: string): string {
  const parsed = parseIpv6(input)
  if (!parsed.ok) return ''
  return parsed.groups.map((g) => (g & 0xffff).toString(2).padStart(16, '0')).join('')
}

export function ipv6Nibbles(input: string): string[] {
  const binary = ipv6Binary(input)
  const out: string[] = []
  for (let i = 0; i < 128; i += 4) out.push(binary.slice(i, i + 4))
  return out
}

/** Hex digit for each of the 32 nibbles, for the 128-bit visualiser. */
export function ipv6HexDigits(input: string): string[] {
  const expanded = expandIpv6(input)
  return expanded.replace(/:/g, '').split('')
}

export function sameIpv6Prefix(a: string, b: string, prefix: number): { ok: boolean; error?: string; shared?: boolean; networkA?: string; networkB?: string } {
  const pa = parseIpv6(a)
  const pb = parseIpv6(b)
  if (!pa.ok) return { ok: false, error: pa.error }
  if (!pb.ok) return { ok: false, error: pb.error }
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return { ok: false, error: 'IPv6 prefix length must be 0–128.' }
  const bitsA = ipv6Binary(a)
  const bitsB = ipv6Binary(b)
  const shared = bitsA.slice(0, prefix) === bitsB.slice(0, prefix)
  const networkOf = (bits: string) => {
    const padded = bits.slice(0, prefix).padEnd(128, '0')
    const groups: number[] = []
    for (let i = 0; i < 128; i += 16) groups.push(Number.parseInt(padded.slice(i, i + 16), 2))
    return compressIpv6(groupsToHex(groups).join(':'))
  }
  return { ok: true, shared, networkA: networkOf(bitsA), networkB: networkOf(bitsB) }
}

export function interfaceIdFromMac(mac: string): { ok: boolean; value?: string; error?: string } {
  const parts = mac.split(':')
  if (parts.length !== 6 || !parts.every((p) => /^[0-9a-f]{2}$/.test(p))) {
    return { ok: false, error: 'Enter a MAC as six hex pairs, e.g. 02:42:ac:11:00:02.' }
  }
  const groups = [0, 2, 4].map((i) => (Number.parseInt(parts[i]!, 16) << 8) | Number.parseInt(parts[i + 1]!, 16))
  const first = groups[0]! ^ 0x0200 // invert the universal/local bit
  const iid = [first, groups[1], 0xfffe, groups[2]]
  return { ok: true, value: groupsToHex(iid).join(':') }
}

export interface HeaderField {
  name: string
  bits: number
  bytes: number
  value: string
  note: string
}

export interface Ipv6HeaderInput {
  trafficClass: number
  flowLabel: number
  payloadLength: number
  nextHeader: number
  hopLimit: number
}

export const NEXT_HEADER_NUMBERS: Record<number, string> = {
  0: 'Hop-by-Hop Options',
  4: 'IPv4 (encapsulated)',
  6: 'TCP',
  17: 'UDP',
  41: 'IPv6 (encapsulated)',
  43: 'Routing',
  44: 'Fragment',
  50: 'ESP',
  51: 'AH',
  58: 'ICMPv6',
  59: 'No Next Header',
  60: 'Destination Options',
}

export function describeIpv6Header(input: Ipv6HeaderInput): { ok: boolean; error?: string; fields: HeaderField[]; totalBytes: number } {
  const checks: [keyof Ipv6HeaderInput, number, string][] = [
    ['trafficClass', 8, 'Traffic Class'],
    ['flowLabel', 20, 'Flow Label'],
    ['payloadLength', 16, 'Payload Length'],
    ['nextHeader', 8, 'Next Header'],
    ['hopLimit', 8, 'Hop Limit'],
  ]
  for (const [key, bits, name] of checks) {
    const v = input[key]
    if (!Number.isInteger(v) || v < 0 || v >= 2 ** bits) {
      return { ok: false, error: `${name} must be an integer from 0 to ${2 ** bits - 1} (${bits} bits).`, fields: [], totalBytes: 0 }
    }
  }
  const nh = NEXT_HEADER_NUMBERS[input.nextHeader] ?? `unassigned (${input.nextHeader})`
  return {
    ok: true,
    fields: [
      { name: 'Version', bits: 4, bytes: 0.5, value: `6 (0110)`, note: 'Fixed at 6. Together with Traffic Class and Flow Label it fills the first 32-bit word.' },
      { name: 'Traffic Class', bits: 8, bytes: 1, value: `${input.trafficClass} (0x${input.trafficClass.toString(16)})`, note: 'DSCP/ECN markings, exactly like the IPv4 ToS field it descends from.' },
      { name: 'Flow Label', bits: 20, bytes: 2.5, value: `${input.flowLabel} (0x${input.flowLabel.toString(16)})`, note: 'Labels a sequence of packets a router should treat the same way — no per-packet reclassification.' },
      { name: 'Payload Length', bits: 16, bytes: 2, value: `${input.payloadLength} bytes`, note: 'Bytes after the base header, including extension headers. Unlike IPv4 it never counts the header itself.' },
      { name: 'Next Header', bits: 8, bytes: 1, value: `${input.nextHeader} — ${nh}`, note: 'Points at the upper protocol or the first extension header. IPv4 has no equivalent chaining mechanism.' },
      { name: 'Hop Limit', bits: 8, bytes: 1, value: `${input.hopLimit}`, note: 'The TTL of IPv6: decremented by every forwarding router, packet discarded at 0. It is not a timer, so 64 hops is not 64 seconds.' },
    ],
    totalBytes: 40,
  }
}

export const IPV6_ADDRESS_TYPES: { name: string; prefix: string; scope: string; note: string }[] = [
  { name: 'Global unicast', prefix: '2000::/3', scope: 'Internet', note: 'Routable everywhere, the IPv6 equivalent of public IPv4.' },
  { name: 'Unique local', prefix: 'fc00::/7', scope: 'Local site', note: 'Private addressing, roughly the 10/8 analogue.' },
  { name: 'Link-local', prefix: 'fe80::/10', scope: 'One link', note: 'Autoconfigured on every interface; required for neighbour discovery. Routers never forward these.' },
  { name: 'Loopback', prefix: '::1/128', scope: 'This node', note: 'Same job as 127.0.0.1.' },
  { name: 'Unspecified', prefix: '::/128', scope: 'None', note: 'Used as a placeholder while a device has no address yet.' },
  { name: 'Multicast', prefix: 'ff00::/8', scope: 'Varies with the scope field', note: 'Replaces IPv4 broadcast entirely — there is no broadcast address in IPv6.' },
]

export const IPV4_VS_IPV6: { aspect: string; v4: string; v6: string }[] = [
  { aspect: 'Address size', v4: '32 bits, ~4.3 billion addresses', v6: '128 bits, 3.4 × 10^38 addresses' },
  { aspect: 'Notation', v4: 'Dotted decimal', v6: 'Colon-hex with :: compression' },
  { aspect: 'Header', v4: '20–60 bytes, variable, with options and a header checksum', v6: 'Fixed 40 bytes, no options field, no header checksum' },
  { aspect: 'Fragmentation', v4: 'Any router along the path may fragment; reassembly at the destination', v6: 'Routers never fragment. The source fragments using a Fragment extension header, guided by ICMPv6 "Packet Too Big".' },
  { aspect: 'Broadcast', v4: 'Broadcast addresses exist and cause avoidable traffic', v6: 'No broadcast; multicast plus neighbour discovery instead' },
  { aspect: 'Checksum', v4: 'Header checksum recomputed at every hop', v6: 'None — link and transport layers already cover it, which makes forwarding cheaper' },
  { aspect: 'Security', v4: 'IPsec optional add-on', v6: 'IPsec defined in the base specification but NOT automatic: an IPv6 packet is no more encrypted or authenticated than an IPv4 one unless a security extension header says so' },
  { aspect: 'TTL semantics', v4: 'TTL, decremented per hop, ICMP Time Exceeded on 0', v6: 'Hop Limit, same rules, ICMPv6 Time Exceeded' },
]
