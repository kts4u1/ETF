import { describe, expect, it } from "vitest";
import { ASSET_CLASS_LABEL, REGION_LABEL, RISK_LABEL, TAG_LABEL, cautions, explain, explainProposal, indexTrackingSentence, structureNotes, taxNote, typeLine } from "./explain";
import type { ComboCandidate, Proposal } from "./portfolio";
import { DEFAULT_PREFS, rankEtfs } from "./scoring";
import { hangulIn, makeEtf, withLang } from "./test-utils";
import type { EtfRecord, Scored, Taxonomy } from "./types";

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
const withTax = (name: string, tax: Partial<Taxonomy>, over: Partial<EtfRecord> = {}): EtfRecord => {
  const base = makeEtf({ name, ...over });
  return { ...base, tax: { ...base.tax, ...tax } };
};

/** 영어 문장에는 한글이 한 글자도 없어야 한다(ETF 이름 같은 데이터 값은 이 테스트가 다루지 않는다) */
const ownHangul = (text: string): string[] => hangulIn(text);

/** 한 ETF 의 영어 설명 전체를 한 문자열로 */
const allText = (e: EtfRecord): string => [typeLine(e), indexTrackingSentence(e), taxNote(e), ...structureNotes(e), ...cautions(e).map((c) => c.text)].join(" | ");

describe("영어 설명: 상수", () => {
  it("라벨 상수는 언어를 따른다", () => {
    withLang("en", () => {
      expect(ASSET_CLASS_LABEL.crypto).toBe("Crypto");
      expect(ASSET_CLASS_LABEL["kr-equity"]).toBe("Korean equity");
      expect(REGION_LABEL.US).toBe("US");
      expect(TAG_LABEL["defined-outcome"]).toBe("Buffer / defined outcome");
      expect(TAG_LABEL.volatility).toBe("Volatility (VIX)");
      expect([...RISK_LABEL]).toEqual(["", "Very low", "Low", "Moderate", "High", "Very high"]);
      for (const v of [...Object.values(ASSET_CLASS_LABEL), ...Object.values(REGION_LABEL), ...Object.values(TAG_LABEL), ...RISK_LABEL]) expect(hangulIn(v)).toEqual([]);
    });
    expect(ASSET_CLASS_LABEL.crypto).toBe("가상자산");
    expect(RISK_LABEL[5]).toBe("매우 높음");
  });
});

describe("영어 설명: ETF 종류별", () => {
  it("국내 ETF", () => {
    withLang("en", () => {
      const e = makeEtf({ name: "KODEX 200" });
      expect(typeLine(e)).toMatch(/^Korean equity|^Korea equity/);
      expect(taxNote(e)).toMatch(/not taxed on trading gains/);
      expect(indexTrackingSentence(e)).toMatch(/follow/);
      expect(hangulIn(allText(e))).toEqual([]);
    });
  });
  it("해외(미국) ETF", () => {
    withLang("en", () => {
      const e = makeUs();
      const t = allText(e);
      expect(typeLine(e)).toBe("US equity · S&P 500 index");
      expect(structureNotes(e).join(" ")).toMatch(/Listed in the US \(NYSE Arca\)/);
      expect(t).toMatch(/capital gains tax \(22% after a KRW 2\.5M annual deduction\)/);
      expect(t).toMatch(/not provided for US-listed ETFs/);
      expect(hangulIn(t)).toEqual([]);
    });
  });
  it("레버리지·인버스", () => {
    withLang("en", () => {
      const lev = withTax("KODEX 레버리지", { tags: ["leveraged"], leverage: 2 });
      const inv = withTax("KODEX 인버스", { tags: ["inverse"], leverage: -1 });
      expect(structureNotes(lev).join(" ")).toMatch(/2x the daily return/);
      expect(structureNotes(inv).join(" ")).toMatch(/opposite to its index/);
      const c = cautions(lev);
      expect(c[0]!.level).toBe("high");
      expect(c[0]!.text).toMatch(/short-term trading/);
      expect(hangulIn(allText(lev) + allText(inv))).toEqual([]);
    });
  });
  it("커버드콜·버퍼·VIX", () => {
    withLang("en", () => {
      const cc = makeUs({ tax: { tags: ["covered-call"] } });
      const buf = makeUs({ tax: { tags: ["defined-outcome"], theme: "버퍼", broad: false } });
      const vix = makeUs({ tax: { tags: ["volatility"], theme: "변동성", broad: false } });
      expect(cautions(cc).some((c) => /capped/.test(c.text))).toBe(true);
      expect(cautions(buf).find((c) => /buffer/.test(c.text))?.level).toBe("warn");
      expect(cautions(vix).find((c) => /VIX/.test(c.text))?.level).toBe("high");
      expect(indexTrackingSentence(cc)).toBe("");
      for (const e of [cc, buf, vix]) {
        // 테마 이름은 표에 없는 값이라 원문 그대로 남는다 — 한글 검사는 문장에서 테마를 뺀 나머지로
        expect(hangulIn(allText(e).replace(/버퍼|변동성/g, ""))).toEqual([]);
      }
    });
  });
  it("가상자산: 수치는 데이터에서", () => {
    withLang("en", () => {
      const e = makeUs({ name: "iShares Bitcoin Trust", tax: { assetClass: "crypto", region: "GLOBAL", theme: "비트코인", broad: false }, m: { vol3y: 0.55, mdd3y: -0.48 } });
      const c = cautions(e).find((x) => /Crypto assets/.test(x.text));
      expect(c?.text).toMatch(/annual volatility 55%, max drawdown -48%/);
      expect(typeLine(e)).toBe("Crypto · Bitcoin theme");
      expect(ownHangul(allText(e))).toEqual([]);
    });
  });
  it("† 펀드 순자산은 영어 문구와 거래대금 근거", () => {
    withLang("en", () => {
      const e = makeUs({ aumScope: "fund", aumEok: 9_000_000, m: { avgValue20: 5e9 } });
      expect(cautions(e).some((c) => /fund/i.test(c.text) && /†|share class|ETF class/i.test(c.text))).toBe(true);
      const r = rankEtfs([e, makeEtf({ name: "KODEX 200", code: "069500" })], DEFAULT_PREFS);
      const ex = explain(r.ranked.find((x) => x.etf.code === "SPY")!, DEFAULT_PREFS);
      expect(ex.reasons.join(" ")).toMatch(/fund-wide total/);
      expect(ex.reasons.join(" ")).not.toMatch(/low liquidation risk/);
      expect(ownHangul(ex.headline + ex.reasons.join(" "))).toEqual([]);
    });
  });
});

describe("영어 설명: explain / 조합", () => {
  it("explain 은 사실 중심 영어로 나오고 한글이 없다", () => {
    withLang("en", () => {
      const prefs = { ...DEFAULT_PREFS };
      const e = makeEtf({ name: "KODEX 200", code: "069500", fee: 0.05 });
      const ranked = rankEtfs([e, makeEtf({ name: "TIGER 200", code: "102110" })], prefs).ranked;
      const s = { ...ranked[0]!, factors: { ...ranked[0]!.factors, ret: 0, eff: 0, safety: 0, trend: 0, cost: 95, trust: 0 }, groupSize: 3, groupRank: 1 } as Scored;
      const ex = explain(s, prefs);
      const text = ex.headline + " | " + ex.reasons.join(" | ");
      expect(ex.headline).toMatch(/overall score \d+/);
      expect(text).toMatch(/Ranks #1 overall among 3 candidate ETFs/);
      expect(text).toMatch(/₩[\d,]+ per year per ₩10M/);
      expect(text).not.toMatch(/recommend/i);
      expect(ownHangul(ex.headline)).toEqual([]);
      expect(ownHangul(ex.reasons.join(" "))).toEqual([]);
    });
  });
  it("조합 설명(역할 이름 줄은 portfolio.ts 담당이라 제외)", () => {
    withLang("en", () => {
      const cand = (e: EtfRecord): ComboCandidate => ({ etf: e, score: 70, returns: [] });
      const kr = makeEtf({ name: "KODEX 200", code: "069500" });
      const us = makeUs();
      const p: Proposal = {
        members: [{ cand: cand(kr), weight: 0.6 }, { cand: cand(us), weight: 0.4 }],
        stats: { weeks: 156, cagr: 0.1, vol: 0.08, mdd: -0.06, sharpe: 0.6, avgMemberVol: 0.14, diversificationRatio: 1.75 },
        returns: [],
        quality: 70,
        diversification: 100,
        avgOverlap: 30,
        maxOverlap: { a: "A", b: "B", pct: 30 },
        score: 80,
      };
      const e = explainProposal(p, (c) => ({ name: `Name-${c}` }));
      const reasons = e.reasons.filter((r) => !r.startsWith("Role split"));
      expect(e.reasons[0]).toMatch(/^Role split: /);
      expect(reasons.join(" ")).toMatch(/about 43% lower/);
      expect(reasons.join(" ")).toMatch(/largest overlap: Name-A ↔ Name-B 30%/);
      const c = e.cautions.join(" | ");
      expect(c).toMatch(/no holdings data and are not included in the overlap figure/);
      expect(c).toMatch(/not a return forecast/);
      expect(c).toMatch(/rebalancing/);
      expect(ownHangul(reasons.join(" "))).toEqual([]);
      // 해외 ETF 이름(영문)만 들어가므로 한글 없음
      expect(hangulIn(c)).toEqual([]);
      const none = explainProposal({ ...p, avgOverlap: null, maxOverlap: null, stats: { ...p.stats, diversificationRatio: 1.0 } }, () => undefined);
      expect(none.reasons.join(" ")).toMatch(/diversification benefit is small/);
      expect(none.cautions.join(" ")).toMatch(/overlap could not be checked/);
    });
  });
});
