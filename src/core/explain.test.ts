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
    expect(ex.reasons.join(" ")).toMatch(/총보수 연 0\.03%/);
    // 0.03% × 1,000만원 = 3,000원 (과거에 100배 작게 표기되던 버그의 회귀 방지)
    expect(ex.reasons.join(" ")).toMatch(/1,000만원당 연 3,000원/);
    expect(ex.reasons.length).toBeLessThanOrEqual(5);
  });
});

import { explainProposal } from "./explain";
import type { ComboCandidate, Proposal } from "./portfolio";

describe("explainProposal", () => {
  const cand = (name: string): ComboCandidate => ({ etf: makeEtf({ name, code: name }), score: 70, returns: [] });
  const proposal = (over: Partial<Proposal> = {}): Proposal => ({
    members: [{ cand: cand("KODEX 200"), weight: 0.4 }, { cand: cand("KODEX 국고채10년"), weight: 0.6 }],
    stats: { weeks: 156, cagr: 0.1, vol: 0.08, mdd: -0.06, sharpe: 0.6, avgMemberVol: 0.14, diversificationRatio: 1.75 },
    returns: [],
    quality: 70,
    diversification: 100,
    avgOverlap: 2,
    maxOverlap: null,
    score: 80,
    ...over,
  });

  it("역할 분담·변동성 감소·낙폭을 수치로 설명", () => {
    const e = explainProposal(proposal(), () => undefined);
    const text = e.reasons.join(" | ");
    expect(text).toMatch(/성장\(주식\) 40%/);
    expect(text).toMatch(/안정\(채권\) 60%/);
    expect(text).toMatch(/변동성이 8%로/);
    expect(text).toMatch(/약 43% 낮아집니다/); // 1 - 0.08/0.14
    expect(text).toMatch(/최대낙폭 -6%/);
    expect(text).toMatch(/겹침이 평균 2%/);
  });
  it("분산 효과가 없으면 솔직하게 말한다", () => {
    const e = explainProposal(proposal({ stats: { ...proposal().stats, diversificationRatio: 1.01 } }), () => undefined);
    expect(e.reasons.join(" ")).toMatch(/분산 효과는 크지 않습니다/);
  });
  it("겹침 정보가 없으면 주의사항에 안내", () => {
    const e = explainProposal(proposal({ avgOverlap: null }), () => undefined);
    expect(e.cautions.join(" ")).toMatch(/겹침을 확인하지 못했습니다/);
  });
  it("항상 과거 값·리밸런싱 주의를 포함하고 수익을 약속하지 않는다", () => {
    const c = explainProposal(proposal(), () => undefined).cautions.join(" ");
    expect(c).toMatch(/보장이 없습니다/);
    expect(c).toMatch(/리밸런싱/);
    expect(c).toMatch(/수익 예측이 아니라/);
  });
  it("큰 겹침 쌍은 이름과 함께 알려준다", () => {
    const e = explainProposal(proposal({ avgOverlap: 30, maxOverlap: { a: "A", b: "B", pct: 30 } }), (c) => ({ name: `이름-${c}` }));
    expect(e.reasons.join(" ")).toMatch(/이름-A ↔ 이름-B 30%/);
  });
});
