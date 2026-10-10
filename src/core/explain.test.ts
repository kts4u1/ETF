import { describe, expect, it } from "vitest";
import { cautions, explain, riskGrade, taxNote, typeLine } from "./explain";
import { DEFAULT_PREFS, rankEtfs } from "./scoring";
import { makeEtf } from "./test-utils";

describe("riskGrade", () => {
  it("레버리지·인버스는 무조건 5", () => {
    expect(riskGrade(makeEtf({ name: "KODEX 레버리지", m: { vol3y: 0.05 } }))).toBe(5);
    expect(riskGrade(makeEtf({ name: "KODEX 인버스" }))).toBe(5);
  });
  it("변동성 구간별 등급", () => {
    const g = (v: number) => riskGrade(makeEtf({ m: { vol3y: v } }));
    expect([g(0.002), g(0.05), g(0.1), g(0.2), g(0.45)]).toEqual([1, 2, 3, 4, 5]);
  });
  it("변동성 정보가 없으면 자산군으로 추정", () => {
    expect(riskGrade(makeEtf({ name: "KODEX 머니마켓액티브", m: { vol1y: null, vol3y: null } }))).toBe(1);
  });
});

describe("cautions", () => {
  const texts = (name: string, over = {}) => cautions(makeEtf({ name, ...over })).map((c) => c.text).join(" | ");

  it("레버리지는 high 수준 경고", () => {
    const c = cautions(makeEtf({ name: "KODEX 레버리지" }));
    expect(c.some((x) => x.level === "high" && /복리/.test(x.text))).toBe(true);
  });
  it("커버드콜 · 합성 · 액티브 · 환노출/환헤지", () => {
    expect(texts("KODEX 200타겟위클리커버드콜")).toMatch(/상승장에서는 수익이 제한/);
    expect(texts("KODEX 차이나과창판STAR50(합성)")).toMatch(/신용위험/);
    expect(texts("TIGER 코리아테크액티브")).toMatch(/액티브/);
  });
  it("해외 ETF는 환노출 안내, (H)는 환헤지 안내", () => {
    const us = makeEtf({ name: "TIGER 미국S&P500" });
    expect(cautions({ ...us, tax: { ...us.tax, region: "US", assetClass: "global-equity" } }).map((c) => c.text).join()).toMatch(/환율에 따라/);
    const h = makeEtf({ name: "KODEX 미국S&P500(H)" });
    expect(cautions(h).map((c) => c.text).join()).toMatch(/환헤지\(H\)/);
  });
  it("상장 기간·규모·거래대금·괴리율·급등 경고", () => {
    const young = makeEtf({ m: { ret: { m1: 0, m3: 0, m6: 0, y1: null, y3: null, y5: null }, years: 0.4 } });
    expect(cautions(young).map((c) => c.text).join()).toMatch(/상장 5개월/);
    expect(texts("KODEX 소형", { aumEok: 120 })).toMatch(/순자산 120억/);
    expect(texts("KODEX 한산", { m: { avgValue20: 5e7 } })).toMatch(/거래대금/);
    expect(texts("KODEX 괴리", { navGap: 1.8 })).toMatch(/괴리율/);
    expect(texts("KODEX 급등", { m: { ret: { m1: 0, m3: 0, m6: 0, y1: 1.5, y3: null, y5: null } } })).toMatch(/급등/);
  });
  it("평범한 ETF는 불필요한 high 경고가 없다", () => {
    expect(cautions(makeEtf()).some((c) => c.level === "high")).toBe(false);
  });
});

describe("typeLine / taxNote", () => {
  it("지수형 / 테마형 표기", () => {
    expect(typeLine(makeEtf({ name: "TIGER 미국S&P500" }))).toBe("미국 주식 · S&P500 지수");
    expect(typeLine(makeEtf({ name: "KODEX 반도체" }))).toBe("한국 주식 · 반도체 테마");
    expect(typeLine(makeEtf({ name: "KODEX 머니마켓액티브" }))).toContain("현금성");
  });
  it("국내 주식형만 매매차익 비과세 안내", () => {
    expect(taxNote(makeEtf({ name: "KODEX 200" }))).toMatch(/매매차익에 세금이 없고/);
    expect(taxNote(makeEtf({ name: "KODEX 레버리지" }))).toMatch(/배당소득세/);
    expect(taxNote(makeEtf({ name: "TIGER 미국S&P500" }))).toMatch(/금융소득종합과세/);
  });
});

describe("explain", () => {
  it("추천 사유는 사실 기반이고 헤드라인에 성향·기간·점수가 들어간다", () => {
    const top = makeEtf({
      name: "KODEX 우량ETF",
      fee: 0.03,
      aumEok: 30_000,
      m: { cagr1y: 0.5, cagr3y: 0.4, sharpe3y: 1.8, sharpe1y: 1.5, avgValue20: 5e10, mom12_1: 0.5, trend200: 0.3 },
    });
    const others = [makeEtf({ name: "KODEX 보통A" }), makeEtf({ name: "KODEX 보통B", code: "B", fee: 0.5 })];
    const r = rankEtfs([top, ...others], DEFAULT_PREFS);
    const ex = explain(r.ranked[0]!, DEFAULT_PREFS);
    expect(ex.headline).toMatch(/중립형 · 1~3년 기준 종합 \d+점/);
    expect(ex.reasons.length).toBeGreaterThan(0);
    expect(ex.reasons.join(" ")).toMatch(/총보수 연 0.03%/);
    expect(ex.reasons.length).toBeLessThanOrEqual(5);
  });
});
