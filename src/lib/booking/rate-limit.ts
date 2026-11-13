/** Small in-memory limiter for the public booking endpoints (per server instance). */
const hits = new Map<string, number[]>();

export function rateLimited(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v[v.length - 1] < now - windowMs) hits.delete(k);
  return recent.length > limit;
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}
