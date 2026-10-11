import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ISSUER_EN, STRATEGY_EN, THEME_EN, issuerLabel, strategyLabel, themeLabel } from "./i18n-labels";
import { hangulIn, withLang } from "./test-utils";

const SNAPSHOT = "public/data/snapshot.json";
const BACKTEST = "public/data/backtest.json";
/** 데이터 갱신 때 새로 나타날 수 있는, 영어 표에 아직 없는 값의 허용 개수 */
const MAX_NEW_UNMAPPED = 5;

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
    // 자동 갱신으로 새 테마·운용사가 들어와도 갱신이 멈추지 않게 한다(표에 없으면 화면에서 원문이 그대로 나온다).
    // 대신 몇 개를 넘으면 표를 손봐야 하는 신호로 보고 실패시킨다.
    const missing = [...[...themes].filter((t) => !(t in THEME_EN)), ...[...issuers].filter((i) => !(i in ISSUER_EN))];
    if (missing.length > 0) console.warn(`영어 표에 없는 값(원문으로 표시됨): ${missing.join(", ")}`);
    expect(missing.length).toBeLessThanOrEqual(MAX_NEW_UNMAPPED);
  });
  it.skipIf(!existsSync(BACKTEST))("백테스트 전략 이름이 모두 표에 있다", () => {
    const bt = JSON.parse(readFileSync(BACKTEST, "utf8")) as { combos?: Record<string, Record<string, Record<string, unknown>>> };
    const keys = new Set<string>();
    for (const prof of Object.values(bt.combos ?? {})) for (const h of Object.values(prof)) for (const k of Object.keys(h)) keys.add(k);
    expect(keys.size).toBeGreaterThan(0);
    expect([...keys].filter((k) => !(k in STRATEGY_EN))).toEqual([]);
  });
});
