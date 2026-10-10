import { describe, expect, it } from "vitest";
import { MIN_COVERAGE, buildExposures, classifyRow, type EtfInput, type HoldingRow } from "./holdings";

const row = (id: string, name: string, weight: number, code: string | null = null): HoldingRow => ({ id, name, weight, code });
const etfs = new Set(["069500", "272580"]);

describe("classifyRow", () => {
  it("현금·예금은 ISIN 접두사나 이름으로", () => {
    expect(classifyRow(row("KRD010010001", "원화현금", 3), etfs, "X")).toBe("cash");
    expect(classifyRow(row("USDZZ0000001", "[USD] 예금", 3), etfs, "X")).toBe("cash");
    expect(classifyRow(row("A", "USD현금", 3), etfs, "X")).toBe("cash");
  });
  it("스왑(KRY)·선물·TRS·옵션은 파생", () => {
    expect(classifyRow(row("KRYZTRSG9H03", "미국나스닥100 TRS 260917-03", 4), etfs, "X")).toBe("derivative");
    expect(classifyRow(row("A", "미달러선물26년12월물", 4), etfs, "X")).toBe("derivative");
    expect(classifyRow(row("B", "NASDAQ 100 E-MINI INDEX DEC 2026", 60), etfs, "X")).toBe("derivative");
  });
  it("이름에 '선물'이 있어도 ETF 코드와 일치하면 ETF (PLUS 국채선물10년 회귀 방지)", () => {
    expect(classifyRow(row("KR7000000001", "PLUS 국채선물10년", 5, "272580"), etfs, "X")).toBe("etf");
  });
  it("자기 자신을 가리키는 행은 ETF 로 보지 않는다", () => {
    expect(classifyRow(row("KR7069500007", "KODEX 200", 5, "069500"), etfs, "069500")).toBe("security");
  });
  it("일반 종목·채권·단기사채는 종목", () => {
    expect(classifyRow(row("KR7005930003", "삼성전자", 30, "005930"), etfs, "X")).toBe("security");
    expect(classifyRow(row("US67066G1040", "엔비디아", 8), etfs, "X")).toBe("security");
    expect(classifyRow(row("KRZS0006C013", "세이브노들 20260828-91-1(단)", 1.4), etfs, "X")).toBe("security");
    expect(classifyRow(row("KR103502GE97", "국고채권 03125-3012(20-6)", 5), etfs, "X")).toBe("security");
  });
  it("'FRASERS CENTREPOINT TRUST' 처럼 REPO 가 부분 문자열인 이름은 현금이 아니다", () => {
    expect(classifyRow(row("SG1", "FRASERS CENTREPOINT TRUST", 2), etfs, "X")).toBe("security");
  });
});

const plain = (code: string, rows: HoldingRow[], derivativeStructure = false): EtfInput => ({ code, name: code, rows, derivativeStructure });

describe("buildExposures", () => {
  it("현금·파생을 빼고 식별 가능한 종목만 남긴다", () => {
    const r = buildExposures([
      plain("A", [row("S1", "삼성전자", 60, "005930"), row("S2", "하이닉스", 30), row("KRD010010001", "원화현금", 9), row("KRYZ1", "스왑", 1)]),
    ]).get("A")!;
    expect(r.unavailable).toBeUndefined();
    expect([...r.atoms.keys()].sort()).toEqual(["S1", "S2"]);
    expect(r.total).toBe(90);
    expect(r.names.get("S1")).toBe("삼성전자");
  });

  it("다른 ETF를 담으면 한 단계 풀어서 실제 종목으로 환산(비중 × 자식 비중 / 100)", () => {
    const child = plain("069500", [row("S1", "삼성전자", 40), row("S2", "하이닉스", 55), row("KRD010010001", "원화현금", 5)]);
    const parent = plain("TDF", [row("KR7069500007", "KODEX 200", 50, "069500"), row("S3", "채권", 40), row("KRD010010001", "원화현금", 10)]);
    const r = buildExposures([child, parent]).get("TDF")!;
    expect(r.atoms.get("S1")).toBeCloseTo(20, 10); // 50 × 40 / 100
    expect(r.atoms.get("S2")).toBeCloseTo(27.5, 10);
    expect(r.atoms.get("S3")).toBe(40);
    expect(r.lookThrough).toBe(50);
    expect(r.total).toBeCloseTo(87.5, 10);
  });

  it("자식 ETF가 파생 구조라 풀 수 없으면 ETF 자체를 하나의 노출로 남긴다", () => {
    const child = plain("069500", [row("F", "선물", 100)], true);
    const parent = plain("P", [row("KR7069500007", "KODEX 200", 80, "069500"), row("S1", "주식", 20)]);
    const r = buildExposures([child, parent]).get("P")!;
    expect(r.atoms.get("ETF:069500")).toBe(80);
    expect(r.names.get("ETF:069500")).toBe("KODEX 200");
  });

  it("두 단계까지만 풀고 순환 참조에도 멈춘다", () => {
    const a = plain("069500", [row("K1", "ETF B", 90, "272580"), row("S", "주식", 10)]);
    const b = plain("272580", [row("K2", "ETF A", 90, "069500"), row("S", "주식", 10)]);
    const res = buildExposures([a, b]);
    expect(res.get("069500")).toBeDefined();
    expect(res.get("272580")).toBeDefined();
  });

  it("같은 종목이 여러 경로로 들어오면 비중을 합산", () => {
    const child = plain("069500", [row("S1", "삼성전자", 100)]);
    const parent = plain("P", [row("S1", "삼성전자", 30), row("KR7069500007", "KODEX 200", 60, "069500"), row("S9", "기타", 10)]);
    expect(buildExposures([child, parent]).get("P")!.atoms.get("S1")).toBeCloseTo(90, 10);
  });

  it("레버리지·인버스·합성 구조는 사용 불가", () => {
    const r = buildExposures([plain("L", [row("S1", "삼성전자", 100)], true)]).get("L")!;
    expect(r.unavailable).toBe("derivative-structure");
    expect(r.atoms.size).toBe(0);
  });

  it(`식별 가능 비중이 ${MIN_COVERAGE}% 미만이면 사용 불가`, () => {
    const r = buildExposures([plain("F", [row("S1", "주식", 20), row("KRYZ1", "스왑", 80)])]).get("F")!;
    expect(r.unavailable).toBe("low-coverage");
    expect(r.total).toBe(20);
  });

  it("음수 비중(공매도)은 노출로 보지 않고, 구성종목이 없으면 no-data", () => {
    const r = buildExposures([plain("N", [row("S1", "주식", 100), row("S2", "공매도", -20)]), plain("E", [])]);
    expect(r.get("N")!.atoms.has("S2")).toBe(false);
    expect(r.get("E")!.unavailable).toBe("no-data");
  });
});
