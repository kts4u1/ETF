/**
 * 호출 제한(HTTP 429) 대응: 모든 요청이 함께 쉬는 공유 쿨다운 + 요청 간격 + 서킷 브레이커.
 *
 * 실제 GitHub 러너에서 야후 펀드 정보를 약 2,400건 받은 뒤 한 번 제한이 걸렸다. 호출마다 따로 짧게 재시도하면
 * 동시 작업 6개가 제한 중에도 계속 두드려 실패만 늘고(2,704건 중 36건 실패), 이어진 재시도에서는 세션(crumb) 발급까지 429 였다.
 * 그래서 429 를 받으면 전체가 정해진 시간(10초, 20초, 40초… 최대 2분) 같이 쉬고, 제한이 풀리면(429 가 아닌 응답) 처음부터 센다.
 * 쉬어도 풀리지 않아 연속 쿨다운이 maxLevel 번을 넘으면 이 실행에서는 더 요청하지 않고 곧바로 실패시켜(RateLimitedError),
 * 수천 건이 각각 길게 기다리다 60분 제한에 걸리는 것을 막는다 — 바깥의 재시도(refresh-data.sh)가 더 긴 간격을 두고 이어서 받는다.
 */
import { HttpError } from "./naver";

/** 쿨다운을 여러 번 거쳐도 풀리지 않아 이 실행에서는 더 요청하지 않기로 했다 */
export class RateLimitedError extends HttpError {
  constructor(detail: string) {
    super(429, detail);
    this.name = "RateLimitedError";
    this.message = `호출 제한(HTTP 429)이 계속되어 이 실행에서는 더 요청하지 않습니다: ${detail}`;
  }
}

export interface ThrottleOptions {
  /** 요청 시작 사이의 최소 간격(ms). 기본 0 */
  minIntervalMs?: number;
  /** 첫 쿨다운(ms). 기본 10초 */
  coolBaseMs?: number;
  /** 쿨다운 상한(ms). 기본 2분 */
  coolMaxMs?: number;
  /** 풀리지 않은 채 이 횟수를 넘겨 쿨다운하면 이후 요청을 즉시 실패시킨다. 기본 6(10+20+40+80+120+120초 ≈ 6.5분) */
  maxLevel?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** 쿨다운에 들어갈 때 알린다(로그용) */
  onCooldown?: (waitMs: number, level: number) => void;
  /** 쉬어도 풀리지 않아 더 요청하지 않기로 했을 때 알린다(로그용). cooldowns 는 지금까지 쉰 횟수 */
  onGiveUp?: (cooldowns: number) => void;
}

export class Throttle {
  private readonly minIntervalMs: number;
  private readonly coolBaseMs: number;
  private readonly coolMaxMs: number;
  private readonly maxLevel: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onCooldown?: (waitMs: number, level: number) => void;
  private readonly onGiveUp?: (cooldowns: number) => void;
  /** 이 시각까지는 아무도 요청하지 않는다 */
  private coolUntil = 0;
  /** 풀리지 않고 이어진 쿨다운 횟수 */
  private level = 0;
  /** 다음 요청이 시작할 수 있는 가장 이른 시각 */
  private nextSlot = 0;

  constructor(opts: ThrottleOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? 0;
    this.coolBaseMs = opts.coolBaseMs ?? 10_000;
    this.coolMaxMs = opts.coolMaxMs ?? 120_000;
    this.maxLevel = opts.maxLevel ?? 6;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.onCooldown = opts.onCooldown;
    this.onGiveUp = opts.onGiveUp;
  }

  /** 요청을 보내기 직전에 부른다: 쿨다운이 끝나길 기다리고 요청 간격을 맞춘다. 계속 막혀 있으면 던진다 */
  async beforeRequest(): Promise<void> {
    for (;;) {
      if (this.level > this.maxLevel) throw new RateLimitedError(`연속 ${this.level - 1}번 쉬었지만 풀리지 않음`);
      const wait = this.coolUntil - this.now();
      if (wait <= 0) break;
      await this.sleep(wait); // 쉬는 동안 다른 요청이 쿨다운을 늘렸을 수 있어 다시 확인한다
    }
    if (this.minIntervalMs > 0) {
      const t = this.now();
      const slot = Math.max(t, this.nextSlot);
      this.nextSlot = slot + this.minIntervalMs;
      if (slot > t) await this.sleep(slot - t);
    }
  }

  /** 429 를 받았다. 이미 쉬는 중이면(같은 순간에 여러 작업이 429 를 받는다) 중복으로 늘리지 않는다 */
  rateLimited(retryAfterMs?: number): void {
    const t = this.now();
    if (t < this.coolUntil) return;
    this.level++;
    if (this.level > this.maxLevel) {
      this.onGiveUp?.(this.maxLevel); // 더 쉬지 않는다: 다음 요청부터 beforeRequest 가 즉시 실패시킨다
      return;
    }
    const backoff = Math.min(this.coolBaseMs * 2 ** (this.level - 1), this.coolMaxMs);
    const wait = retryAfterMs !== undefined && retryAfterMs > 0 ? Math.min(retryAfterMs, this.coolMaxMs) : backoff;
    this.coolUntil = t + wait;
    this.onCooldown?.(wait, this.level);
  }

  /** 429 가 아닌 응답을 받았다: 제한이 풀렸으니 처음부터 센다 */
  succeeded(): void {
    this.level = 0;
  }
}

/** Retry-After 헤더(초 또는 날짜)를 ms 로. 알 수 없으면 undefined */
export function retryAfterMs(value: string | null, nowMs: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return secs >= 0 ? secs * 1000 : undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : undefined;
}
