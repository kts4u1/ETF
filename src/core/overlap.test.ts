import { describe, expect, it } from "vitest";
import { commonHoldings, exposureOf, overlapLevel, overlapMatrix, overlapPct, rankOverlaps, topWeight, type Exposure, type HoldingsFile } from "./overlap";

const ex = (pairs: [number, number][], n = pairs.length, total?: number): Exposure => ({
  ids: pairs.map((p) => p[0]),
  w: pairs.map((p) => p[1]),
  n,
  total: total ?? pairs.reduce((s, p) => s + p[1], 0),
});

describe("overlapPct", () => {
  it("같은 종목의 작은 비중만큼 겹친다: Σ min", () => {
    const a = ex([[1, 34], [2, 27], [3, 10]]); // 삼성전자/하이닉스/기타
    const b = ex([[1, 27], [2, 22], [4, 20]]);
    expect(overlapPct(a, b)).toBeCloseTo(27 + 22, 10);
  });
  it("대칭이다", () => {
    const a = ex([[1, 30], [2, 20]]);
    const b = ex([[2, 50], [3, 10]]);
    expect(overlapPct(a, b)).toBeCloseTo(overlapPct(b, a), 12);
    expect(overlapPct(a, b)).toBe(20);
  });
  it("자기 자신과는 식별 비중 합과 같다", () => {
    const a = ex([[1, 60], [2, 35]]);
    expect(overlapPct(a, a)).toBeCloseTo(95, 10);
  });
  it("겹치는 종목이 없거나 비어 있으면 0", () => {
    expect(overlapPct(ex([[1, 50]]), ex([[2, 50]]))).toBe(0);
    expect(overlapPct(ex([]), ex([[1, 50]]))).toBe(0);
  });
  it("합이 100을 넘는 ETF는 100으로 스케일(100% 초과 겹침 방지)", () => {
    const a = ex([[1, 120]], 1, 120);
    const b = ex([[1, 100]], 1, 100);
    expect(overlapPct(a, b)).toBeCloseTo(100, 10);
    expect(overlapPct(a, a)).toBeLessThanOrEqual(100 + 1e-9);
  });
});

describe("commonHoldings", () => {
  it("겹치는 몫이 큰 순, limit 적용", () => {
    const a = ex([[1, 30], [2, 20], [3, 10]]);
    const b = ex([[3, 40], [1, 15], [2, 20], [9, 5]]);
    const c = commonHoldings(a, b, 2);
    expect(c.map((x) => x.id)).toEqual([2, 1]);
    expect(c[0]).toMatchObject({ wa: 20, wb: 20, common: 20 });
    expect(c[1]).toMatchObject({ wa: 30, wb: 15, common: 15 });
  });
});

describe("topWeight / overlapLevel / overlapMatrix", () => {
  it("상위 n개 비중", () => {
    expect(topWeight(ex([[1, 30], [2, 20], [3, 10]]), 2)).toBe(50);
    expect(topWeight(ex([[1, 30]]), 10)).toBe(30);
  });
  it("수준 표기 경계", () => {
    expect(overlapLevel(60).level).toBe("high");
    expect(overlapLevel(30).level).toBe("mid");
    expect(overlapLevel(12).label).toBe("일부 겹침");
    expect(overlapLevel(3).label).toBe("거의 안 겹침");
  });
  it("행렬은 대칭이고 대각선 100, 계산 불가는 NaN", () => {
    const a = ex([[1, 50]]);
    const b = ex([[1, 30]]);
    const m = overlapMatrix([a, b, undefined]);
    expect(m[0]![0]).toBe(100);
    expect(m[0]![1]).toBe(30);
    expect(m[1]![0]).toBe(30);
    expect(Number.isNaN(m[0]![2]!)).toBe(true);
    expect(Number.isNaN(m[2]![2]!)).toBe(true);
  });
});

describe("rankOverlaps", () => {
  const target = ex([[1, 50], [2, 30]]);
  const others: [string, Exposure][] = [
    ["T", target], // 자기 자신은 제외
    ["A", ex([[1, 50], [2, 30]])], // 80
    ["B", ex([[1, 20]])], // 20
    ["C", ex([[9, 90]])], // 0 → minPct 미만
    ["D", ex([[2, 10], [1, 10]])], // 20
  ];
  it("겹침 큰 순으로, 자기 자신과 최소 미만은 제외", () => {
    const r = rankOverlaps("T", target, others, 10, 5);
    expect(r.map((x) => x.code)).toEqual(["A", "B", "D"]); // B·D 는 20으로 동점 → 입력 순서 유지
    expect(r[0]).toEqual({ code: "A", pct: 80 });
    expect(r.find((x) => x.code === "C")).toBeUndefined();
    expect(r.find((x) => x.code === "T")).toBeUndefined();
  });
  it("overlapPct 와 같은 값을 낸다", () => {
    const r = rankOverlaps("T", target, others, 10, 0);
    for (const x of r) expect(x.pct).toBeCloseTo(overlapPct(target, others.find((o) => o[0] === x.code)![1]), 12);
  });
  it("limit 적용", () => {
    expect(rankOverlaps("T", target, others, 1, 0)).toHaveLength(1);
  });
});

describe("exposureOf", () => {
  const file: HoldingsFile = {
    version: 1, asOf: "20261008", topK: 10, ids: ["S1", "S2"], names: ["삼성전자", "하이닉스"],
    etfs: { A: { t: 95.5, n: 2, lt: 0, i: [0, 1], w: [3447, 2694] } }, unavailable: { L: "derivative-structure" },
  };
  it("정수 저장 비중을 % 로 복원, 없는 ETF 는 undefined", () => {
    const e = exposureOf(file, "A")!;
    expect(e.w).toEqual([34.47, 26.94]);
    expect(e.total).toBe(95.5);
    expect(exposureOf(file, "L")).toBeUndefined();
  });
});
