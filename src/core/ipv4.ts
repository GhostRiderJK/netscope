/** IPv4 addressing and CIDR maths. Pure functions, no UI dependency. */

export interface Ipv4Parse {
  ok: boolean
  octets: number[]
  /** 32-bit unsigned value. */
  value: number
  error?: string
}

export function parseIpv4(input: string): Ipv4Parse {
  const raw = input.trim()
  if (!raw) return { ok: false, octets: [0, 0, 0, 0], value: 0, error: 'Empty address.' }
  const parts = raw.split('.')
  if (parts.length !== 4) return { ok: false, octets: [0, 0, 0, 0], value: 0, error: 'An IPv4 address needs exactly four dotted octets.' }
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return { ok: false, octets: [0, 0, 0, 0], value: 0, error: `"${part}" is not a decimal octet (0–255, no leading symbols).` }
    }
    if (part.length > 1 && part.startsWith('0')) {
      return { ok: false, octets: [0, 0, 0, 0], value: 0, error: `"${part}" has a leading zero, which is ambiguous (octal in some stacks).` }
    }
    const n = Number(part)
    if (n > 255) return { ok: false, octets: [0, 0, 0, 0], value: 0, error: `Octet ${n} exceeds 255.` }
    octets.push(n)
  }
  return { ok: true, octets, value: octetsToNumber(octets) }
}

export function octetsToNumber(octets: number[]): number {
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0
}

export function numberToOctets(value: number): number[] {
  const v = value >>> 0
  return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]
}

export function numberToIpv4(value: number): string {
  return numberToOctets(value).join('.')
}

export function maskValue(prefix: number): number {
  if (prefix <= 0) return 0
  if (prefix >= 32) return 0xffffffff
  return (~0 << (32 - prefix)) >>> 0
}

export function toBinary32(value: number): string {
  return (value >>> 0).toString(2).padStart(32, '0')
}

/** Dotted binary, e.g. `11000000.10101000.00001010.10000010`. */
export function binaryOctets(value: number): string {
  return matchBytes(toBinary32(value)).join('.')
}

export function matchBytes(bits: string): string[] {
  return [0, 8, 16, 24].map((i) => bits.slice(i, i + 8))
}

export type SubnetSpecial = 'host-route' | 'point-to-point' | null

export interface SubnetInfo {
  ok: boolean
  error?: string
  address: string
  prefix: number
  mask: string
  maskBinary: string
  wildcard: string
  network: string
  broadcast: string
  firstUsable: string | null
  lastUsable: string | null
  /** Total addresses in the block, including network and broadcast. */
  total: number
  /** Addresses assignable to interfaces under ordinary rules. */
  usable: number
  networkBits: number
  hostBits: number
  /** Network part of the entered address, in bits. */
  networkPartBits: string
  hostPartBits: string
  special: SubnetSpecial
  note: string
}

export function describeSubnet(address: string, prefix: number): SubnetInfo {
  const parsed = parseIpv4(address)
  const base: SubnetInfo = {
    ok: false,
    address,
    prefix,
    mask: '',
    maskBinary: '',
    wildcard: '',
    network: '',
    broadcast: '',
    firstUsable: null,
    lastUsable: null,
    total: 0,
    usable: 0,
    networkBits: prefix,
    hostBits: 32 - prefix,
    networkPartBits: '',
    hostPartBits: '',
    special: null,
    note: '',
  }
  if (!parsed.ok) return { ...base, error: parsed.error }
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return { ...base, error: 'Prefix length must be an integer from 0 to 32.' }
  }

  const mask = maskValue(prefix)
  const wildcard = (~mask) >>> 0
  const network = (parsed.value & mask) >>> 0
  const broadcast = (network | wildcard) >>> 0
  const total = 2 ** (32 - prefix)
  const bits = toBinary32(parsed.value)

  let special: SubnetSpecial = null
  let usable: number
  let firstUsable: number | null
  let lastUsable: number | null
  let note: string

  if (prefix === 32) {
    special = 'host-route'
    usable = 1
    firstUsable = network
    lastUsable = network
    note = 'A /32 is a single host route. There is no subnet of its own: the address is both the network and the host.'
  } else if (prefix === 31) {
    special = 'point-to-point'
    usable = 2
    firstUsable = network
    lastUsable = broadcast
    note = 'RFC 3021: a /31 is used for point-to-point links. Both addresses are usable and there is no reserved network or broadcast address.'
  } else {
    usable = total - 2
    firstUsable = network + 1
    lastUsable = broadcast - 1
    note =
      prefix === 0
        ? 'A /0 covers the whole IPv4 space — used as a default route, never as a real subnet.'
        : 'Ordinary subnetting: the all-zeros host part is the network address and the all-ones host part is the broadcast address, so 2 of the block are not host addresses.'
  }

  return {
    ok: true,
    address: parsed.ok ? numberToIpv4(parsed.value) : address,
    prefix,
    mask: numberToIpv4(mask),
    maskBinary: toBinary32(mask),
    wildcard: numberToIpv4(wildcard),
    network: numberToIpv4(network),
    broadcast: numberToIpv4(broadcast),
    firstUsable: firstUsable === null ? null : numberToIpv4(firstUsable),
    lastUsable: lastUsable === null ? null : numberToIpv4(lastUsable),
    total,
    usable,
    networkBits: prefix,
    hostBits: 32 - prefix,
    networkPartBits: bits.slice(0, prefix),
    hostPartBits: bits.slice(prefix),
    special,
    note,
  }
}

export function sameSubnet(a: string, b: string, prefix: number): { ok: boolean; error?: string; networkA?: string; networkB?: string; shared?: boolean } {
  const pa = parseIpv4(a)
  const pb = parseIpv4(b)
  if (!pa.ok) return { ok: false, error: `First address: ${pa.error}` }
  if (!pb.ok) return { ok: false, error: `Second address: ${pb.error}` }
  const mask = maskValue(prefix)
  const na = (pa.value & mask) >>> 0
  const nb = (pb.value & mask) >>> 0
  return { ok: true, networkA: numberToIpv4(na), networkB: numberToIpv4(nb), shared: na === nb }
}

/**
 * The host's own forwarding decision: same prefix → send directly with ARP,
 * different prefix → hand to the default gateway.
 */
export function deliveryDecision(
  srcIp: string,
  srcPrefix: number,
  dstIp: string,
  gatewayIp?: string
): { ok: boolean; error?: string; mode: 'direct' | 'gateway' | 'invalid-gateway' | 'none'; network: string; reason: string } {
  const ps = parseIpv4(srcIp)
  const pd = parseIpv4(dstIp)
  if (!ps.ok) return { ok: false, mode: 'none', network: '', reason: ps.error ?? 'Bad source address' }
  if (!pd.ok) return { ok: false, mode: 'none', network: '', reason: pd.error ?? 'Bad destination address' }
  const mask = maskValue(srcPrefix)
  const network = numberToIpv4((ps.value & mask) >>> 0)
  const dstNetwork = numberToIpv4((pd.value & mask) >>> 0)
  if (network === dstNetwork) {
    return {
      ok: true,
      mode: 'direct',
      network,
      reason: `${dstIp} resolves to network ${network}/${srcPrefix}, the sender's own subnet. The host ARPs for the destination's MAC and delivers directly — no router is consulted.`,
    }
  }
  if (!gatewayIp) {
    return { ok: true, mode: 'none', network, reason: `${dstIp} is outside ${network}/${srcPrefix} and no default gateway is configured, so the host has nowhere to send the packet.` }
  }
  const pg = parseIpv4(gatewayIp)
  if (!pg.ok) return { ok: false, mode: 'invalid-gateway', network, reason: pg.error ?? 'Bad gateway address' }
  if (((pg.value & mask) >>> 0) !== ((ps.value & mask) >>> 0)) {
    return {
      ok: true,
      mode: 'invalid-gateway',
      network,
      reason: `The gateway ${gatewayIp} is not inside ${network}/${srcPrefix}, so the host cannot even reach it. This is exactly the "bad subnet configuration" class of misconfiguration.`,
    }
  }
  return {
    ok: true,
    mode: 'gateway',
    network,
    reason: `${dstIp} is in ${dstNetwork}, outside the sender's subnet ${network}/${srcPrefix}. The host forwards to its default gateway ${gatewayIp} and lets the routers do the long-distance work.`,
  }
}

/** True when either CIDR block contains the other, i.e. they overlap. */
export function cidrOverlap(a: string, aPrefix: number, b: string, bPrefix: number): { ok: boolean; error?: string; overlaps: boolean; detail: string } {
  const sa = describeSubnet(a, aPrefix)
  const sb = describeSubnet(b, bPrefix)
  if (!sa.ok) return { ok: false, overlaps: false, detail: sa.error ?? '' }
  if (!sb.ok) return { ok: false, overlaps: false, detail: sb.error ?? '' }
  const shorter = Math.min(aPrefix, bPrefix)
  const netA = describeSubnet(sa.network, shorter).network
  const netB = describeSubnet(sb.network, shorter).network
  const overlaps = netA === netB
  return {
    ok: true,
    overlaps,
    detail: overlaps
      ? `${sa.network}/${aPrefix} and ${sb.network}/${sb.prefix} both fall inside ${netA}/${shorter}, so they overlap. A router cannot keep them as distinct prefixes, and two hosts on them would collide.`
      : `${sa.network}/${aPrefix} and ${sb.network}/${sb.prefix} are disjoint: they agree on nothing above bit ${shorter}, so they can be summarised but never conflated.`,
  }
}

/** Smallest single CIDR block covering both networks (aggregation / supernet). */
export function aggregate(a: string, aPrefix: number, b: string, bPrefix: number): { ok: boolean; error?: string; block?: string; detail: string } {
  const sa = describeSubnet(a, aPrefix)
  const sb = describeSubnet(b, bPrefix)
  if (!sa.ok) return { ok: false, detail: sa.error ?? '' }
  if (!sb.ok) return { ok: false, detail: sb.error ?? '' }
  const na = parseIpv4(sa.network).value
  const nb = parseIpv4(sb.network).value
  const xor = (na ^ nb) >>> 0

  if (xor === 0) {
    const prefix = Math.min(aPrefix, bPrefix)
    return {
      ok: true,
      block: `${sa.network}/${prefix}`,
      detail: `Both inputs share the network address ${sa.network}, so one is inside the other and the aggregate stays /${prefix}.`,
    }
  }

  let firstDiffering = 0
  for (let i = 0; i < 32; i += 1) {
    if ((xor >>> (31 - i)) & 1) {
      firstDiffering = i
      break
    }
  }
  const prefix = firstDiffering
  const mask = maskValue(prefix)
  const block = numberToIpv4((na & mask) >>> 0)
  return {
    ok: true,
    block: `${block}/${prefix}`,
    detail: `The two network addresses first differ at bit ${firstDiffering + 1}, so the tightest block containing both is ${block}/${prefix} — ${2 ** (32 - prefix)} addresses, one summary route where a router previously carried two.`,
  }
}

export const PRIVATE_BLOCKS: { block: string; range: string; use: string }[] = [
  { block: '10.0.0.0/8', range: '10.0.0.0 – 10.255.255.255', use: 'Large private networks (RFC 1918).' },
  { block: '172.16.0.0/12', range: '172.16.0.0 – 172.31.255.255', use: 'Carrier / campus private space.' },
  { block: '192.168.0.0/16', range: '192.168.0.0 – 192.168.255.255', use: 'Home and small-office networks.' },
  { block: '169.254.0.0/16', range: '169.254.0.0 – 169.254.255.255', use: 'Link-local (APIPA) — not routable.' },
  { block: '127.0.0.0/8', range: '127.0.0.0 – 127.255.255.255', use: 'Loopback.' },
]

export function addressClassOf(ip: string): string {
  const parsed = parseIpv4(ip)
  if (!parsed.ok) return 'invalid'
  const first = parsed.octets[0]!
  if (first < 128) return 'A (historical classful view only — CIDR replaced this in 1993)'
  if (first < 192) return 'B (historical classful view only — CIDR replaced this in 1993)'
  if (first < 224) return 'C (historical classful view only)'
  if (first < 240) return 'D — multicast'
  return 'E — reserved'
}
