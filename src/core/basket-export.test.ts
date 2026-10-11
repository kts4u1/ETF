import { describe, expect, it } from "vitest";
import { parseCodeText, type BasketItem } from "./basket";
import { csvCell, toCodeList, toCsv, toSummaryText, type BasketRow } from "./basket-export";
import { hangulIn, makeEtf, withLang } from "./test-utils";

const item = (code: string, name: string, extra: Partial<BasketItem> = {}): BasketItem => ({ code, name, addedAt: "2026-10-01", note: "", ...extra });

const kr = makeEtf({ code: "069500", name: "KODEX 200", price: 35000, fee: 0.15, aumEok: 50000, m: { ret: { m1: 0, m3: 0, m6: 0, y1: 0.123, y3: 0.3, y5: 0.5 }, cagr3y: 0.081, mdd3y: -0.22 } });
const us = makeEtf({ code: "SPY", name: "SPDR S&P 500 ETF Trust", market: "US", price: 760480, priceNative: 543.2, fee: 0.0945, aumEok: 12_000_000, aumScope: "fund", m: { ret: { m1: 0, m3: 0, m6: 0, y1: 0.2, y3: 0.5, y5: 0.9 }, cagr3y: 0.15, mdd3y: -0.19 } });
const rows = (): BasketRow[] => [
  { item: item("069500", "KODEX 200", { note: "분할 매수, 목표가 \"4만\"" }), etf: kr },
  { item: item("SPY", "SPDR", { addedAt: "2026-10-05" }), etf: us },
  { item: item("OLDETF", "상장폐지된 ETF"), etf: null },
];
const META = { asOf: "20261008", asOfUs: "20261009" };

describe("toCodeList", () => {
  it("한 줄에 코드 하나(데이터에서 사라진 항목도 포함)", () => {
    expect(toCodeList(rows())).toBe("069500\nSPY\nOLDETF");
    expect(toCodeList([])).toBe("");
  });
});

describe("toSummaryText", () => {
  it("한국어: 제목·이름(코드)·지표 줄·메모 줄·해외 환산 안내·유의 문구", () => {
    const t = toSummaryText(rows(), META);
    const lines = t.split("\n");
    expect(lines[0]).toBe("[ETF 장바구니] 3개 · 국내 2026-10-08 · 해외 2026-10-09 기준");
    expect(lines).toContain("1. KODEX 200 (069500)");
    expect(t).toContain("국내 · 35,000원 · 1년 +12.3% · 3년 연평균 +8.1% · 최대낙폭 -22% · 총보수 0.15%");
    expect(lines).toContain("   ↳ 메모: 분할 매수, 목표가 \"4만\"");
    expect(t).toContain("2. SPDR S&P 500 ETF Trust (SPY)");
    expect(t).toContain("$543.20");
    expect(t).toContain("순자산");
    expect(t).toContain("†"); // 펀드 합계 순자산 표시
    expect(t).toContain("3. 상장폐지된 ETF (OLDETF)");
    expect(t).toContain("현재 데이터에 없음");
    expect(t).toContain("원화 환산값");
    expect(t.trimEnd().endsWith("투자 판단의 책임은 본인에게 있습니다.")).toBe(true);
  });

  it("국내만이고 기준일이 같으면 '기준' 한 개, 해외 안내 없음", () => {
    const t = toSummaryText([rows()[0]!], { asOf: "20261008", asOfUs: "20261008" });
    expect(t.split("\n")[0]).toBe("[ETF 장바구니] 1개 · 2026-10-08 기준");
    expect(t).not.toContain("원화 환산값");
  });

  it("영어: 한글 없이(데이터 값인 이름 제외) 영어 문장으로", () => {
    withLang("en", () => {
      const r = [{ item: item("SPY", "SPDR", { note: "buy the dip" }), etf: us }, { item: item("OLD", "Old ETF"), etf: null }];
      const t = toSummaryText(r, META);
      expect(hangulIn(t)).toEqual([]);
      expect(t.split("\n")[0]).toBe("[ETF Basket] 2 ETFs · Korea 2026-10-08 · US 2026-10-09");
      expect(t).toContain("1Y +20.0%");
      expect(t).toContain("↳ Note: buy the dip");
      expect(t).toContain("Not in the current data");
      expect(t).toContain("KRW-converted");
    });
  });

  it("메모의 줄바꿈은 한 줄로 합친다(가져오기가 다시 읽을 때 메모가 코드 줄로 오인되지 않게)", () => {
    const r: BasketRow[] = [{ item: item("SPY", "SPDR", { note: "첫 줄\n  BUY 100\nQQQ" }), etf: us }];
    const t = toSummaryText(r, META);
    expect(t).toContain("↳ 메모: 첫 줄 BUY 100 QQQ");
    expect(parseCodeText(t)).toEqual(["SPY"]);
  });

  it("왕복: 요약 글을 다시 읽으면 담긴 코드 순서 그대로(이름에 (H) 같은 괄호가 있어도)", () => {
    const hedged = makeEtf({ code: "360750", name: "TIGER 미국S&P500(H)" });
    const r: BasketRow[] = [...rows(), { item: item("360750", "TIGER 미국S&P500(H)"), etf: hedged }];
    expect(parseCodeText(toSummaryText(r, META))).toEqual(["069500", "SPY", "OLDETF", "360750"]);
  });
});

describe("csvCell / toCsv", () => {
  it("쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 따옴표는 두 번", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("줄\n바꿈")).toBe('"줄\n바꿈"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
  });

  it("스프레드시트 수식 주입 방지: = + - @ 로 시작하는 글자는 앞에 ' (숫자는 그대로)", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-0.1234")).toBe("-0.1234");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell("+3")).toBe("+3");
    expect(csvCell("- 목표가")).toBe("'- 목표가");
  });

  it("BOM + 영어 고정 헤더 + 행: 국내는 원화, 해외는 원화 환산가와 달러 현지가 + 통화, 사라진 항목은 이름·메모만", () => {
    const csv = toCsv(rows(), META);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]).toBe("code,name,market,price_krw,price_local,currency,return_1y,cagr_3y,max_drawdown,expense_ratio_pct,net_assets_eok_krw,net_assets_fund_level,asof,added,note");
    expect(lines[1]).toBe('069500,KODEX 200,KR,35000,35000,KRW,0.1230,0.0810,-0.2200,0.1500,50000,,20261008,2026-10-01,"분할 매수, 목표가 ""4만"""');
    expect(lines[2]).toBe("SPY,SPDR S&P 500 ETF Trust,US,760480,543.20,USD,0.2000,0.1500,-0.1900,0.0945,12000000,Y,20261009,2026-10-05,");
    expect(lines[3]).toBe("OLDETF,상장폐지된 ETF,,,,,,,,,,,,2026-10-01,");
    expect(lines[4]).toBe("");
    expect(lines).toHaveLength(5);
  });

  it("값이 없는 지표는 빈 칸(0 이나 NaN 이 아니라)", () => {
    const young = makeEtf({ code: "NEW001", name: "신규", fee: null, m: { ret: { m1: null, m3: null, m6: null, y1: null, y3: null, y5: null }, cagr3y: null, mdd1y: null, mdd3y: null, mddAll: null } });
    const line = toCsv([{ item: item("NEW001", "신규"), etf: young }], META).slice(1).split("\r\n")[1]!;
    expect(line).toBe("NEW001,신규,KR,10000,10000,KRW,,,,,5000,,20261008,2026-10-01,");
  });

  it("CSV 를 가져오기가 다시 읽는다", () => {
    expect(parseCodeText(toCsv(rows(), META))).toEqual(["069500", "SPY", "OLDETF"]);
  });
});
