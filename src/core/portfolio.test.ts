import { describe, expect, it } from "vitest";
import {
  MAX_PAIR_CORR,
  MIN_WEEKS,
  correlation,
  portfolioReturns,
  proposeCombos,
  roleOf,
  roundWeights,
  statsOf,
  weeklyReturns,
  weightsFor,
  type ComboCandidate,
} from "./portfolio";
import type { Exposure } from "./overlap";
import { makeEtf } from "./test-utils";

/** 의사 난수(재현 가능) */
function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5) * 2; // -1..1
}

/** 평균 mu, 변동 sd 의 주간 수익률 n개 */
function returns(n: number, mu: number, sd: number, seed: number): number[] {
  const r = lcg(seed);
  return Array.from({ length: n }, () => mu + sd * r());
}

const cand = (name: string, rets: number[], score = 70, exposure?: Exposure): ComboCandidate => ({
  etf: makeEtf({ name, code: name }),
  score,
  returns: rets,
  exposure,
});

describe("weeklyReturns", () => {
  it("끝에서부터 이어지는 구간만 수익률로", () => {
    const r = weeklyReturns([null, 100, 110, 121]);
    expect(r).toHaveLength(2);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(0.1, 12);
  });
  it("중간에 null 이 있으면 그 뒤 구간만 사용", () => {
    const r = weeklyReturns([100, null, 100, 110]);
    expect(r).toHaveLength(1);
    expect(r[0]).toBeCloseTo(0.1, 12);
  });
  it("값이 부족하면 빈 배열", () => {
    expect(weeklyReturns([100])).toEqual([]);
    expect(weeklyReturns([null, null])).toEqual([]);
  });
});

describe("roundWeights / weightsFor", () => {
  it("5% 단위, 합 1", () => {
    for (const w of [[0.333, 0.333, 0.334], [0.52, 0.31, 0.17], [0.5, 0.5]]) {
      const r = roundWeights(w);
      expect(r.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
      for (const x of r) expect(Math.abs(x / 0.05 - Math.round(x / 0.05))).toBeLessThan(1e-9);
    }
  });
  it("균등 배분", () => {
    expect(weightsFor("equal", [0.1, 0.2])).toEqual([0.5, 0.5]);
    expect(weightsFor("equal", [0.1, 0.2, 0.3]).reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
  });
  it("역변동성: 변동성이 작은 쪽에 더 많이, 단 15~60% 범위로 제한", () => {
    const w = weightsFor("inverse-vol", [0.02, 0.2, 0.4]);
    expect(w[0]!).toBeGreaterThan(w[1]!);
    expect(w[1]!).toBeGreaterThan(w[2]! - 1e-9);
    expect(Math.max(...w)).toBeLessThanOrEqual(0.6 + 1e-9);
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0.15 - 1e-9);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 10);
  });
});

describe("statsOf", () => {
  it("완전한 역상관 두 자산을 균등 배분하면 변동성 0, 분산 비율이 크다", () => {
    const a = returns(104, 0.002, 0.03, 1);
    const b = a.map((x) => -x + 0.004); // 평균 같은 역상관
    const w = [0.5, 0.5];
    const pr = portfolioReturns([a, b], w);
    const st = statsOf(pr, [a, b], w);
    expect(st.vol).toBeLessThan(1e-9);
    expect(st.mdd).toBeCloseTo(0, 9);
  });
  it("완전 동일 자산은 분산 효과가 없다(분산 비율 1)", () => {
    const a = returns(104, 0.002, 0.03, 2);
    const w = [0.5, 0.5];
    const st = statsOf(portfolioReturns([a, a], w), [a, a], w);
    expect(st.diversificationRatio).toBeCloseTo(1, 9);
  });
  it("CAGR·낙폭을 해석해와 비교: 매주 +1% 52주", () => {
    const a = Array(52).fill(0.01);
    const st = statsOf(a, [a], [1]);
    expect(st.cagr).toBeCloseTo(Math.pow(1.01, 52) - 1, 10);
    expect(st.mdd).toBe(0);
    expect(st.weeks).toBe(52);
  });
  it("낙폭: 100 → 120 → 60 이면 -50%", () => {
    const st = statsOf([0.2, -0.5], [[0.2, -0.5]], [1]);
    expect(st.mdd).toBeCloseTo(-0.5, 10);
  });
});

describe("correlation", () => {
  it("동일=1, 반대=-1, 길이가 다르면 뒤쪽 기준", () => {
    const a = returns(60, 0, 0.02, 3);
    expect(correlation(a, a)).toBeCloseTo(1, 10);
    expect(correlation(a, a.map((x) => -x))).toBeCloseTo(-1, 10);
    expect(correlation(a.slice(10), a)).toBeCloseTo(1, 10);
  });
});

describe("proposeCombos", () => {
  const base = returns(120, 0.002, 0.03, 10);
  const similarToBase = base.map((x, i) => x + 0.0005 * Math.sin(i)); // 상관 ≈ 1
  const other1 = returns(120, 0.001, 0.02, 20);
  const other2 = returns(120, 0.0005, 0.01, 30);

  it("거의 같은 움직임의 ETF는 한 조합에 넣지 않는다", () => {
    expect(correlation(base, similarToBase)).toBeGreaterThan(MAX_PAIR_CORR);
    const res = proposeCombos(
      [cand("KODEX 가", base, 80), cand("TIGER 나", similarToBase, 79), cand("SOL 다", other1, 60)],
      "aggressive",
      { size: 2, limit: 10 },
    );
    for (const p of res) {
      const codes = p.members.map((m) => m.cand.etf.code);
      expect(codes.includes("KODEX 가") && codes.includes("TIGER 나")).toBe(false);
    }
    expect(res.length).toBeGreaterThan(0);
  });

  it("같은 지수(groupKey)·같은 (자산군, 테마) 는 함께 담지 않는다", () => {
    const a = { ...cand("TIGER 미국S&P500", base), };
    const b = { ...cand("KODEX 미국S&P500", other1) };
    expect(proposeCombos([a, b], "aggressive", { size: 2 })).toEqual([]);
  });

  it("구성종목 겹침이 한도를 넘으면 제외하고, 평균 겹침은 점수에서 감점", () => {
    const hi: Exposure = { total: 100, n: 2, ids: [1, 2], w: [60, 40] };
    const hi2: Exposure = { total: 100, n: 2, ids: [1, 2], w: [60, 40] }; // 100% 겹침
    const lo: Exposure = { total: 100, n: 1, ids: [9], w: [100] };
    const res = proposeCombos(
      [cand("KODEX 가", base, 80, hi), cand("TIGER 나나", other1, 70, hi2), cand("SOL 다다다", other2, 60, lo)],
      "aggressive",
      { size: 2, limit: 10 },
    );
    const pairs = res.map((p) => p.members.map((m) => m.cand.etf.code).sort().join("+"));
    expect(pairs).not.toContain(["KODEX 가", "TIGER 나나"].sort().join("+"));
    expect(res.every((p) => p.avgOverlap !== null)).toBe(true);
  });

  it("조합 수준 성향 한도: 안정형(변동성 15%)을 넘는 조합은 제외", () => {
    const wild = returns(120, 0.003, 0.08, 40); // 주간 8% → 연 ~40%+
    const wild2 = returns(120, 0.003, 0.08, 41);
    expect(proposeCombos([cand("KODEX 가가", wild), cand("TIGER 나나나", wild2)], "stable", { size: 2 })).toEqual([]);
    expect(proposeCombos([cand("KODEX 가가", wild), cand("TIGER 나나나", wild2)], "aggressive", { size: 2 }).length).toBe(1);
  });

  it("분산 효과가 큰 조합이 위로: 서로 독립인 자산 vs 상관 높은 자산", () => {
    const corr = base.map((x, i) => 0.9 * x + 0.1 * (returns(120, 0, 0.03, 50)[i] as number));
    const indep = returns(120, 0.002, 0.03, 60);
    const res = proposeCombos(
      [cand("KODEX 기준", base, 70), cand("TIGER 상관높음", corr, 70), cand("SOL 독립자산", indep, 70)],
      "aggressive",
      { size: 2, limit: 3, weighting: "equal" },
    );
    const best = res[0]!.members.map((m) => m.cand.etf.code);
    expect(best).toContain("SOL 독립자산");
  });

  it("비중은 합 1이고 제안끼리는 구성이 절반 이상 겹치지 않는다", () => {
    const pool = Array.from({ length: 6 }, (_, i) => cand(`ETF${String.fromCharCode(65 + i)}${i}테스트`, returns(120, 0.001, 0.01 + i * 0.004, 100 + i), 80 - i));
    const res = proposeCombos(pool, "aggressive", { size: 3, limit: 3 });
    expect(res.length).toBeGreaterThan(0);
    for (const p of res) expect(p.members.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(1, 10);
    for (let i = 0; i < res.length; i++)
      for (let j = i + 1; j < res.length; j++) {
        const a = new Set(res[i]!.members.map((m) => m.cand.etf.code));
        const shared = res[j]!.members.filter((m) => a.has(m.cand.etf.code)).length;
        expect(shared).toBeLessThan(2);
      }
  });

  it(`공통 이력이 ${MIN_WEEKS}주 미만인 후보는 풀에서 빠진다`, () => {
    const short = cand("KODEX 짧음", returns(30, 0.001, 0.02, 7));
    expect(proposeCombos([short, cand("TIGER 김", base)], "aggressive", { size: 2 })).toEqual([]);
  });

  it("후보가 모자라거나 빈 입력이면 빈 배열", () => {
    expect(proposeCombos([], "balanced", { size: 3 })).toEqual([]);
    expect(proposeCombos([cand("KODEX 하나", base)], "balanced", { size: 2 })).toEqual([]);
  });

  it("입력 후보를 변경하지 않는다", () => {
    const pool = [cand("KODEX 가가", base, 80), cand("TIGER 나나나", other1, 70), cand("SOL 다다다", other2, 60)];
    const before = JSON.stringify(pool);
    proposeCombos(pool, "aggressive", { size: 2 });
    expect(JSON.stringify(pool)).toBe(before);
  });
});

describe("roleOf", () => {
  it("자산군별 역할 라벨", () => {
    expect(roleOf(makeEtf({ name: "KODEX 200" }))).toBe("성장(주식)");
    expect(roleOf(makeEtf({ name: "KODEX 국고채10년" }))).toBe("안정(채권)");
    expect(roleOf(makeEtf({ name: "KODEX 머니마켓액티브" }))).toBe("현금성(파킹)");
    expect(roleOf(makeEtf({ name: "iShares Bitcoin Trust ETF", market: "US", tax: { ...makeEtf().tax, assetClass: "crypto", region: "NA" } }))).toBe("대체(가상자산)");
    expect(roleOf(makeEtf({ name: "ACE KRX금현물" }))).toBe("대체(원자재·통화)");
  });
});

import { isComboExcluded, selectPool } from "./portfolio";
import { rankEtfs, DEFAULT_PREFS } from "./scoring";

describe("selectPool", () => {
  it("상위 후보에 없는 자산군의 1위를 분산 수단으로 추가", () => {
    const equities = Array.from({ length: 12 }, (_, i) => makeEtf({ name: `KODEX 주식${String.fromCharCode(65 + i)}${i}테스트`, code: `E${i}`, m: { cagr1y: 0.5 - i * 0.01, cagr3y: 0.4, sharpe1y: 1.5, sharpe3y: 1.5 } }));
    const bond = makeEtf({ name: "KODEX 국고채10년", code: "B1", m: { cagr1y: 0.02, cagr3y: 0.02, vol3y: 0.05, vol1y: 0.05 } });
    const ranked = rankEtfs([...equities, bond], { ...DEFAULT_PREFS, profile: "aggressive", dedupe: false }).ranked;
    const pool = selectPool(ranked, 5);
    expect(pool.slice(0, 5).some((s) => s.etf.code === "B1")).toBe(false); // 채권은 상위 5에 못 듦
    expect(pool.some((s) => s.etf.code === "B1")).toBe(true); // 하지만 풀에는 들어옴
    expect(new Set(pool.map((s) => s.etf.code)).size).toBe(pool.length); // 중복 없음
  });

  it("선물 기반·통화 상품은 분산 수단 후보에서도 제외", () => {
    const equities = Array.from({ length: 6 }, (_, i) => makeEtf({ name: `KODEX 주식${String.fromCharCode(65 + i)}${i}테스트`, code: `E${i}` }));
    const oil = makeEtf({ name: "KODEX WTI원유선물(H)", code: "OIL", m: { vol3y: 0.3, vol1y: 0.3 } });
    const usd = makeEtf({ name: "KODEX 미국달러선물", code: "USD" });
    const gold = makeEtf({ name: "ACE KRX금현물", code: "GOLD" });
    expect(isComboExcluded(oil)).toBe(true);
    expect(isComboExcluded(usd)).toBe(true);
    expect(isComboExcluded(gold)).toBe(false);
    const ranked = rankEtfs([...equities, oil, usd, gold], { ...DEFAULT_PREFS, profile: "aggressive", dedupe: false }).ranked;
    const codes = selectPool(ranked, 3).map((s) => s.etf.code);
    expect(codes).not.toContain("OIL");
    expect(codes).not.toContain("USD");
    expect(codes).toContain("GOLD");
  });
});
