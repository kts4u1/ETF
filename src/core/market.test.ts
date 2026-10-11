import { describe, expect, it } from "vitest";
import { MARKET_LABEL, MARKET_SHORT, isOverseas, marketOf } from "./market";

describe("market", () => {
  it("market 필드가 없으면 국내 상장", () => {
    expect(marketOf({})).toBe("KR");
    expect(marketOf({ market: "KR" })).toBe("KR");
    expect(marketOf({ market: "US" })).toBe("US");
  });
  it("해외 여부", () => {
    expect(isOverseas({})).toBe(false);
    expect(isOverseas({ market: "US" })).toBe(true);
  });
  it("모든 시장에 표시 이름이 있다", () => {
    for (const m of ["KR", "US"] as const) {
      expect(MARKET_LABEL[m].length).toBeGreaterThan(0);
      expect(MARKET_SHORT[m].length).toBeGreaterThan(0);
    }
  });
});
