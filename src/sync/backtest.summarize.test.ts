import { describe, expect, it } from "vitest";
import { buildSummary, icCell, summarize } from "./backtest";
import { icInterval, mean, phaseCI } from "./bt-common";

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

describe("buildSummary / icCell: IC 의 비중첩 표본 구간이 보유 기간 m 으로 계산된다", () => {
  const ic = Array.from({ length: 40 }, (_, i) => 0.05 + 0.2 * Math.sin(i * 1.3));
  const rows = Array.from({ length: 40 }, (_, i) => ({
    t: String(20210100 + i),
    fwd: Object.fromEntries([3, 6, 12].map((m) => [m, { top: 0.05, candMean: 0.03, candMedian: 0.02 + 0.001 * (i % 3), topMdd: -0.1, candMdd: -0.12 }])),
  })) as unknown as Parameters<typeof summarize>[0];
  const icAcc = new Map([["stable|total", new Map([[3, ic], [6, ic], [12, ic]])]]);
  const results = new Map([["stable|모델 종합점수", rows], ["stable|(비교) 최근 1년 수익률 순", rows]]);

  it("요약 JSON 의 icCI 는 칸마다 icInterval(ic, m) 이고, 평균 ic 는 전체 평균이다", () => {
    const out = buildSummary(results, icAcc, ["stable"], "20261008", 10, 40) as unknown as { profiles: Record<string, Record<string, { ic: number; icCI: number | null }>> };
    for (const [key, m] of [["m3", 3], ["m6", 6], ["m12", 12]] as const) {
      const cell = out.profiles.stable![key]!;
      expect(cell.icCI).toBeCloseTo(icInterval(ic, m)!, 12);
      expect(cell.ic).toBeCloseTo(mean(ic), 12);
    }
    const c3 = out.profiles.stable!.m3!.icCI!;
    const c12 = out.profiles.stable!.m12!.icCI!;
    expect(c3).not.toBeCloseTo(c12, 6); // m 에 따라 달라야 한다
  });
  it("리포트 IC 표 칸: 평균 ±구간(소수 3자리), 비었으면 '-', 구간을 못 구하면 평균만", () => {
    for (const m of [3, 6, 12]) expect(icCell(ic, m)).toBe(`${mean(ic).toFixed(3)} ±${icInterval(ic, m)!.toFixed(3)}`);
    expect(icCell([], 6)).toBe("-");
    expect(icCell([0.1, 0.2], 12)).toBe("0.150");
  });
});
