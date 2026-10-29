/**
 * 아주 단순한 메모리 기반 요청 제한.
 *
 * 한계: 서버리스에서는 인스턴스마다 메모리가 따로 놀기 때문에 완벽히 막지 못한다.
 * 작정하고 퍼붓는 공격은 Upstash Redis 같은 외부 저장소나 Vercel Firewall이 필요하다.
 * 여기서는 "실수로 연타" 정도를 막고, 진짜 안전장치는 Anthropic 콘솔의 월 사용 한도다.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12; // 1분당 요청 수

export interface RateLimitResult {
  ok: boolean;
  /** 다음 요청까지 기다려야 하는 초 */
  retryAfter: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();

  // 오래된 항목 정리 (메모리가 무한정 늘지 않도록)
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt < now) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > MAX_REQUESTS) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

/** 프록시(Vercel) 뒤에서 클라이언트 IP 추출 */
export function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
