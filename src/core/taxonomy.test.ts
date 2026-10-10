import { describe, expect, it } from "vitest";
import { classify, makeGroupKey, extractBrand } from "./taxonomy";

describe("classify: 자산군", () => {
  const cases: [string, number | null, string][] = [
    ["KODEX 200", 1, "kr-equity"],
    ["TIGER 미국S&P500", 4, "global-equity"],
    ["KODEX 국고채10년", 6, "bond"],
    ["TIGER 미국채10년선물", 6, "bond"],
    ["KODEX 머니마켓액티브", 7, "cash"],
    ["TIGER CD금리투자KIS(합성)", 6, "cash"],
    ["ACE 미국달러SOFR금리(합성)", 7, "cash"],
    ["ACE KRX금현물", 5, "commodity"],
    ["KODEX WTI원유선물(H)", 5, "commodity"],
    ["TIGER 은액티브", 5, "commodity"],
    ["KODEX 은행", 2, "kr-equity"], // '은'행은 은(銀)이 아니다
    ["TIGER 은행고배당플러스TOP10", 2, "kr-equity"],
    ["KODEX 미국달러선물", 7, "fx"],
    ["KIWOOM 미국원유에너지기업", 5, "global-equity"], // 원유 '기업' 주식이지 원유가 아니다
    ["TIGER 미국MSCI리츠(합성 H)", 4, "real-asset"],
    ["KODEX 삼성전자SK하이닉스채권혼합50", 7, "multi"], // 채권이 들어 있어도 혼합
    ["KODEX TDF2050액티브 적격", 7, "multi"],
    ["KIWOOM 미국S&P500&GOLD", 5, "multi"],
    ["RISE 미국S&P500엔화노출(합성 H)", 6, "global-equity"],
  ];
  it.each(cases)("%s → %s", (name, tab, expected) => {
    expect(classify(name, tab as never).assetClass).toBe(expected);
  });
});

describe("classify: 지역", () => {
  it("인도네시아는 인도가 아니다", () => {
    expect(classify("ACE MSCI인도네시아(합성)", 4).region).not.toBe("IN");
    expect(classify("KODEX 인도Nifty50", 4).region).toBe("IN");
  });
  it("커뮤니케이션은 일본 니케이가 아니다", () => {
    const t = classify("TIGER 200커뮤니케이션서비스", 2);
    expect(t.region).toBe("KR");
    expect(t.assetClass).toBe("kr-equity");
  });
  it("미국 단일종목 밸류체인은 미국으로 분류", () => {
    expect(classify("ACE 엔비디아밸류체인액티브", 4).region).toBe("US");
  });
});

describe("classify: 구조 태그", () => {
  it("레버리지 / 인버스 / 인버스2X", () => {
    expect(classify("KODEX 레버리지", 3).leverage).toBe(2);
    expect(classify("KODEX 인버스", 3).leverage).toBe(-1);
    expect(classify("KODEX 200선물인버스2X", 3).leverage).toBe(-2);
    expect(classify("KODEX 레버리지", 3).theme).toBe("코스피200");
  });
  it("커버드콜·환헤지·합성·액티브·TR 태그", () => {
    const t = classify("TIGER 미국나스닥100타겟데일리커버드콜(합성 H)", 4);
    expect(t.tags).toEqual(expect.arrayContaining(["covered-call", "hedged", "synthetic"]));
    expect(classify("KODEX 종합채권(AA-이상)액티브", 6).tags).toContain("active");
    expect(classify("KODEX 200TR", 1).tags).toContain("total-return");
    expect(classify("KODEX TRF3070", 7).tags).not.toContain("total-return");
  });
  it("집중 투자(단일종목/TOP3) 태그", () => {
    expect(classify("KODEX 삼성전자단일종목레버리지", 3).tags).toContain("concentrated");
    expect(classify("SOL 조선TOP3플러스", 2).tags).toContain("concentrated");
    expect(classify("TIGER 반도체TOP10", 2).tags).not.toContain("concentrated");
  });
});

describe("classify: 테마/광범위 지수", () => {
  it("대표 지수는 broad=true", () => {
    const t = classify("TIGER 미국S&P500", 4);
    expect(t.theme).toBe("S&P500");
    expect(t.broad).toBe(true);
  });
  it("테마형은 broad=false", () => {
    const t = classify("TIGER 미국필라델피아반도체나스닥", 4);
    expect(t.theme).toBe("반도체");
    expect(t.broad).toBe(false);
  });
  it("우선증권은 금융 테마가 아니다", () => {
    expect(classify("RISE 미국고정배당우선증권", 4).theme).not.toBe("금융");
  });
});

describe("동일 지수 그룹 키", () => {
  it("브랜드만 다른 같은 지수 ETF는 같은 키", () => {
    const keys = ["TIGER 미국S&P500", "KODEX 미국S&P500", "ACE 미국S&P500", "RISE 미국S&P500"].map(makeGroupKey);
    expect(new Set(keys).size).toBe(1);
  });
  it("환헤지(H)·TR·액티브는 다른 상품이므로 키가 달라야 한다", () => {
    expect(makeGroupKey("KODEX 미국S&P500")).not.toBe(makeGroupKey("KODEX 미국S&P500(H)"));
    expect(makeGroupKey("KODEX 200")).not.toBe(makeGroupKey("KODEX 200TR"));
  });
  it("공백 유무 차이는 무시", () => {
    expect(makeGroupKey("TIGER 코스닥150 레버리지")).toBe(makeGroupKey("KODEX 코스닥150레버리지"));
  });
  it("브랜드 추출", () => {
    expect(extractBrand("KODEX 200")).toBe("KODEX");
    expect(extractBrand("에셋플러스 글로벌플랫폼")).toBe("에셋플러스");
  });
});
