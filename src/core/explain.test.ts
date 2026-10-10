import { describe, expect, it } from "vitest";
import { ASSET_CLASS_LABEL, TAG_LABEL, cautions, explain, explainProposal, riskGrade, structureNotes, taxNote, typeLine } from "./explain";
import type { ComboCandidate, Proposal } from "./portfolio";
import { DEFAULT_PREFS, rankEtfs } from "./scoring";
import { makeEtf } from "./test-utils";
import type { EtfRecord, Scored, Taxonomy } from "./types";

/** 해외(미국) 상장 ETF 테스트 레코드. 분류는 해외 분류기가 채우는 값과 같은 모양으로 직접 지정한다. */
const usTax = (over: Partial<Taxonomy> = {}): Taxonomy => ({
  assetClass: "global-equity",
  region: "US",
  theme: "S&P500",
  broad: true,
  tags: [],
  leverage: 1,
  brand: "SPDR",
  groupKey: "us:sp500",
  ...over,
});
const makeUs = (over: Omit<Partial<EtfRecord>, "m" | "tax"> & { m?: Partial<EtfRecord["m"]>; tax?: Partial<Taxonomy> } = {}): EtfRecord => {
  const { tax, ...rest } = over;
  return makeEtf({ code: "SPY", name: "SPDR S&P 500 ETF Trust", market: "US", exchange: "NYSE Arca", priceNative: 543.2, price: 760_000, aumEok: 900_000, tax: usTax(tax), ...rest });
};
const joined = (e: EtfRecord) => cautions(e).map((c) => c.text).join(" | ");

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
  it("가상자산·변동성(VIX) 상품은 변동성 정보가 없어도 5등급, 있으면 변동성 구간을 따른다", () => {
    const noVol = { vol1y: null, vol3y: null };
    expect(riskGrade(makeUs({ name: "Bitcoin ETF", tax: { assetClass: "crypto", region: "GLOBAL", theme: "비트코인", broad: false }, m: noVol }))).toBe(5);
    expect(riskGrade(makeUs({ name: "VIX Futures ETF", tax: { assetClass: "global-equity", theme: "변동성", tags: ["volatility"] }, m: noVol }))).toBe(5);
    expect(riskGrade(makeUs({ name: "Bitcoin ETF", tax: { assetClass: "crypto" }, m: { vol3y: 0.55 } }))).toBe(5);
    // 버퍼 ETF 는 변동성이 낮으면 낮은 등급
    expect(riskGrade(makeUs({ name: "Buffer ETF", tax: { tags: ["defined-outcome"] }, m: { vol3y: 0.1 } }))).toBe(3);
    // 기존 추정은 그대로
    expect(riskGrade(makeUs({ m: noVol }))).toBe(4);
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
  it("국내 상장 ETF에는 해외 상장 전용 안내(양도소득세·환전·거래시간)가 붙지 않는다", () => {
    expect(texts("TIGER 미국S&P500")).not.toMatch(/양도소득세|환전|한국 시간 밤/);
    expect(texts("KODEX 200")).not.toMatch(/양도소득세/);
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

describe("해외(미국) 상장 ETF 주의사항", () => {
  it("환율이 수익·위험에 그대로 반영됨, 세금, 환전·거래시간, 데이터 미제공을 info 수준으로 안내한다", () => {
    const c = cautions(makeUs());
    const t = c.map((x) => x.text).join(" | ");
    expect(t).toMatch(/원화 환산 기준이라 원\/달러 환율 변동이 수익률·변동성·최대낙폭에 그대로 반영/);
    expect(t).toMatch(/현행 기준으로 매매차익에는 양도소득세\(연 250만원 공제 후 22%\)/);
    expect(t).toMatch(/분배금에는 배당소득세/);
    expect(t).toMatch(/환전이 필요/);
    expect(t).toMatch(/한국 시간 밤/);
    expect(t).toMatch(/괴리율과 구성종목 겹침은 해외 상장 ETF에는 제공하지 않습니다/);
    // 구조적 위험이 없는 평범한 해외 ETF 에서는 high 가 없고, 이 안내들은 info 다
    expect(c.some((x) => x.level === "high")).toBe(false);
    expect(c.filter((x) => /환율|양도소득세|환전|겹침/.test(x.text)).every((x) => x.level === "info")).toBe(true);
  });
  it("세율은 현행 기준이라고 밝히며 단정하지 않는다", () => {
    const tax = cautions(makeUs()).find((x) => /양도소득세/.test(x.text))!;
    expect(tax.text).toMatch(/현행 기준/);
    expect(tax.text).toMatch(/세법은 바뀔 수 있/);
    expect(taxNote(makeUs())).toMatch(/현행 기준/);
  });
  it("환율 안내는 한 번만 나오고, 국내용 '환헤지가 없는 상품은…' 문장과 겹치지 않는다", () => {
    const c = cautions(makeUs());
    expect(c.filter((x) => /환율/.test(x.text))).toHaveLength(1);
    expect(joined(makeUs())).not.toMatch(/환헤지가 없는 상품은/);
  });
  it("지역을 모르거나 현금성·통화·가상자산·원자재여도 항상 환율에 노출된다고 안내한다", () => {
    for (const tax of [{ region: "NA" as const }, { assetClass: "cash" as const }, { assetClass: "fx" as const, region: "NA" as const }, { assetClass: "crypto" as const, region: "GLOBAL" as const }, { assetClass: "commodity" as const, region: "NA" as const }]) {
      expect(joined(makeUs({ tax })), JSON.stringify(tax)).toMatch(/원\/달러 환율 변동이/);
    }
  });
  it("통화 헤지 표기가 있어도 원화 기준 환노출이라고 밝히고 국내 환헤지 설명을 쓰지 않는다", () => {
    const e = makeUs({ tax: { tags: ["hedged"] } });
    expect(joined(e)).not.toMatch(/환헤지\(H\) 상품은 환율 변동은 줄이지만/);
    expect(joined(e)).toMatch(/원\/달러 환율 변동이/);
    expect(structureNotes(e).join(" ")).toMatch(/원\/달러 환율 영향은 그대로 받습니다/);
  });
  it("국내 상장 환노출 안내와 환헤지(H) 안내는 그대로 유지된다", () => {
    const us = makeEtf({ name: "TIGER 미국S&P500" });
    expect(joined({ ...us, tax: { ...us.tax, region: "US", assetClass: "global-equity" } })).toMatch(/환헤지가 없는 상품은 원\/외화 환율에 따라/);
    expect(joined(makeEtf({ name: "KODEX 미국S&P500(H)" }))).toMatch(/환헤지\(H\) 상품은 환율 변동은 줄이지만/);
  });
  it("레버리지 해외 ETF 는 high 경고와 해외 안내가 함께 나온다", () => {
    const c = cautions(makeUs({ name: "ProShares UltraPro QQQ", tax: { tags: ["leveraged"], leverage: 3, theme: "나스닥100" } }));
    expect(c.some((x) => x.level === "high" && /복리/.test(x.text))).toBe(true);
    expect(c.some((x) => /양도소득세/.test(x.text))).toBe(true);
  });
  it("구조 설명에 거래소와 원화 환산 사실이 들어간다", () => {
    const n = structureNotes(makeUs()).join(" ");
    expect(n).toMatch(/미국\(NYSE Arca\) 시장에 상장되어 달러로 거래/);
    expect(n).toMatch(/원화로 환산한 값/);
    expect(structureNotes(makeUs({ exchange: null })).join(" ")).toMatch(/^미국 시장에 상장/);
    expect(structureNotes(makeEtf({ name: "KODEX 200" })).join(" ")).not.toMatch(/달러/);
  });
  it("세금 설명은 해외 상장이면 양도소득세를, 국내 상장이면 기존 문장을 쓴다", () => {
    expect(taxNote(makeUs())).toMatch(/양도소득세\(연 250만원 공제 후 22%\)/);
    expect(taxNote(makeEtf({ name: "KODEX 200" }))).toMatch(/매매차익에 세금이 없고/);
    expect(taxNote(makeEtf({ name: "TIGER 미국S&P500" }))).toMatch(/금융소득종합과세/);
  });
  it("추천 사유의 수익성 근거에 원화 환산 기준임을 밝힌다", () => {
    const s = (etf: EtfRecord): Scored => ({ etf, score: 80, factors: { ret: 90, eff: 0, safety: 0, trend: 0, cost: 0, trust: 0 }, youngPenalty: 0, groupRank: 1, groupSize: 1, alternatives: [] });
    expect(explain(s(makeUs()), DEFAULT_PREFS).reasons.join(" ")).toMatch(/분배금 보정·원화 환산 시세 기준/);
    expect(explain(s(makeEtf({ name: "KODEX 200" })), DEFAULT_PREFS).reasons.join(" ")).toMatch(/분배금 보정 시세 기준/);
  });
});

describe("새 구조 태그와 가상자산", () => {
  it("모든 태그·자산군에 화면 이름이 있다", () => {
    expect(TAG_LABEL["defined-outcome"]).toBe("버퍼·목표수익");
    expect(TAG_LABEL.volatility).toBe("변동성(VIX)");
    expect(ASSET_CLASS_LABEL.crypto).toBe("가상자산");
  });
  it("변동성(VIX) 상품은 장기 보유 시 가치가 줄어드는 경향을 high 로 경고한다", () => {
    const c = cautions(makeUs({ name: "ProShares VIX Short-Term Futures", tax: { tags: ["volatility"], theme: "변동성", broad: false } }));
    const v = c.find((x) => /VIX/.test(x.text));
    expect(v?.level).toBe("high");
    expect(v?.text).toMatch(/장기 보유할수록 가치가 줄어드는 경향/);
    expect(structureNotes(makeUs({ tax: { tags: ["volatility"] } })).join(" ")).toMatch(/VIX/);
  });
  it("버퍼(목표수익) ETF 는 상승 제한과 기간 중간 매수 시 조건 변화를 warn 으로 안내한다", () => {
    const c = cautions(makeUs({ name: "Innovator U.S. Equity Power Buffer ETF", tax: { tags: ["defined-outcome"], theme: "버퍼", broad: false } }));
    const b = c.find((x) => /상승폭이 제한/.test(x.text));
    expect(b?.level).toBe("warn");
    expect(b?.text).toMatch(/기간 중간에 사면/);
    expect(structureNotes(makeUs({ tax: { tags: ["defined-outcome"] } })).join(" ")).toMatch(/상승폭에 상한/);
  });
  it("가상자산은 가격 변동이 매우 크다고 경고하고, 수치는 데이터에서 가져온다", () => {
    const e = makeUs({ name: "iShares Bitcoin Trust", tax: { assetClass: "crypto", region: "GLOBAL", theme: "비트코인", broad: false }, m: { vol3y: 0.55, mdd3y: -0.48 } });
    const c = cautions(e).find((x) => /가상자산은 가격 변동이 매우 큰/.test(x.text));
    expect(c?.level).toBe("warn");
    expect(c?.text).toMatch(/연 변동성 55%, 최대낙폭 -48%/);
    // 지표가 없으면 수치 없이 경고만
    const bare = cautions(makeUs({ tax: { assetClass: "crypto" }, m: { vol1y: null, vol3y: null, mdd1y: null, mdd3y: null, mddAll: null } })).find((x) => /가상자산은/.test(x.text));
    expect(bare?.text).not.toMatch(/연 변동성/);
    expect(structureNotes(e).join(" ")).toMatch(/가상자산의 가격을 따라가도록/);
  });
  it("가상자산이 아닌 ETF 에는 가상자산 경고가 없다", () => {
    expect(joined(makeUs())).not.toMatch(/가상자산/);
  });
  it("typeLine 은 가상자산·지역 미상 해외 주식을 어색하지 않게 표기한다", () => {
    expect(typeLine(makeUs({ tax: { assetClass: "crypto", region: "GLOBAL", theme: "비트코인", broad: false } }))).toBe("가상자산 · 비트코인 테마");
    expect(typeLine(makeUs({ tax: { assetClass: "global-equity", region: "NA", theme: "AI", broad: false } }))).toBe("해외 주식 · AI 테마");
    expect(typeLine(makeUs())).toBe("미국 주식 · S&P500 지수");
  });
});

describe("explainProposal 해외 상장 포함", () => {
  const cand = (e: EtfRecord): ComboCandidate => ({ etf: e, score: 70, returns: [] });
  const proposal = (members: EtfRecord[], over: Partial<Proposal> = {}): Proposal => ({
    members: members.map((e, i) => ({ cand: cand(e), weight: i === 0 ? 0.6 : 0.4 })),
    stats: { weeks: 156, cagr: 0.1, vol: 0.08, mdd: -0.06, sharpe: 0.6, avgMemberVol: 0.14, diversificationRatio: 1.75 },
    returns: [],
    quality: 70,
    diversification: 100,
    avgOverlap: null,
    maxOverlap: null,
    score: 80,
    ...over,
  });
  const kr = makeEtf({ name: "KODEX 200", code: "069500" });
  const us = makeUs();

  it("해외 상장이 섞이면 겹침을 못 구한 이유와 환율·세금 차이를 주의사항에 적는다", () => {
    const c = explainProposal(proposal([kr, us]), () => undefined).cautions.join(" | ");
    expect(c).toMatch(/해외 상장 ETF는 구성종목 정보가 없어 겹침을 확인하지 못했습니다/);
    expect(c).toMatch(/환율 변동이 조합의 수익·낙폭에 반영/);
    expect(c).toMatch(/양도소득세·환전·거래시간이 국내 상장 ETF와 다릅니다/);
  });
  it("국내 ETF끼리 겹침을 계산했어도 해외 ETF 는 그 수치에 빠졌다고 밝힌다", () => {
    const kr2 = makeEtf({ name: "KODEX 국고채10년", code: "148070" });
    const e = explainProposal(proposal([kr, kr2, us], { avgOverlap: 3 }), () => undefined);
    expect(e.cautions.join(" | ")).toMatch(/SPDR S&P 500 ETF Trust\)는 구성종목 정보가 없어 위 겹침 수치에 포함되지 않았습니다/);
  });
  it("국내 ETF만이면 해외 안내가 없고 기존 문장을 쓴다", () => {
    const kr2 = makeEtf({ name: "KODEX 국고채10년", code: "148070" });
    const c = explainProposal(proposal([kr, kr2]), () => undefined).cautions.join(" | ");
    expect(c).toMatch(/일부 ETF는 구성종목 정보가 없어\(레버리지·합성 등\) 겹침을 확인하지 못했습니다/);
    expect(c).not.toMatch(/해외 상장/);
  });
});
