import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";
import { hangulIn, withLang } from "./test-utils";

describe("GLOSSARY 두 언어", () => {
  const ko = GLOSSARY.map((g) => ({ ...g }));
  it("한국어 기본값은 그대로", () => {
    expect(ko.length).toBeGreaterThan(20);
    expect(ko[0]!.term).toBe("ETF");
    expect(ko[1]!.term).toBe("총보수");
  });
  it("영어 항목은 같은 개수이고 한글이 없으며 비어 있지 않다", () => {
    withLang("en", () => {
      expect(GLOSSARY.length).toBe(ko.length);
      for (const g of GLOSSARY) {
        expect(g.term.trim()).not.toBe("");
        expect(g.short.trim()).not.toBe("");
        expect(g.long.trim()).not.toBe("");
        expect(hangulIn(`${g.term} ${g.short} ${g.long}`)).toEqual([]);
      }
      expect(GLOSSARY.map((g) => g.term)).toContain("Expense ratio");
      expect(GLOSSARY.filter((g) => (g.term + g.short + g.long).toLowerCase().includes("nav")).length).toBeGreaterThan(1);
    });
    expect(GLOSSARY[1]!.term).toBe("총보수");
  });
  it("영어 항목의 용어가 서로 겹치지 않는다", () => {
    withLang("en", () => {
      const terms = GLOSSARY.map((g) => g.term);
      expect(new Set(terms).size).toBe(terms.length);
    });
  });
});
