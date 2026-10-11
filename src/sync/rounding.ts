import type { computeMetrics } from "../core/metrics";

// 직렬화 크기를 줄이기 위한 반올림. 국내 수집(build-snapshot)과 해외 수집(us)이 같은 자릿수를 쓰도록 한 곳에 둔다.

export function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function roundMetrics(m: NonNullable<ReturnType<typeof computeMetrics>>) {
  const r = (v: number | null, d = 4) => (v === null ? null : round(v, d));
  return {
    ...m,
    years: round(m.years, 2),
    ret: {
      m1: r(m.ret.m1),
      m3: r(m.ret.m3),
      m6: r(m.ret.m6),
      y1: r(m.ret.y1),
      y3: r(m.ret.y3),
      y5: r(m.ret.y5),
    },
    cagr1y: r(m.cagr1y),
    cagr3y: r(m.cagr3y),
    cagr5y: r(m.cagr5y),
    vol1y: r(m.vol1y),
    vol3y: r(m.vol3y),
    mdd1y: r(m.mdd1y),
    mdd3y: r(m.mdd3y),
    mddAll: r(m.mddAll),
    drawdown: r(m.drawdown),
    sharpe1y: r(m.sharpe1y, 3),
    sharpe3y: r(m.sharpe3y, 3),
    mom12_1: r(m.mom12_1),
    trend200: r(m.trend200),
    avgValue20: m.avgValue20 === null ? null : Math.round(m.avgValue20),
  };
}
