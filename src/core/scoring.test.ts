import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  FACTOR_KEYS,
  HORIZONS,
  PROFILES,
  checkEligibility,
  costScore,
  diversify,
  effectiveWeights,
  percentileRanks,
  rankEtfs,
  sameGroup,
  trustScore,
  youngPenalty,
} from "./scoring";
import { makeEtf } from "./test-utils";

describe("percentileRanks", () => {
  it("오름차순 순위를 0~100 으로", () => {
    expect(percentileRanks([10, 30, 20])).toEqual([0, 100, 50]);
  });
  it("동점은 평균 순위, null 은 그대로", () => {
    expect(percentileRanks([1, 1, 3, null])).toEqual([25, 25, 100, null]);
  });
  it("값이 하나면 50, 전부 null 이면 전부 null", () => {
    expect(percentileRanks([5, null])).toEqual([50, null]);
    expect(percentileRanks([null, null])).toEqual([null, null]);
  });
  it("이상치에 강건: 극단값이 있어도 순위만 본다", () => {
    expect(percentileRanks([1, 2, 1_000_000])).toEqual([0, 50, 100]);
  });
});

describe("effectiveWeights", () => {
  it("모든 조합에서 합이 1", () => {
    for (const p of Object.keys(PROFILES) as (keyof typeof PROFILES)[])
      for (const h of Object.keys(HORIZONS) as (keyof typeof HORIZONS)[]) {
        const w = effectiveWeights(p, h);
        expect(FACTOR_KEYS.reduce((s, k) => s + w[k], 0)).toBeCloseTo(1, 10);
      }
  });
  it("단기는 추세 비중↑ 비용↓, 장기는 반대", () => {
    const s = effectiveWeights("balanced", "short");
    const m = effectiveWeights("balanced", "mid");
    const l = effectiveWeights("balanced", "long");
    expect(s.trend).toBeGreaterThan(m.trend);
    expect(l.trend).toBeLessThan(m.trend);
    expect(l.cost).toBeGreaterThan(m.cost);
    expect(s.cost).toBeLessThan(m.cost);
  });
  it("공격형은 수익성, 안정형은 안정성 비중이 가장 크다", () => {
    expect(effectiveWeights("aggressive", "mid").ret).toBeGreaterThan(effectiveWeights("stable", "mid").ret);
    expect(effectiveWeights("stable", "mid").safety).toBeGreaterThan(effectiveWeights("aggressive", "mid").safety);
  });
});

describe("checkEligibility", () => {
  const p = DEFAULT_PREFS;
  const why = (e: ReturnType<typeof makeEtf>, prefs: typeof p) => checkEligibility(e, prefs)?.reason ?? null;
  const codeOf = (e: ReturnType<typeof makeEtf>, prefs: typeof p) => checkEligibility(e, prefs)?.code ?? null;
  it("정상 ETF 통과", () => expect(why(makeEtf(), p)).toBeNull());
  it("레버리지·인버스는 기본 제외, 옵션으로 포함", () => {
    const lev = makeEtf({ name: "KODEX 레버리지" });
    expect(why(lev, p)).toMatch(/레버리지/);
    expect(why(lev, { ...p, includeLeveraged: true, profile: "aggressive" })).toBeNull();
    expect(why(makeEtf({ name: "KODEX 인버스" }), p)).toMatch(/레버리지·인버스/);
  });
  it("커버드콜 제외 옵션", () => {
    const cc = makeEtf({ name: "KODEX 200타겟위클리커버드콜" });
    expect(why(cc, p)).toBeNull();
    expect(why(cc, { ...p, includeCoveredCall: false })).toMatch(/커버드콜/);
  });
  it("순자산 미달", () => {
    expect(why(makeEtf({ aumEok: 120 }), p)).toMatch(/순자산 120억원/);
    expect(why(makeEtf({ aumEok: 120 }), { ...p, minAumEok: 100 })).toBeNull();
  });
  it("거래대금 부족 / 거래대금 정보 없음", () => {
    expect(why(makeEtf({ m: { avgValue20: 1e8 } }), p)).toMatch(/거래대금/);
    expect(why(makeEtf({ m: { avgValue20: null } }), p)).toMatch(/거래대금/);
  });
  it("상장 1년 미만은 기본 제외, includeYoung 이면 3개월 이상만 허용", () => {
    const young = makeEtf({ m: { ret: { m1: 0, m3: 0.02, m6: 0.04, y1: null, y3: null, y5: null }, years: 0.5 } });
    expect(why(young, p)).toMatch(/1년 미만/);
    expect(why(young, { ...p, includeYoung: true })).toBeNull();
    const tooYoung = makeEtf({ m: { ret: { m1: 0, m3: null, m6: null, y1: null, y3: null, y5: null }, years: 0.1 } });
    expect(why(tooYoung, { ...p, includeYoung: true })).toMatch(/3개월 미만/);
  });
  it("총보수 상한", () => {
    expect(why(makeEtf({ fee: 0.9 }), { ...p, maxFee: 0.5 })).toMatch(/총보수/);
    expect(why(makeEtf({ fee: 0.3 }), { ...p, maxFee: 0.5 })).toBeNull();
  });
  it("상장 시장 필터: 기본은 전체, 선택한 시장이 아니면 제외하고 사유 코드는 market", () => {
    const kr = makeEtf();
    const us = makeEtf({ code: "SPY", name: "SPDR S&P 500 ETF Trust", market: "US" });
    expect(p.market).toBe("all");
    expect(why(kr, p)).toBeNull();
    expect(why(us, p)).toBeNull();
    expect(codeOf(us, { ...p, market: "KR" })).toBe("market");
    expect(why(us, { ...p, market: "KR" })).toMatch(/해외\(미국\) 상장 ETF.*국내 상장/);
    expect(codeOf(kr, { ...p, market: "US" })).toBe("market");
    expect(why(us, { ...p, market: "US" })).toBeNull();
    // market 필드가 없는 이전 스냅샷 레코드는 국내로 취급한다
    expect(why(makeEtf(), { ...p, market: "KR" })).toBeNull();
  });
  it("시장 필터는 다른 게이트보다 먼저 적용된다(사유가 시장으로 보고됨)", () => {
    const smallUs = makeEtf({ market: "US", aumEok: 10 });
    expect(codeOf(smallUs, { ...p, market: "KR" })).toBe("market");
    expect(codeOf(smallUs, { ...p, market: "US" })).toBe("small-aum");
  });
  it("자산군 필터", () => {
    expect(why(makeEtf({ name: "KODEX 국고채10년" }), { ...p, assetClasses: ["kr-equity"] })).toMatch(/자산군/);
  });
  it("투자 성향별 위험 한도: 안정형 15%, 중립형 30% 초과 변동성은 제외", () => {
    const risky = makeEtf({ m: { vol3y: 0.25 } });
    expect(why(risky, { ...p, profile: "stable" })).toMatch(/안정형 한도/);
    expect(why(risky, { ...p, profile: "balanced" })).toBeNull();
    expect(why(makeEtf({ m: { vol3y: 0.35 } }), { ...p, profile: "balanced" })).toMatch(/중립형 한도/);
    expect(why(makeEtf({ m: { vol3y: 0.9, mdd3y: -0.9 } }), { ...p, profile: "aggressive" })).toBeNull();
  });
  it("3년 지표가 없으면 1년 지표로 한도를 판단", () => {
    const e = makeEtf({ m: { vol3y: null, vol1y: 0.5 } });
    expect(why(e, { ...p, profile: "balanced" })).toMatch(/변동성/);
  });
  it("제외 사유 코드", () => {
    expect(codeOf(makeEtf({ name: "KODEX 인버스" }), p)).toBe("leveraged");
    expect(codeOf(makeEtf({ aumEok: 10 }), p)).toBe("small-aum");
    expect(codeOf(makeEtf({ m: { avgValue20: 1 } }), p)).toBe("low-liquidity");
    expect(codeOf(makeEtf({ m: { vol3y: 0.9 } }), { ...p, profile: "stable" })).toBe("risk-limit");
    expect(codeOf(makeEtf(), p)).toBeNull();
  });
});

describe("점수 구성요소", () => {
  it("costScore: 낮을수록 높고, 0.7% 이상이면 0점, 모르면 50", () => {
    expect(costScore(0)).toBe(100);
    expect(costScore(0.35)).toBeCloseTo(50);
    expect(costScore(1.2)).toBe(0);
    expect(costScore(null)).toBe(50);
    expect(costScore(0.05)).toBeGreaterThan(costScore(0.15));
  });
  it("trustScore: 규모·거래대금이 클수록 높고 0~100 범위", () => {
    expect(trustScore(300, 3e8)).toBeCloseTo(0);
    expect(trustScore(10_000, 1e10)).toBeCloseTo(100);
    expect(trustScore(1e6, 1e13)).toBeLessThanOrEqual(100);
    expect(trustScore(2000, 5e9)).toBeGreaterThan(trustScore(500, 5e8));
  });
  it("youngPenalty: 3년 이상 0, 짧을수록 커진다", () => {
    expect(youngPenalty(3)).toBe(0);
    expect(youngPenalty(5)).toBe(0);
    expect(youngPenalty(1)).toBeGreaterThan(youngPenalty(2));
    expect(youngPenalty(0)).toBeLessThanOrEqual(8);
  });
});

describe("rankEtfs", () => {
  const strong = makeEtf({
    name: "KODEX 강한ETF",
    m: { cagr1y: 0.4, cagr3y: 0.35, cagr5y: 0.3, sharpe1y: 1.6, sharpe3y: 1.5, mom12_1: 0.35, ret: { m1: 0.03, m3: 0.1, m6: 0.2, y1: 0.4, y3: 1.4, y5: 3.0 }, trend200: 0.2 },
  });
  const weak = makeEtf({
    name: "KODEX 약한ETF",
    m: { cagr1y: -0.1, cagr3y: -0.05, cagr5y: 0, sharpe1y: -0.5, sharpe3y: -0.3, mom12_1: -0.1, ret: { m1: -0.03, m3: -0.05, m6: -0.08, y1: -0.1, y3: -0.14, y5: 0 }, trend200: -0.1 },
  });
  const mid = makeEtf({ name: "KODEX 보통ETF" });

  it("성과가 좋은 ETF가 위에 온다", () => {
    const r = rankEtfs([weak, mid, strong], DEFAULT_PREFS);
    expect(r.ranked.map((s) => s.etf.name)).toEqual(["KODEX 강한ETF", "KODEX 보통ETF", "KODEX 약한ETF"]);
    expect(r.ranked[0]!.score).toBeGreaterThan(r.ranked[2]!.score);
  });

  it("제외된 ETF는 사유와 함께 excluded 로 간다", () => {
    const small = makeEtf({ name: "KODEX 소형ETF", aumEok: 50 });
    const r = rankEtfs([strong, small], DEFAULT_PREFS);
    expect(r.ranked).toHaveLength(1);
    expect(r.excluded).toHaveLength(1);
    expect(r.excluded[0]!.etf.name).toBe("KODEX 소형ETF");
    expect(r.excluded[0]!.reason).toMatch(/순자산/);
    expect(r.universeSize).toBe(1);
  });

  it("같은 지수 ETF는 대표 하나만 남기고 나머지는 대안으로", () => {
    const cheap = makeEtf({ name: "TIGER 미국S&P500", code: "A", fee: 0.0099 });
    const pricey = makeEtf({ name: "KODEX 미국S&P500", code: "B", fee: 0.05 });
    const other = makeEtf({ name: "SOL 미국S&P500", code: "C", fee: 0.15 });
    const r = rankEtfs([pricey, other, cheap, mid], DEFAULT_PREFS);
    const rep = r.ranked.find((s) => s.etf.tax.groupKey === cheap.tax.groupKey)!;
    expect(rep.etf.code).toBe("A"); // 다른 조건이 같으면 비용 점수가 높은 쪽
    expect(rep.groupRank).toBe(1);
    expect(rep.groupSize).toBe(3);
    expect(rep.alternatives.sort()).toEqual(["B", "C"]);
    expect(r.ranked).toHaveLength(2);
  });

  it("dedupe=false 면 모두 노출", () => {
    const a = makeEtf({ name: "TIGER 미국S&P500", code: "A" });
    const b = makeEtf({ name: "KODEX 미국S&P500", code: "B" });
    expect(rankEtfs([a, b], { ...DEFAULT_PREFS, dedupe: false }).ranked).toHaveLength(2);
  });

  it("점수가 같으면 총보수가 낮은 쪽이 먼저", () => {
    const a = makeEtf({ name: "KODEX A테스트", code: "A", fee: 0.4 });
    const b = makeEtf({ name: "KODEX B테스트", code: "B", fee: 0.1 });
    const r = rankEtfs([a, b], { ...DEFAULT_PREFS, dedupe: false });
    expect(r.ranked[0]!.etf.code).toBe("B");
  });

  it("레버리지는 옵션을 켜야 후보에 들어온다", () => {
    const lev = makeEtf({ name: "KODEX 코스닥150레버리지", m: { vol3y: 0.9, mdd3y: -0.7 } });
    expect(rankEtfs([strong, lev], { ...DEFAULT_PREFS, profile: "aggressive" }).ranked.map((s) => s.etf.name)).not.toContain(lev.name);
    expect(
      rankEtfs([strong, lev], { ...DEFAULT_PREFS, profile: "aggressive", includeLeveraged: true }).ranked.map((s) => s.etf.name),
    ).toContain(lev.name);
  });

  it("상장 3년 미만은 감점된다", () => {
    const young = makeEtf({ name: "KODEX 신생ETF", m: { years: 1.2 } });
    const old = makeEtf({ name: "KODEX 노련ETF", m: { years: 6 } });
    const r = rankEtfs([young, old], { ...DEFAULT_PREFS, dedupe: false });
    const y = r.ranked.find((s) => s.etf.name === young.name)!;
    expect(y.youngPenalty).toBeGreaterThan(0);
    expect(r.ranked[0]!.etf.name).toBe(old.name);
  });

  it("점수는 0~100 범위", () => {
    const r = rankEtfs([strong, weak, mid], DEFAULT_PREFS);
    for (const s of r.ranked) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
  });

  it("빈 입력도 안전", () => {
    const r = rankEtfs([], DEFAULT_PREFS);
    expect(r.ranked).toEqual([]);
    expect(r.universeSize).toBe(0);
  });

  it("입력 배열을 변경하지 않는다", () => {
    const input = [strong, weak, mid];
    const copy = JSON.stringify(input);
    rankEtfs(input, DEFAULT_PREFS);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe("diversify", () => {
  it("같은 (자산군, 테마) 는 perBucket 개까지만", () => {
    const etfs = ["A", "B", "C", "D"].map((c) => makeEtf({ name: `KODEX 반도체${c}`, code: c }));
    // 이름이 달라 groupKey 는 다르지만 테마는 모두 '반도체'
    const r = rankEtfs(etfs, DEFAULT_PREFS);
    const div = diversify(r.ranked, 10, 2);
    expect(div.filter((s) => s.etf.tax.theme === "반도체")).toHaveLength(2);
  });
  it("limit 를 지킨다", () => {
    const etfs = Array.from({ length: 12 }, (_, i) => makeEtf({ name: `KODEX 종목${String.fromCharCode(65 + i)}${i}테스트`, code: `X${i}` }));
    expect(diversify(rankEtfs(etfs, DEFAULT_PREFS).ranked, 5)).toHaveLength(5);
  });
});

describe("sameGroup", () => {
  it("제외 여부와 무관하게 같은 지수 ETF를 순자산 큰 순으로", () => {
    const a = makeEtf({ name: "TIGER 미국S&P500", code: "A", aumEok: 100 });
    const b = makeEtf({ name: "KODEX 미국S&P500", code: "B", aumEok: 9000 });
    const c = makeEtf({ name: "KODEX 200", code: "C" });
    expect(sameGroup([a, b, c], a).map((e) => e.code)).toEqual(["B", "A"]);
  });
});
