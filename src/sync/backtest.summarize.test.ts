import { describe, expect, it } from "vitest";
import { summarize } from "./backtest";
import { mean, phaseCI } from "./bt-common";

describe("summarize: 모델 칸의 비중첩 표본 통계 배선", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    t: String(20210100 + i),
    fwd: { 6: { top: 0.05 + 0.01 * ((i % 7) - 3), candMean: 0.03, candMedian: 0.02 + 0.005 * (i % 4), topMdd: -0.1, candMdd: -0.12 } },
  })) as unknown as Parameters<typeof summarize>[0];

  it("초과수익 평균은 전체 월, 비중첩 평균·구간은 phaseCI(초과수익, m)와 같다", () => {
    const s = summarize(rows, 6);
    const ex = rows.map((r) => r.fwd[6]!.top - r.fwd[6]!.candMedian);
    const ph = phaseCI(ex, 6);
    expect(s.n).toBe(30);
    expect(s.excess).toBeCloseTo(mean(ex), 12);
    expect(s.indepMean).toBeCloseTo(ph.mean, 12);
    expect(s.indepCI).toBeCloseTo(ph.ci, 12);
    expect(s.indepN).toBe(5); // floor(30 / 6)
  });
  it("위상별 표본 수가 다른 경우(31개월, m=6)에도 비중첩 평균은 phaseCI 의 위상 평균이다", () => {
    const more = [...rows, { t: "20210131", fwd: { 6: { top: 0.2, candMean: 0.03, candMedian: 0.02, topMdd: -0.1, candMdd: -0.12 } } }] as unknown as Parameters<typeof summarize>[0];
    const s = summarize(more, 6);
    const ex = more.map((r) => r.fwd[6]!.top - r.fwd[6]!.candMedian);
    expect(s.indepMean).toBeCloseTo(phaseCI(ex, 6).mean, 12);
    expect(s.indepMean).not.toBeCloseTo(mean(ex), 6);
    expect(s.indepN).toBe(5); // floor(31 / 6)
  });
  it("표본이 모자라면 구간이 NaN 이고 n 이 작게 보고된다", () => {
    const s = summarize(rows.slice(0, 10), 12);
    expect(s.indepCI).toBeNaN();
    expect(s.indepN).toBe(0);
  });
});
