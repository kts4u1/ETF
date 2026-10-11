import { describe, expect, it } from "vitest";
import { RateLimitedError, Throttle, retryAfterMs } from "./throttle";

/** 가짜 시계: sleep 이 시간을 앞으로 보낸다 */
function clock() {
  let t = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

describe("Throttle: 공유 쿨다운", () => {
  it("429 를 받으면 다음 요청이 쿨다운(첫 10초)이 끝날 때까지 기다린다", async () => {
    const c = clock();
    const th = new Throttle({ now: c.now, sleep: c.sleep });
    await th.beforeRequest();
    expect(c.sleeps).toEqual([]);
    th.rateLimited();
    await th.beforeRequest();
    expect(c.sleeps).toEqual([10_000]);
  });

  it("같은 순간에 여러 작업이 429 를 받아도 쿨다운은 한 번만 늘어난다", async () => {
    const c = clock();
    const cools: [number, number][] = [];
    const th = new Throttle({ now: c.now, sleep: c.sleep, onCooldown: (w, l) => cools.push([w, l]) });
    for (let i = 0; i < 6; i++) th.rateLimited();
    expect(cools).toEqual([[10_000, 1]]);
  });

  it("풀리지 않으면 10 → 20 → 40 → 80 → 120 → 120초로 늘고(상한 2분), 응답이 오면 처음부터 센다", async () => {
    const c = clock();
    const cools: number[] = [];
    const th = new Throttle({ now: c.now, sleep: c.sleep, maxLevel: 10, onCooldown: (w) => cools.push(w) });
    for (let i = 0; i < 6; i++) {
      th.rateLimited();
      await th.beforeRequest();
    }
    expect(cools).toEqual([10_000, 20_000, 40_000, 80_000, 120_000, 120_000]);
    th.succeeded();
    th.rateLimited();
    expect(cools.at(-1)).toBe(10_000);
  });

  it("Retry-After 가 있으면 그 시간(상한 2분)을 쓴다", async () => {
    const c = clock();
    const cools: number[] = [];
    const th = new Throttle({ now: c.now, sleep: c.sleep, onCooldown: (w) => cools.push(w) });
    th.rateLimited(30_000);
    await th.beforeRequest();
    th.rateLimited(900_000);
    expect(cools).toEqual([30_000, 120_000]);
  });

  it("쉬는 동안 쿨다운이 더 늘어나면 늘어난 만큼 더 기다린다", async () => {
    const c = clock();
    const sleeps: number[] = [];
    let extended = false;
    const th = new Throttle({
      now: c.now,
      sleep: async (ms) => {
        sleeps.push(ms);
        c.advance(ms);
        if (!extended) {
          extended = true;
          th.rateLimited(); // 쉬는 중에 끝난 다른 요청이 429 를 받았다(쿨다운 종료 직후)
        }
      },
    });
    th.rateLimited();
    await th.beforeRequest();
    expect(sleeps).toEqual([10_000, 20_000]);
  });
});

describe("Throttle: 서킷 브레이커", () => {
  it("연속 쿨다운이 maxLevel 번을 넘으면 그다음 요청부터 기다리지 않고 RateLimitedError", async () => {
    const c = clock();
    const th = new Throttle({ now: c.now, sleep: c.sleep, maxLevel: 3 });
    for (let i = 0; i < 3; i++) {
      th.rateLimited();
      await th.beforeRequest(); // 3번까지는 쉬고 계속한다
    }
    th.rateLimited(); // 4번째: 더 쉬지 않고 포기
    const before = c.sleeps.length;
    await expect(th.beforeRequest()).rejects.toBeInstanceOf(RateLimitedError);
    expect(c.sleeps.length).toBe(before); // 기다리지 않았다
    await expect(th.beforeRequest()).rejects.toMatchObject({ status: 429 });
  });

  it("포기할 때 한 번 알리고(onGiveUp), 포기한 뒤에는 쿨다운을 새로 시작하지 않는다", async () => {
    const c = clock();
    const cools: number[] = [];
    const giveUps: number[] = [];
    const th = new Throttle({ now: c.now, sleep: c.sleep, maxLevel: 2, onCooldown: (w) => cools.push(w), onGiveUp: (n) => giveUps.push(n) });
    th.rateLimited();
    await th.beforeRequest();
    th.rateLimited();
    await th.beforeRequest();
    th.rateLimited();
    expect(cools).toEqual([10_000, 20_000]);
    expect(giveUps).toEqual([2]);
  });

  it("중간에 성공 응답이 있으면 횟수가 초기화되어 브레이커가 열리지 않는다", async () => {
    const c = clock();
    const th = new Throttle({ now: c.now, sleep: c.sleep, maxLevel: 2 });
    for (let i = 0; i < 10; i++) {
      th.rateLimited();
      await th.beforeRequest();
      th.succeeded();
    }
    await expect(th.beforeRequest()).resolves.toBeUndefined();
  });
});

describe("Throttle: 요청 간격", () => {
  it("minIntervalMs 간격으로 요청 시작을 늘어놓는다(동시에 불러도) — 실제 타이머로 확인", async () => {
    const th = new Throttle({ minIntervalMs: 20 });
    const t0 = Date.now();
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        await th.beforeRequest();
        starts.push(Date.now() - t0);
      }),
    );
    starts.sort((a, b) => a - b);
    expect(starts[0]).toBeLessThan(15); // 첫 요청은 바로
    for (let i = 1; i < starts.length; i++) expect((starts[i] as number) - (starts[i - 1] as number)).toBeGreaterThanOrEqual(15); // 약 20ms 간격(타이머 오차 허용)
  });

  it("간격이 이미 지났으면 기다리지 않는다", async () => {
    const c = clock();
    const th = new Throttle({ now: c.now, sleep: c.sleep, minIntervalMs: 30 });
    await th.beforeRequest();
    c.advance(100);
    await th.beforeRequest();
    expect(c.sleeps).toEqual([]);
  });

  it("minIntervalMs 가 0 이면 기다리지 않는다", async () => {
    const c = clock();
    const th = new Throttle({ now: c.now, sleep: c.sleep });
    await Promise.all([th.beforeRequest(), th.beforeRequest(), th.beforeRequest()]);
    expect(c.sleeps).toEqual([]);
  });
});

describe("retryAfterMs", () => {
  it("초 단위·날짜·잘못된 값", () => {
    expect(retryAfterMs("30")).toBe(30_000);
    expect(retryAfterMs("0")).toBe(0);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("")).toBeUndefined();
    expect(retryAfterMs("abc")).toBeUndefined();
    expect(retryAfterMs("-5")).toBeUndefined();
    const now = Date.parse("2026-10-11T00:00:00Z");
    expect(retryAfterMs("Sun, 11 Oct 2026 00:01:00 GMT", now)).toBe(60_000);
    expect(retryAfterMs("Sun, 11 Oct 2026 00:00:00 GMT", now + 5_000)).toBe(0);
  });
});
