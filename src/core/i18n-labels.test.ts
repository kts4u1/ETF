import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ISSUER_EN, STRATEGY_EN, THEME_EN, issuerLabel, strategyLabel, themeLabel } from "./i18n-labels";
import { hangulIn, withLang } from "./test-utils";

const SNAPSHOT = "public/data/snapshot.json";
const BACKTEST = "public/data/backtest.json";

describe("i18n-labels 표", () => {
  it("값에 한글이 없다", () => {
    for (const v of [...Object.values(THEME_EN), ...Object.values(ISSUER_EN), ...Object.values(STRATEGY_EN)]) {
      expect(v.trim()).not.toBe("");
      expect(hangulIn(v)).toEqual([]);
    }
  });
  it("조회 함수: 영어에서만 바꾸고 없는 값은 원문", () => {
    expect(themeLabel("반도체")).toBe("반도체");
    expect(issuerLabel("삼성자산운용")).toBe("삼성자산운용");
    expect(strategyLabel("추천 1위 단독")).toBe("추천 1위 단독");
    withLang("en", () => {
      expect(themeLabel("배당·가치")).toBe("Dividend & value");
      expect(themeLabel("S&P500")).toBe("S&P 500");
      expect(themeLabel("없는 테마")).toBe("없는 테마");
      expect(themeLabel(null)).toBeNull();
      expect(issuerLabel("미래에셋자산운용")).toBe("Mirae Asset Global Investments");
      expect(issuerLabel("Vanguard")).toBe("Vanguard");
      expect(issuerLabel(null)).toBeNull();
      expect(strategyLabel("조합 3개 · 역변동성")).toBe("3-ETF combo · inverse volatility");
    });
  });
  it.skipIf(!existsSync(SNAPSHOT))("스냅샷의 테마·국내 운용사 값이 모두 표에 있다", () => {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { etfs: { issuer: string | null; market?: string; tax: { theme: string | null } }[] };
    const themes = new Set<string>();
    const issuers = new Set<string>();
    for (const e of snap.etfs) {
      if (e.tax.theme) themes.add(e.tax.theme);
      if (e.market !== "US" && e.issuer) issuers.add(e.issuer);
    }
    expect([...themes].filter((t) => !(t in THEME_EN))).toEqual([]);
    expect([...issuers].filter((i) => !(i in ISSUER_EN))).toEqual([]);
  });
  it.skipIf(!existsSync(BACKTEST))("백테스트 전략 이름이 모두 표에 있다", () => {
    const bt = JSON.parse(readFileSync(BACKTEST, "utf8")) as { combos?: Record<string, Record<string, Record<string, unknown>>> };
    const keys = new Set<string>();
    for (const prof of Object.values(bt.combos ?? {})) for (const h of Object.values(prof)) for (const k of Object.keys(h)) keys.add(k);
    expect(keys.size).toBeGreaterThan(0);
    expect([...keys].filter((k) => !(k in STRATEGY_EN))).toEqual([]);
  });
});
