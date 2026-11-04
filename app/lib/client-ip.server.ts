import { isIP } from "node:net";

function v4ToInt(ip: string): number | null {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0]! << 24) | (p[1]! << 16) | (p[2]! << 8) | p[3]!) >>> 0;
}

const normalize = (ip: string) => ip.trim().replace(/^::ffff:/i, "").toLowerCase();

export function isTrusted(ip: string, trusted: string[]): boolean {
  const addr = normalize(ip);
  return trusted.some((entry) => {
    const [base, bits] = normalize(entry).split("/");
    if (!bits) return base === addr;
    const a = v4ToInt(addr), b = v4ToInt(base ?? ""), n = Number(bits);
    if (a === null || b === null || !Number.isInteger(n) || n < 0 || n > 32) return false;
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

/**
 * The real client IP. The socket peer is authoritative; X-Forwarded-For is honoured only when the
 * peer is one of our own trusted proxies, walking the chain right to left past trusted hops.
 * Anything that is not a valid IP is ignored. Returns null when nothing trustworthy is known.
 */
export function resolveClientIp(socketAddress: string | undefined, forwardedFor: string | null, trusted: string[]): string | null {
  const peer = socketAddress ? normalize(socketAddress) : "";
  if (!isIP(peer)) return null;
  if (!isTrusted(peer, trusted) || !forwardedFor) return peer;
  const hops = forwardedFor.split(",").map(normalize).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i]!;
    if (!isIP(hop)) return peer; // malformed chain: fall back to the peer rather than trust garbage
    if (!isTrusted(hop, trusted)) return hop;
  }
  return peer;
}
