import { describe, expect, it } from "vitest";
import { parseDelistedCsv } from "./delisted";
import {
  classifyCandidate,
  inferSnapshotDate,
  mergeEntries,
  parseKrxEtfCsv,
  toDelistedCsv,
  type KrxRow,
  type SeriesLike,
} from "./derive-delisted";

const enc = (s: string) => new TextEncoder().encode(s);

describe("parseKrxEtfCsv", () => {
  const header = "종목코드,종목명,종가,대비,등락률";
  it("UTF-8, 따옴표, 천 단위 쉼표, 영숫자 신형 코드", () => {
    const csv = `${header}\n"069500","KODEX 200","105,650","-2900","-2.67"\n"0010E0","ACE FTSE WGBI Korea","93340","0","0"`;
    expect(parseKrxEtfCsv(enc(csv))).toEqual([
      { code: "069500", name: "KODEX 200", close: 105650 },
      { code: "0010E0", name: "ACE FTSE WGBI Korea", close: 93340 },
    ]);
  });
  it("KRX 다운로드 기본 인코딩(EUC-KR)을 복원", () => {
    // '종목코드,종목명,종가\n069500,가,1' 의 EUC-KR 바이트
    const euc = new Uint8Array([
      0xc1, 0xbe, 0xb8, 0xf1, 0xc4, 0xda, 0xb5, 0xe5, 0x2c, 0xc1, 0xbe, 0xb8, 0xf1, 0xb8, 0xed, 0x2c, 0xc1, 0xbe, 0xb0, 0xa1, 0x0a,
      0x30, 0x36, 0x39, 0x35, 0x30, 0x30, 0x2c, 0xb0, 0xa1, 0x2c, 0x31, 0x0a,
    ]);
    expect(parseKrxEtfCsv(euc)).toEqual([{ code: "069500", name: "가", close: 1 }]);
  });
  it("필수 열이 없으면 발견한 열을 알려주는 오류", () => {
    expect(() => parseKrxEtfCsv(enc("a,b,c\n1,2,3"))).toThrow(/종목코드·종목명·종가.*a, b, c/);
  });
  it("잘못된 행(코드 형식·종가 NaN)은 건너뛰고, 빈 입력은 빈 배열", () => {
    expect(parseKrxEtfCsv(enc(`${header}\n12,짧음,1,0,0\n069500,정상,x,0,0\n069500,정상,5,0,0`))).toEqual([{ code: "069500", name: "정상", close: 5 }]);
    expect(parseKrxEtfCsv(enc(""))).toEqual([]);
  });
});

/** 코드별 가상 시세: 날짜 d0..d4, 종가는 코드 번호 × (날짜 인덱스+1) 로 날짜마다 다르게 */
function fakeSeries(codes: string[]): Map<string, SeriesLike> {
  const dates = ["20260406", "20260407", "20260408", "20260409", "20260410"];
  return new Map(codes.map((c, k) => [c, { dates, close: dates.map((_, i) => 1000 + k * 37 + i * 111) }]));
}

describe("inferSnapshotDate", () => {
  const codes = Array.from({ length: 40 }, (_, i) => String(100000 + i));
  const series = fakeSeries(codes);
  const rowsAt = (idx: number): KrxRow[] => codes.map((c) => ({ code: c, name: c, close: (series.get(c) as SeriesLike).close[idx] as number }));

  it("종가가 일치하는 날짜를 찾는다", () => {
    const r = inferSnapshotDate(rowsAt(2), series)!;
    expect(r.date).toBe("20260408");
    expect(r.matched).toBe(40);
  });
  it("배당 보정으로 일부만 달라도(절반 일치) 올바른 날짜", () => {
    const rows = rowsAt(1).map((r, i) => (i % 2 ? { ...r, close: r.close * 1.03 } : r));
    expect(inferSnapshotDate(rows, series)!.date).toBe("20260407");
  });
  it("어느 날짜와도 맞지 않으면 null", () => {
    expect(inferSnapshotDate(rowsAt(0).map((r) => ({ ...r, close: r.close + 5 })), series)).toBeNull();
  });
  it("비교할 종목이 너무 적으면 null", () => {
    expect(inferSnapshotDate(rowsAt(0).slice(0, 5), series)).toBeNull();
  });
});

describe("classifyCandidate", () => {
  const asOf = "20261008";
  it("시세가 기준일 훨씬 전에 끝나면 상장폐지", () => {
    expect(classifyCandidate("20260624", 733, asOf)).toEqual({ kind: "delisted", lastDate: "20260624" });
    expect(classifyCandidate("20260923", 528, asOf)).toEqual({ kind: "delisted", lastDate: "20260923" });
  });
  it("기준일 7일 이내까지 이어지면 아직 거래 중(제외)", () => {
    expect(classifyCandidate("20261008", 300, asOf).kind).toBe("still-trading");
    expect(classifyCandidate("20261001", 300, asOf).kind).toBe("still-trading"); // 정확히 7일 전
    expect(classifyCandidate("20260930", 300, asOf).kind).toBe("delisted"); // 8일 전
  });
  it("시세가 없거나 너무 짧으면 판정 불가", () => {
    expect(classifyCandidate(null, 0, asOf).kind).toBe("no-prices");
    expect(classifyCandidate("20260101", 59, asOf).kind).toBe("no-prices");
  });
});

describe("toDelistedCsv / mergeEntries", () => {
  it("직렬화한 CSV를 가져오기 파서가 그대로 읽는다(왕복)", () => {
    const entries = [
      { code: "301410", name: "PLUS 코스닥150선물인버스", delistedOn: "20260624" },
      { code: "0010E0", name: "이름,쉼표 \"따옴표\"", delistedOn: null },
    ];
    expect(parseDelistedCsv(toDelistedCsv(entries)).sort((a, b) => a.code.localeCompare(b.code))).toEqual(
      [...entries].sort((a, b) => a.code.localeCompare(b.code)),
    );
  });
  it("병합: 같은 코드는 새 값 우선, 새 값이 비어 있으면 기존 폐지일 유지", () => {
    const merged = mergeEntries(
      [{ code: "A", name: "옛 이름", delistedOn: "20250101" }, { code: "B", name: "B", delistedOn: "20250202" }],
      [{ code: "A", name: "새 이름", delistedOn: null }, { code: "C", name: "C", delistedOn: "20260303" }],
    );
    const byCode = new Map(merged.map((e) => [e.code, e]));
    expect(byCode.get("A")).toEqual({ code: "A", name: "새 이름", delistedOn: "20250101" });
    expect(byCode.size).toBe(3);
  });
  it("폐지일 순으로 정렬되어 출력", () => {
    const csv = toDelistedCsv([{ code: "B", name: "b", delistedOn: "20260301" }, { code: "A", name: "a", delistedOn: "20250101" }]);
    expect(csv.split("\n").slice(1, 3).map((l) => l.split(",")[0])).toEqual(["A", "B"]);
  });
});
