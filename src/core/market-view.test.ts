import { describe, expect, it } from "vitest";
import { US_MIN_AUM_EOK, US_MIN_AVG_VALUE_WON } from "./market";
import {
  AUM_FUND_NOTE,
  MARKET_FILTERS,
  MARKET_FILTER_LABEL,
  aumText,
  countByMarket,
  describeCounts,
  isMarketFilter,
  listingLine,
  matchRank,
  matchesQuery,
  mergeSavedPrefs,
  summarizeExclusions,
  usCollectionRule,
} from "./market-view";
import { DEFAULT_PREFS, checkEligibility, rankEtfs } from "./scoring";
import { makeEtf } from "./test-utils";
import type { EtfRecord, Taxonomy } from "./types";

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
const makeUs = (code: string, name: string, over: Partial<EtfRecord> = {}): EtfRecord =>
  makeEtf({ code, name, market: "US", exchange: "NYSE Arca", category: "Large Blend", priceNative: 543.2, price: 760_000, aumEok: 900_000, tax: usTax(), ...over });

describe("시장 필터", () => {
  it("세 가지 선택에 모두 표시 이름이 있다", () => {
    expect(MARKET_FILTERS).toEqual(["all", "KR", "US"]);
    expect(MARKET_FILTER_LABEL).toEqual({ all: "전체", KR: "국내 상장", US: "해외(미국) 상장" });
    expect(isMarketFilter("US")).toBe(true);
    expect(isMarketFilter("JP")).toBe(false);
    expect(isMarketFilter(undefined)).toBe(false);
  });

  it("market 필드가 없던 예전 저장 설정은 기본값(전체)으로 복원한다", () => {
    const old = { profile: "stable", minAumEok: 1000, assetClasses: ["bond"] };
    const p = mergeSavedPrefs(old);
    expect(p.market).toBe("all");
    expect(p.profile).toBe("stable");
    expect(p.minAumEok).toBe(1000);
    expect(p.assetClasses).toEqual(["bond"]);
  });
  it("저장된 시장 선택은 유지하고, 손상된 값·형식은 기본값으로 막는다", () => {
    expect(mergeSavedPrefs({ market: "US" }).market).toBe("US");
    expect(mergeSavedPrefs({ market: "KR" }).market).toBe("KR");
    expect(mergeSavedPrefs({ market: "XX" }).market).toBe("all");
    expect(mergeSavedPrefs({ market: 3 }).market).toBe("all");
    expect(mergeSavedPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(mergeSavedPrefs("garbage")).toEqual(DEFAULT_PREFS);
    expect(mergeSavedPrefs([1, 2])).toEqual(DEFAULT_PREFS);
  });

  it("시장 필터가 추천 후보와 제외 사유에 반영된다(복원한 설정으로 실제 동작 확인)", () => {
    const kr = makeEtf({ name: "KODEX 국내", code: "069500" });
    const us = makeUs("SPY", "SPDR S&P 500 ETF Trust");
    const onlyUs = rankEtfs([kr, us], mergeSavedPrefs({ market: "US" }));
    expect(onlyUs.ranked.map((s) => s.etf.code)).toEqual(["SPY"]);
    expect(onlyUs.excluded.map((x) => [x.etf.code, x.code])).toEqual([["069500", "market"]]);
    const all = rankEtfs([kr, us], mergeSavedPrefs({}));
    expect(all.ranked).toHaveLength(2);
    expect(checkEligibility(us, mergeSavedPrefs({ market: "KR" }))?.code).toBe("market");
  });
});

describe("시장별 개수", () => {
  it("market 이 없는 레코드는 국내로 센다", () => {
    const etfs = [makeEtf({ name: "KODEX A", code: "A" }), makeEtf({ name: "KODEX B", code: "B", market: "KR" }), makeUs("SPY", "SPDR"), makeUs("QQQ", "Invesco")];
    expect(countByMarket(etfs)).toEqual({ KR: 2, US: 2 });
    expect(countByMarket([])).toEqual({ KR: 0, US: 0 });
  });
  it("문구에는 계산한 개수만 쓰고, 0개인 시장은 말하지 않는다", () => {
    expect(describeCounts({ KR: 1172, US: 0 })).toBe("국내 상장 ETF 1,172개");
    expect(describeCounts({ KR: 1172, US: 1204 })).toBe("국내 상장 ETF 1,172개와 해외(미국) 상장 ETF 1,204개");
    expect(describeCounts({ KR: 0, US: 5 })).toBe("해외(미국) 상장 ETF 5개");
    expect(describeCounts({ KR: 0, US: 0 })).toBe("ETF 0개");
  });
});

describe("수집 기준 안내", () => {
  it("순자산·거래대금 숫자를 계약 상수에서 계산한다", () => {
    expect(US_MIN_AUM_EOK).toBe(5000);
    expect(US_MIN_AVG_VALUE_WON).toBe(1e9);
    expect(usCollectionRule()).toBe("해외(미국) 상장은 순자산 5,000억원·일평균 거래대금 10억원 이상만 수집합니다");
  });
});

describe("listingLine", () => {
  it("해외는 거래소와 모닝스타 카테고리(참고), 국내는 없음", () => {
    expect(listingLine(makeUs("SPY", "SPDR"))).toBe("NYSE Arca · 모닝스타 Large Blend(참고)");
    expect(listingLine(makeUs("SPY", "SPDR", { category: null }))).toBe("NYSE Arca");
    expect(listingLine(makeUs("SPY", "SPDR", { exchange: null, category: null }))).toBeNull();
    expect(listingLine(makeEtf({ name: "KODEX 200" }))).toBeNull();
  });
});

describe("제외 사유 요약", () => {
  it("선택하지 않은 시장은 목록에 펼치지 않고 개수만 센다", () => {
    const kr = makeEtf({ name: "KODEX 소형", code: "SMALL", aumEok: 10 });
    const us1 = makeUs("SPY", "SPDR");
    const us2 = makeUs("QQQ", "Invesco");
    const prefs = mergeSavedPrefs({ market: "KR" });
    const r = rankEtfs([kr, us1, us2], prefs);
    const sum = summarizeExclusions(r.excluded);
    expect(sum.outOfScope).toBe(2);
    expect(sum.judged).toBe(1);
    expect(sum.rows.map(([c]) => c)).toEqual(["small-aum"]);
    expect(sum.rows.some(([c]) => c === "market")).toBe(false);
  });
  it("사유는 많은 순으로 정렬한다", () => {
    const small = (code: string) => makeEtf({ name: `KODEX ${code}`, code, aumEok: 10 });
    const lev = makeEtf({ name: "KODEX 레버리지", code: "LEV" });
    const r = rankEtfs([small("A"), small("B"), lev], DEFAULT_PREFS);
    const sum = summarizeExclusions(r.excluded);
    expect(sum.rows.map(([c, items]) => [c, items.length])).toEqual([["small-aum", 2], ["leveraged", 1]]);
    expect(sum.outOfScope).toBe(0);
    expect(sum.judged).toBe(3);
  });
});

describe("검색", () => {
  const spy = makeUs("SPY", "SPDR S&P 500 ETF Trust", { tax: usTax({ theme: "S&P500" }) });
  const jepi = makeUs("JEPI", "JPMorgan Equity Premium Income ETF", { tax: usTax({ theme: "배당", broad: false }) });
  const kr = makeEtf({ name: "KODEX 반도체", code: "091160", tax: usTax({ assetClass: "kr-equity", region: "KR", theme: "반도체" }) });

  it("티커는 대소문자와 상관없이 찾고, 정확히 맞는 것을 가장 높게 친다", () => {
    expect(matchRank(spy, "spy")).toBe(3);
    expect(matchRank(spy, "SPY")).toBe(3);
    expect(matchRank(spy, "sp")).toBe(2);
    expect(matchRank(jepi, "jep")).toBe(2);
  });
  it("영문 이름은 공백을 무시하고 찾는다", () => {
    expect(matchesQuery(spy, "s&p500")).toBe(true);
    expect(matchesQuery(spy, "spdr s&p 500")).toBe(true);
    expect(matchesQuery(jepi, "equity premium")).toBe(true);
    expect(matchRank(jepi, "equity")).toBe(1);
  });
  it("테마(한글)와 국내 코드·이름도 그대로 찾는다", () => {
    expect(matchesQuery(jepi, "배당")).toBe(true);
    expect(matchesQuery(kr, "반도체")).toBe(true);
    expect(matchesQuery(kr, "091160")).toBe(true);
    expect(matchesQuery(kr, "kodex 반도체")).toBe(true);
  });
  it("관련 없는 검색어는 불일치, 빈 검색어는 전부 일치", () => {
    expect(matchesQuery(spy, "반도체")).toBe(false);
    expect(matchesQuery(kr, "spy")).toBe(false);
    expect(matchesQuery(spy, "   ")).toBe(true);
  });
});

describe("순자산 표기(aumText)", () => {
  it("ETF 단독 값은 그대로, 펀드 전체 합계는 † 를 붙인다", () => {
    expect(aumText({ aumEok: 12_000 })).toBe("1.2조");
    expect(aumText({ aumEok: 12_000, aumScope: "fund" })).toBe("1.2조†");
    expect(aumText({ aumEok: 3_100, aumScope: "fund" })).toBe("3,100억†");
  });
  it("† 설명 문구가 있다", () => {
    expect(AUM_FUND_NOTE).toContain("†");
    expect(AUM_FUND_NOTE).toContain("펀드 전체");
  });
});
