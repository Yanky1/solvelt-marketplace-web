import { isIP } from "node:net";

/** An address as (version, numeric value), so comparison never depends on how it was spelled. */
export interface Ip { version: 4 | 6; value: bigint }

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255) return null;
    v = (v << 8n) | BigInt(p);
  }
  return v;
}

function parseV6(s: string): bigint | null {
  let head = s;
  let tail = 0n;
  let tailGroups = 0;
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".")) { // embedded IPv4 tail, e.g. ::ffff:1.2.3.4
    const v4 = parseV4(s.slice(lastColon + 1));
    if (v4 === null) return null;
    head = s.slice(0, lastColon + 1) + "0:0"; // placeholder for the two groups, replaced below
    tail = v4; tailGroups = 2;
  }
  const dbl = head.split("::");
  if (dbl.length > 2) return null;
  const groups = (x: string) => (x === "" ? [] : x.split(":"));
  const left = groups(dbl[0]!), right = dbl.length === 2 ? groups(dbl[1]!) : [];
  const total = left.length + right.length;
  if ((dbl.length === 1 && total !== 8) || (dbl.length === 2 && total > 7)) return null;
  const all = [...left, ...Array<string>(8 - total).fill("0"), ...right];
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    const g = all[i]!;
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  if (tailGroups) v = (v & ~0xffffffffn) | tail; // swap the placeholder for the real IPv4 tail
  return v;
}

/**
 * Parses one address as proxies actually write it: optional `[brackets]`, `:port` (IPv4 and bracketed IPv6),
 * `%zone` suffixes and IPv4-mapped IPv6 (`::ffff:1.2.3.4`, which becomes IPv4). Returns null for anything else.
 */
export function parseIp(raw: string): Ip | null {
  let s = raw.trim();
  if (!s || s.length > 64) return null;
  const bracket = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(s);
  if (bracket) s = bracket[1]!;
  else if (/^[^:]+:\d{1,5}$/.test(s) && s.includes(".")) s = s.slice(0, s.lastIndexOf(":")); // 1.2.3.4:5678
  const z = s.indexOf("%");
  if (z >= 0) {
    if (!/^[0-9A-Za-z._~-]{1,32}$/.test(s.slice(z + 1))) return null;
    s = s.slice(0, z);
    if (!s.includes(":")) return null; // a zone id only exists on IPv6 addresses
  }
  if (s.includes(":")) {
    if (isIP(s) !== 6) return null;
    const v = parseV6(s);
    if (v === null) return null;
    if (v >> 32n === 0xffffn) return { version: 4, value: v & 0xffffffffn }; // IPv4-mapped
    return { version: 6, value: v };
  }
  if (isIP(s) !== 4) return null;
  const v = parseV4(s);
  return v === null ? null : { version: 4, value: v };
}

/** Canonical text: dotted quad, or lower-case RFC 5952 compressed IPv6. */
export function formatIp(ip: Ip): string {
  if (ip.version === 4) return [24n, 16n, 8n, 0n].map((sh) => String((ip.value >> sh) & 255n)).join(".");
  const g = Array.from({ length: 8 }, (_, i) => Number((ip.value >> BigInt((7 - i) * 16)) & 0xffffn));
  let best = { at: -1, len: 0 };
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue; }
    let j = i; while (j < 8 && g[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j;
  }
  const h = (x: number) => x.toString(16);
  if (best.len < 2) return g.map(h).join(":");
  return `${g.slice(0, best.at).map(h).join(":")}::${g.slice(best.at + best.len).map(h).join(":")}`;
}

export interface TrustedProxy { ip: Ip; bits: number }

/** Strict: `ip` or `ip/bits` with plain decimal bits within range. Returns null when invalid. */
export function parseTrustedProxy(entry: string): TrustedProxy | null {
  const parts = entry.trim().split("/");
  if (parts.length > 2) return null;
  const addr = parts[0]!.trim();
  // Config entries are plain addresses: no brackets, zones or ports, and IPv4 only in dotted form (not ::ffff:a.b.c.d).
  if (/[[\]%]/.test(addr) || /^[^:]+:\d+$/.test(addr)) return null;
  const ip = parseIp(addr);
  if (!ip || (ip.version === 4 && addr.includes(":"))) return null;
  const max = ip.version === 4 ? 32 : 128;
  if (parts.length === 1) return { ip, bits: max };
  if (!/^(0|[1-9]\d{0,2})$/.test(parts[1]!)) return null;
  const bits = Number(parts[1]);
  if (bits > max) return null;
  return { ip, bits };
}

/** Throws a message naming the bad entries by position (not value) so config errors stay readable and safe. */
export function parseTrustedProxies(list: string[]): TrustedProxy[] {
  const out: TrustedProxy[] = [];
  const bad: number[] = [];
  list.forEach((e, i) => { const p = parseTrustedProxy(e); if (p) out.push(p); else bad.push(i + 1); });
  if (bad.length) throw new Error(`TRUSTED_PROXIES entr${bad.length > 1 ? "ies" : "y"} ${bad.join(", ")} ${bad.length > 1 ? "are" : "is"} not a valid IP address or CIDR (e.g. 10.0.0.5, 172.16.0.0/12, 2001:db8::/32)`);
  return out;
}

export function isTrusted(ip: Ip, trusted: TrustedProxy[]): boolean {
  return trusted.some((t) => {
    if (t.ip.version !== ip.version) return false;
    const width = t.ip.version === 4 ? 32 : 128;
    const shift = BigInt(width - t.bits);
    return (ip.value >> shift) === (t.ip.value >> shift);
  });
}

/**
 * The real client IP. The socket peer is authoritative; X-Forwarded-For is honoured only when the peer is one of
 * our own trusted proxies, walking the chain right to left past trusted hops. A hop that does not parse makes us
 * fall back to the peer rather than trust garbage. Returns null when there is no valid peer.
 */
export function resolveClientIp(socketAddress: string | undefined, forwardedFor: string | null, trustedEntries: string[] | TrustedProxy[]): string | null {
  const peer = socketAddress ? parseIp(socketAddress) : null;
  if (!peer) return null;
  const trusted = trustedEntries.map((e) => (typeof e === "string" ? parseTrustedProxy(e) : e)).filter((e): e is TrustedProxy => e !== null);
  if (!forwardedFor || !isTrusted(peer, trusted)) return formatIp(peer);
  const hops = forwardedFor.split(",").map((h) => h.trim()).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = parseIp(hops[i]!);
    if (!hop) return formatIp(peer);
    if (!isTrusted(hop, trusted)) return formatIp(hop);
  }
  return formatIp(peer);
}
