import { describe, expect, it } from "vitest";
import {
  endedEarly,
  forwardMaxDrawdown,
  cleanSeries,
  computeMetrics,
  forwardReturnMonths,
  indexOnOrBefore,
  minimalMetrics,
  RISK_FREE,
  shiftMonths,
} from "./metrics";
import type { PriceSeries } from "./types";

/** 평일(월~금)마다 하나씩, start 부터 n개의 거래일 날짜를 만든다. 공휴일은 고려하지 않는다. */
function weekdays(n: number, start = "20190101"): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8)));
  while (out.length < n) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) {
      out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function makeSeries(closes: number[], volume = 1000): PriceSeries {
  return { dates: weekdays(closes.length), close: closes, volume: closes.map(() => volume) };
}

/** 일정한 일간 수익률 g 로 n일 성장 */
const grow = (n: number, g: number, start = 100) => Array.from({ length: n }, (_, i) => start * Math.pow(1 + g, i));

describe("shiftMonths", () => {
  it("월말 보정", () => {
    expect(shiftMonths("20260331", -1)).toBe("20260228");
    expect(shiftMonths("20240331", -1)).toBe("20240229"); // 윤년
    expect(shiftMonths("20261008", -3)).toBe("20260708");
    expect(shiftMonths("20260115", -12)).toBe("20250115");
    expect(shiftMonths("20260115", -2)).toBe("20251115"); // 해를 넘김
  });
});

describe("indexOnOrBefore", () => {
  const d = ["20240102", "20240103", "20240105"];
  it("정확히 일치 / 휴장일 / 범위 밖", () => {
    expect(indexOnOrBefore(d, "20240103")).toBe(1);
    expect(indexOnOrBefore(d, "20240104")).toBe(1); // 04일 휴장 → 03일
    expect(indexOnOrBefore(d, "20240101")).toBe(-1);
    expect(indexOnOrBefore(d, "20250101")).toBe(2);
  });
});

describe("computeMetrics", () => {
  it("가격이 1개뿐이면 null", () => {
    expect(computeMetrics(makeSeries([100]))).toBeNull();
  });

  it("신규 상장(10일): 계산 가능한 항목만 채우고 나머지는 null", () => {
    const m = computeMetrics(makeSeries(grow(10, 0.001)))!;
    expect(m.days).toBe(10);
    expect(m.ret.m1).toBeNull();
    expect(m.ret.y1).toBeNull();
    expect(m.vol1y).toBeNull();
    expect(m.mddAll).toBe(0);
    expect(m.avgValue20).toBeNull();
  });

  it("달력 기준 1·3개월 수익률: 기준일의 N개월 전 종가와 비교", () => {
    const s = makeSeries(grow(400, 0.0005));
    const m = computeMetrics(s)!;
    const end = s.close.length - 1;
    const idx3 = indexOnOrBefore(s.dates, shiftMonths(s.dates[end]!, -3));
    expect(m.ret.m3).toBeCloseTo(s.close[end]! / s.close[idx3]! - 1, 12);
    // 달력 3개월은 대략 63~66 평일 → 63 거래일 고정 방식과 다르다
    expect(end - idx3).toBeGreaterThanOrEqual(63);
  });

  it("일정 성장률: 1년 CAGR = 1년 수익률, 변동성·낙폭 0", () => {
    const m = computeMetrics(makeSeries(grow(400, 0.0005)))!;
    expect(m.cagr1y).toBeCloseTo(m.ret.y1!, 12);
    expect(m.vol1y).toBeCloseTo(0, 6);
    expect(m.mdd1y).toBe(0);
    expect(m.drawdown).toBeCloseTo(0, 10);
    expect(m.ret.y3).toBeNull(); // 3년치 데이터 없음
    expect(m.cagr3y).toBeNull();
    expect(m.sharpe3y).toBeNull();
  });

  it("상장 직후 정확히 1년이 안 된 경우 1년 지표는 null", () => {
    // 평일 250개 ≈ 11.5개월
    const m = computeMetrics(makeSeries(grow(250, 0.0005)))!;
    expect(m.ret.y1).toBeNull();
    expect(m.ret.m6).not.toBeNull();
  });

  it("최대 낙폭: 2배 상승 후 절반 하락이면 -50%", () => {
    const up = grow(200, 0.0035, 100);
    const peak = up[up.length - 1]!;
    const down = Array.from({ length: 100 }, (_, i) => peak * (1 - (0.5 * (i + 1)) / 100));
    const m = computeMetrics(makeSeries([...up, ...down]))!;
    expect(m.mddAll).toBeCloseTo(-0.5, 6);
    expect(m.drawdown).toBeCloseTo(-0.5, 6);
  });

  it("샤프: (CAGR - 무위험) / 변동성의 부호가 맞다", () => {
    const wobble = (i: number) => 1 + (i % 2 === 0 ? 0.004 : -0.004);
    const up = Array.from({ length: 330 }, (_, i) => 100 * Math.pow(1.0006, i) * wobble(i));
    const m = computeMetrics(makeSeries(up))!;
    expect(m.cagr1y!).toBeGreaterThan(RISK_FREE);
    expect(m.sharpe1y!).toBeGreaterThan(0);
    const down = Array.from({ length: 330 }, (_, i) => 100 * Math.pow(0.9996, i) * wobble(i));
    expect(computeMetrics(makeSeries(down))!.sharpe1y!).toBeLessThan(0);
  });

  it("변동성 하한: 변동성이 거의 0이어도 샤프가 폭주하지 않는다", () => {
    const m = computeMetrics(makeSeries(grow(330, 0.0004)))!;
    expect(Math.abs(m.sharpe1y!)).toBeLessThan(20);
  });

  it("연환산 변동성: 일간 ±1% 교대 → 약 1%·√(연간 관측수)", () => {
    const closes: number[] = [100];
    for (let i = 1; i < 330; i++) closes.push(closes[i - 1]! * (i % 2 === 0 ? 1.01 : 0.99));
    const m = computeMetrics(makeSeries(closes))!;
    // 평일 기준 연 ~261 관측 → 0.01 × √261 ≈ 0.16
    expect(m.vol1y!).toBeGreaterThan(0.15);
    expect(m.vol1y!).toBeLessThan(0.18);
  });

  it("모멘텀 12-1: 최근 1개월 급락은 제외하고 계산", () => {
    const closes = grow(330, 0.001);
    const s0 = makeSeries(closes);
    const end = closes.length - 1;
    const i1 = indexOnOrBefore(s0.dates, shiftMonths(s0.dates[end]!, -1));
    for (let i = i1 + 1; i <= end; i++) closes[i] = closes[i1]! * 0.7; // 마지막 1개월 -30%
    const s = makeSeries(closes);
    const m = computeMetrics(s)!;
    const i12 = indexOnOrBefore(s.dates, shiftMonths(s.dates[end]!, -12));
    expect(m.mom12_1).toBeCloseTo(closes[i1]! / closes[i12]! - 1, 12);
    expect(m.ret.m1!).toBeLessThan(-0.25);
  });

  it("평균 거래대금 = 종가 × 거래량의 20일 평균", () => {
    const m = computeMetrics(makeSeries(Array(60).fill(500), 2000))!;
    expect(m.avgValue20).toBe(1_000_000);
  });

  it("미래 누출 방지: asOfIndex 이후 데이터를 바꿔도 지표가 같다", () => {
    const a = grow(500, 0.0005);
    const b = [...a.slice(0, 400), ...a.slice(400).map((x) => x * 3)];
    expect(computeMetrics(makeSeries(b), 399)).toEqual(computeMetrics(makeSeries(a), 399));
  });
});

describe("cleanSeries", () => {
  it("0/NaN/중복 날짜를 제거", () => {
    const s = cleanSeries({
      dates: ["20240101", "20240102", "20240102", "20240103", "20240104"],
      close: [100, 0, 101, Number.NaN, 102],
      volume: [1, 1, 1, 1, -5],
    });
    expect(s.dates).toEqual(["20240101", "20240102", "20240104"]);
    expect(s.close).toEqual([100, 101, 102]);
    expect(s.volume).toEqual([1, 1, 0]);
  });
});

describe("forwardReturnMonths", () => {
  const s = makeSeries(grow(400, 0.001));
  it("N개월 뒤 수익률", () => {
    const i = 100;
    const j = indexOnOrBefore(s.dates, shiftMonths(s.dates[i]!, 3));
    expect(forwardReturnMonths(s, i, 3)).toBeCloseTo(s.close[j]! / s.close[i]! - 1, 12);
  });
  it("아직 오지 않은 미래는 null", () => {
    expect(forwardReturnMonths(s, 395, 3)).toBeNull();
  });
});

describe("상장폐지(중도 종료) ETF의 보유 결과", () => {
  // 100일 상승 후 마지막 가격에서 시계열이 끝남(청산). 이후 날짜는 데이터가 없다.
  const closes = [...grow(100, 0.002), ...grow(40, -0.01, 100 * Math.pow(1.002, 99))];
  const s = makeSeries(closes);
  const idx = 60;

  it("기본: 아직 오지 않은 날짜로 보아 null (현재 상장 ETF 동작 유지)", () => {
    expect(forwardReturnMonths(s, idx, 12)).toBeNull();
    expect(forwardMaxDrawdown(s, idx, 12)).toBeNull();
  });
  it("liquidateAtLast: 마지막 가격에 청산된 결과를 쓴다", () => {
    const r = forwardReturnMonths(s, idx, 12, { liquidateAtLast: true })!;
    expect(r).toBeCloseTo(closes[closes.length - 1]! / closes[idx]! - 1, 12);
    const d = forwardMaxDrawdown(s, idx, 12, { liquidateAtLast: true })!;
    expect(d).toBeLessThan(-0.2); // 청산 직전 하락 구간의 낙폭이 반영된다
  });
  it("보유 기간 안에 데이터가 충분하면 옵션과 무관하게 같은 값", () => {
    expect(forwardReturnMonths(s, idx, 1, { liquidateAtLast: true })).toBeCloseTo(forwardReturnMonths(s, idx, 1)!, 12);
  });
  it("마지막 날 이후에 시작하는 보유는 결과 없음(null)", () => {
    expect(forwardReturnMonths(s, closes.length - 1, 3, { liquidateAtLast: true })).toBeNull();
  });
});

describe("endedEarly", () => {
  const s2 = makeSeries(grow(100, 0.001)); // 2019-01-01 부터 평일 100일 ≈ 2019-05
  it("기준일보다 한 달 넘게 일찍 끝나면 종료된 ETF", () => {
    expect(endedEarly(s2, "20190901")).toBe(true);
  });
  it("기준일 근처까지 이어지면 상장 중", () => {
    expect(endedEarly(s2, s2.dates[s2.dates.length - 1]!)).toBe(false);
    expect(endedEarly(s2, "20190520")).toBe(false);
  });
});

describe("minimalMetrics: 막 상장해 시세가 2행 미만인 ETF", () => {
  it("기간 지표는 모두 null, 기준일·거래일 수만 채운다", () => {
    const one: PriceSeries = { dates: ["20261008"], close: [10000], volume: [500] };
    expect(computeMetrics(one)).toBeNull(); // 2행 미만은 일반 계산 불가
    const m = minimalMetrics(one, "20261008");
    expect(m.asOf).toBe("20261008");
    expect(m.days).toBe(1);
    expect(m.firstDate).toBe("20261008");
    expect(m.years).toBeCloseTo(1 / 252, 6);
    expect(Object.values(m.ret).every((v) => v === null)).toBe(true);
    expect([m.cagr1y, m.vol1y, m.mdd1y, m.mddAll, m.sharpe1y, m.mom12_1, m.trend200, m.avgValue20].every((v) => v === null)).toBe(true);
  });
  it("시세가 아예 없으면 같은 수집의 최신일을 기준일로 쓴다", () => {
    const m = minimalMetrics({ dates: [], close: [], volume: [] }, "20261008");
    expect(m.asOf).toBe("20261008");
    expect(m.firstDate).toBe("20261008");
    expect(m.days).toBe(0);
  });
});
