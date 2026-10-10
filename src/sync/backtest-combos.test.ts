import { describe, expect, it } from "vitest";
import { mean, phaseCI } from "./bt-common";
import { comboCell, forwardBasket, type Member, type Outcome } from "./backtest-combos";
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

  it("모든 구성이 종료된 ETF여도 평가에서 빠지지 않는다: 마지막 가격에 청산(시세가 끝난 뒤의 기간)", () => {
    const doomed = make([...flat(10), 90, 80]);
    const r = forwardBasket([{ series: doomed, idx: 10, w: 1, ended: true }], doomed.dates[10]!, 3)!;
    expect(r).not.toBeNull();
    expect(r.ret).toBeCloseTo(80 / 90 - 1, 9);
    expect(r.mdd).toBeCloseTo(80 / 90 - 1, 9);
  });

  it("종료 표시된 ETF 하나만 담아도, 보유 기간 전체에 시세가 있으면 상장 ETF와 똑같이 계산한다", () => {
    // 상장폐지 ETF 라도 보유 기간이 끝날 때까지 거래됐다면 청산 가정이 개입하면 안 된다(추천 1위가 이런 경우였다)
    const asEnded = forwardBasket([{ series: live, idx: 10, w: 1, ended: true }], live.dates[10]!, 3)!;
    const asLive = forwardBasket([{ series: live, idx: 10, w: 1 }], live.dates[10]!, 3)!;
    expect(asEnded).toEqual(asLive);
  });

  it("전부 종료된 여러 ETF: 가장 늦게 끝난 시계열을 날짜 축으로 쓰고 먼저 끝난 것은 마지막 가격을 유지", () => {
    const early = make([...flat(10), 90, 80]); // 12번째 평일에 끝남
    const late = make([...flat(10), 100, 110, 120, 130, 140]);
    const r = forwardBasket(
      [{ series: early, idx: 10, w: 0.5, ended: true }, { series: late, idx: 10, w: 0.5, ended: true }],
      early.dates[10]!,
      3,
    )!;
    expect(r.ret).toBeCloseTo(0.5 * (80 / 90) + 0.5 * (140 / 100) - 1, 9);
  });

  it("구성이 비어 있으면 null", () => {
    expect(forwardBasket([], "20240101", 3)).toBeNull();
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

describe("comboCell: 기준 전략 대비 차이와 비중첩 표본 구간의 배선", () => {
  const ts = Array.from({ length: 24 }, (_, i) => `2022${String((i % 12) + 1).padStart(2, "0")}${i < 12 ? "15" : "16"}`);
  const base = new Map<string, Outcome>(ts.map((t, i) => [t, { t, ret: 0.01 * ((i % 5) - 2), mdd: -0.05 - 0.01 * (i % 4) }]));
  const outs: Outcome[] = ts.map((t, i) => ({ t, ret: 0.01 * ((i % 7) - 3) + 0.004, mdd: -0.03 - 0.008 * (i % 3) }));
  it("m=6: 차이의 평균은 전체 월, 구간은 phaseCI(차이, 6)의 반폭(t 분포, 위상 평균)", () => {
    const c = comboCell(outs, base, 6);
    const dR = outs.map((o, i) => o.ret - (base.get(ts[i]!) as Outcome).ret);
    const dM = outs.map((o, i) => o.mdd - (base.get(ts[i]!) as Outcome).mdd);
    expect(c.n).toBe(24);
    expect(c.dRet).toBeCloseTo(mean(dR), 12);
    expect(c.dMdd).toBeCloseTo(mean(dM), 12);
    expect(c.dRetCI).toBeCloseTo(phaseCI(dR, 6).ci, 12);
    expect(c.dMddCI).toBeCloseTo(phaseCI(dM, 6).ci, 12);
    expect(c.dMddCI).toBeGreaterThan(1.96 * 0); // 유한한 양수
    expect(Number.isFinite(c.dMddCI)).toBe(true);
  });
  it("m=12 에서 표본이 짧아 쓸 수 있는 위상이 없으면 구간이 NaN(JSON 으로는 null)이다", () => {
    const few = outs.slice(0, 7);
    const c = comboCell(few, base, 12);
    expect(c.dRetCI).toBeNaN();
    expect(c.dMddCI).toBeNaN();
  });
  it("낙폭이 기준보다 작은 달의 비율(mddWin)은 mdd 가 0 에 더 가까운 달을 센다", () => {
    const better: Outcome[] = ts.map((t) => ({ t, ret: 0, mdd: -0.01 }));
    expect(comboCell(better, base, 3).mddWin).toBe(1);
    const worse: Outcome[] = ts.map((t) => ({ t, ret: 0, mdd: -0.5 }));
    expect(comboCell(worse, base, 3).mddWin).toBe(0);
  });
});
