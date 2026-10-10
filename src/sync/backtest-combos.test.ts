import { describe, expect, it } from "vitest";
import { forwardBasket, type Member } from "./backtest-combos";
import type { PriceSeries } from "../core/types";

/** 2024-01-01 부터 평일마다 하나씩 */
function make(closes: number[]): PriceSeries {
  const dates: string[] = [];
  const d = new Date(Date.UTC(2024, 0, 1));
  while (dates.length < closes.length) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { dates, close: closes, volume: closes.map(() => 1) };
}
const flat = (n: number, v = 100) => Array(n).fill(v) as number[];

describe("forwardBasket", () => {
  const live = make([...flat(10), ...Array.from({ length: 140 }, (_, i) => 100 * Math.pow(1.001, i))]); // 상승
  it("단일 상장 ETF: 수익률과 낙폭 계산", () => {
    const r = forwardBasket([{ series: live, idx: 10, w: 1 }], live.dates[10]!, 3)!;
    expect(r.ret).toBeGreaterThan(0);
    expect(r.mdd).toBe(0);
  });

  it("아직 오지 않은 날짜(상장 중인 ETF의 시세가 끝남)는 평가 불가", () => {
    expect(forwardBasket([{ series: live, idx: 100, w: 1 }], live.dates[100]!, 12)).toBeNull();
  });

  it("보유 도중 종료된 ETF는 마지막 가격에 청산, 이후 그 가격 유지(상장폐지 편향 방지)", () => {
    // 상장 ETF(상승)와, 50일째에 -60% 로 끝나는 ETF 를 50:50 으로 보유
    const doomed = make([...flat(10), ...Array.from({ length: 40 }, (_, i) => 100 * (1 - (0.6 * (i + 1)) / 40))]);
    const members: Member[] = [
      { series: live, idx: 10, w: 0.5 },
      { series: doomed, idx: 10, w: 0.5, ended: true },
    ];
    const r = forwardBasket(members, live.dates[10]!, 6)!;
    expect(r).not.toBeNull();
    const liveEnd = live.close[indexAfter(live, 6)]! / live.close[10]!;
    const doomedEnd = doomed.close[doomed.close.length - 1]! / doomed.close[10]!; // 매수 시점 가격 대비 청산 가격
    expect(r.ret).toBeCloseTo(0.5 * liveEnd + 0.5 * doomedEnd - 1, 9); // 종료 ETF 는 마지막 가격에서 고정
    expect(r.mdd).toBeLessThan(-0.1); // 급락이 낙폭에 반영된다
  });

  it("종료 표시가 없으면(ended=false) 같은 상황에서 평가 불가로 빠진다 — 그래서 표시가 중요하다", () => {
    const doomed = make([...flat(10), ...Array.from({ length: 40 }, (_, i) => 100 * (1 - (0.6 * (i + 1)) / 40))]);
    const r = forwardBasket([{ series: live, idx: 10, w: 0.5 }, { series: doomed, idx: 10, w: 0.5 }], live.dates[10]!, 6);
    expect(r).toBeNull();
  });

  it("모든 구성이 종료된 ETF면 기준 시계열이 없어 null", () => {
    const doomed = make([...flat(10), 90, 80]);
    expect(forwardBasket([{ series: doomed, idx: 10, w: 1, ended: true }], doomed.dates[10]!, 3)).toBeNull();
  });
});

/** 기준 idx 10 에서 months 개월 뒤 인덱스(테스트용 단순 탐색) */
function indexAfter(s: PriceSeries, months: number): number {
  const d = s.dates[10]!;
  const y = +d.slice(0, 4), m = +d.slice(4, 6) - 1 + months, day = +d.slice(6, 8);
  const target = `${y + Math.floor(m / 12)}${String((m % 12) + 1).padStart(2, "0")}${String(day).padStart(2, "0")}`;
  let j = 0;
  for (let i = 0; i < s.dates.length; i++) if (s.dates[i]! <= target) j = i;
  return j;
}
