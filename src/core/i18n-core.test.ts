import { describe, expect, it } from "vitest";
import { fmtAsOf, fmtEok, fmtFxRate, fmtHistory, fmtPriceLine, fmtSnapshotList, fmtSurvivorshipGap, fmtWon, fmtWonShort, fmtYears, priceParts } from "./format";
import { MARKET_LABEL, MARKET_SHORT } from "./market";
import { MARKET_FILTER_LABEL, describeCounts, listingLine, usCollectionRule } from "./market-view";
import { overlapLevel } from "./overlap";
import { roleOf } from "./portfolio";
import { DEFAULT_PREFS, EXCLUSION_LABEL, FACTOR_KEYS, FACTOR_LABELS, HORIZONS, PROFILES, checkEligibility } from "./scoring";
import { hangulIn, makeEtf, withLang } from "./test-utils";

describe("영어 서식", () => {
  it("금액은 T/B/M", () => {
    withLang("en", () => {
      expect(fmtEok(12000)).toBe("₩1.2T");
      expect(fmtEok(3100)).toBe("₩310B");
      expect(fmtWon(1.2e12)).toBe("₩1.2T");
      expect(fmtWon(4.66e10)).toBe("₩46.6B");
      expect(fmtWon(3.2e8)).toBe("₩320M");
      expect(fmtWon(5.2e7)).toBe("₩52M");
      expect(fmtWon(12345)).toBe("₩12,345");
      expect(fmtWonShort(760480)).toBe("₩760K");
      expect(fmtWonShort(7600)).toBe("₩7,600");
    });
  });
  it("기간·가격·날짜 문구", () => {
    withLang("en", () => {
      expect(fmtYears(6.24)).toBe("6.2y");
      expect(fmtYears(0.6)).toBe("7 mo");
      expect(fmtHistory(8, 1995)).toBe("8y+");
      expect(fmtFxRate(1380.5)).toBe("₩1,380.50");
      expect(priceParts({ market: "KR", price: 1045612 }).main).toBe("₩1,045,612");
      expect(fmtPriceLine({ market: "US", price: 1e6, priceNative: 778.57 })).toBe("$778.57 (≈ ₩1M)");
      expect(fmtSnapshotList(["20201230", "20210101", "20220101", "20260410"])).toBe("4 snapshots (2020-12-30 to 2026-04-10)");
      const out = [
        fmtAsOf({ asOf: "20261008" }),
        fmtAsOf({ asOf: "20261008", asOfUs: "20261007", fxUsdKrw: { rate: 1380.5, date: "20261007" } }),
        fmtSurvivorshipGap(["20201230"]),
        fmtSurvivorshipGap(["20201230", "20220101"]),
      ];
      expect(out[0]).toBe("Prices as of 2026-10-08");
      expect(out[1]).toContain("differs from Korea");
      expect(out[1]).toContain("USD/KRW ₩1,380.50");
      for (const t of out) expect(hangulIn(t)).toEqual([]);
    });
  });
  it("한국어 출력은 그대로", () => {
    expect(fmtEok(12000)).toBe("1.2조");
    expect(fmtWon(5.2e7)).toBe("5,200만");
    expect(fmtYears(0.6)).toBe("7개월");
  });
});

describe("영어 라벨·사유", () => {
  it("성향·기간·항목·제외 라벨에 한글이 없다", () => {
    withLang("en", () => {
      const all = [
        ...Object.values(PROFILES).flatMap((p) => [p.label, p.description]),
        ...Object.values(HORIZONS).flatMap((h) => [h.label, h.description]),
        ...FACTOR_KEYS.flatMap((k) => [FACTOR_LABELS[k].name, FACTOR_LABELS[k].hint]),
        ...Object.values(EXCLUSION_LABEL),
        ...Object.values(MARKET_LABEL),
        ...Object.values(MARKET_SHORT),
        ...Object.values(MARKET_FILTER_LABEL),
        usCollectionRule(),
        describeCounts({ KR: 1172, US: 1204 }),
        overlapLevel(60).label,
        overlapLevel(5).label,
      ];
      expect(PROFILES.stable.label).toBe("Conservative");
      expect(HORIZONS.mid.label).toBe("1–3 years");
      expect(FACTOR_LABELS.safety.name).toBe("Stability");
      expect(MARKET_LABEL.US).toBe("US-listed");
      expect(describeCounts({ KR: 1172, US: 1204 })).toBe("1,172 Korea-listed ETFs and 1,204 US-listed ETFs");
      expect(usCollectionRule()).toContain("₩500B");
      for (const t of all) expect(hangulIn(t), t).toEqual([]);
    });
    expect(PROFILES.stable.label).toBe("안정형");
  });
  it("자격 심사 사유가 영어로 나온다", () => {
    withLang("en", () => {
      const cases = [
        checkEligibility(makeEtf({ aumEok: 100 }), DEFAULT_PREFS),
        checkEligibility(makeEtf({ m: { avgValue20: 1e7 } }), DEFAULT_PREFS),
        checkEligibility(makeEtf({ fee: 0.9 }), { ...DEFAULT_PREFS, maxFee: 0.5 }),
        checkEligibility(makeEtf({ m: { vol3y: 0.4 } }), { ...DEFAULT_PREFS, profile: "stable" }),
        checkEligibility(makeEtf({ m: { mdd3y: -0.6, vol3y: 0.1 } }), { ...DEFAULT_PREFS, profile: "stable" }),
        checkEligibility(makeEtf({ m: { ret: { m1: 0, m3: 0, m6: 0, y1: null, y3: null, y5: null } } }), DEFAULT_PREFS),
        checkEligibility(makeEtf(), { ...DEFAULT_PREFS, market: "US" }),
      ];
      expect(cases[0]?.reason).toBe("Net assets ₩10B — below the ₩30B minimum");
      for (const c of cases) {
        expect(c).not.toBeNull();
        expect(hangulIn(c?.reason ?? "")).toEqual([]);
      }
    });
  });
  it("조합 역할·상장 한 줄", () => {
    withLang("en", () => {
      expect(roleOf(makeEtf())).toBe("Growth (equity)");
      expect(hangulIn(listingLine({ market: "US", exchange: "NYSE", category: "Large Blend" }) ?? "")).toEqual([]);
    });
    expect(roleOf(makeEtf())).toBe("성장(주식)");
  });
});
