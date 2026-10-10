import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { decodeCsv, loadCachedDelisted, normalizeDate, parseDelistedCsv } from "./delisted";

describe("normalizeDate", () => {
  it("여러 표기를 YYYYMMDD 로", () => {
    expect(normalizeDate("2024-03-05")).toBe("20240305");
    expect(normalizeDate("2024/03/05")).toBe("20240305");
    expect(normalizeDate("20240305")).toBe("20240305");
    expect(normalizeDate("2024.03.05")).toBe("20240305");
  });
  it("형식이 다르면 null", () => {
    expect(normalizeDate("")).toBeNull();
    expect(normalizeDate("24-3-5")).toBeNull();
  });
});

describe("parseDelistedCsv", () => {
  it("한글 헤더, 따옴표, 날짜 정규화", () => {
    const csv = `종목코드,종목명,상장폐지일\n069500,"KODEX 가,나",2024-03-05\n102110,TIGER 200,20240601`;
    expect(parseDelistedCsv(csv)).toEqual([
      { code: "069500", name: "KODEX 가,나", delistedOn: "20240305" },
      { code: "102110", name: "TIGER 200", delistedOn: "20240601" },
    ]);
  });
  it("KRX 단축코드의 A 접두, 영문 헤더, TSV, 소문자 코드", () => {
    const tsv = `code\tname\nA069500\tKODEX 200\n0001a0\tNEW ETF`;
    expect(parseDelistedCsv(tsv)).toEqual([
      { code: "069500", name: "KODEX 200", delistedOn: null },
      { code: "0001A0", name: "NEW ETF", delistedOn: null },
    ]);
  });
  it("잘못된 코드·빈 이름·중복은 건너뛴다", () => {
    const csv = `종목코드,종목명\n123,짧은코드\n069500,\n069500,정상\n069500,중복`;
    expect(parseDelistedCsv(csv)).toEqual([{ code: "069500", name: "정상", delistedOn: null }]);
  });
  it("필수 열이 없으면 발견한 열을 알려주는 오류", () => {
    expect(() => parseDelistedCsv("a,b\n1,2")).toThrow(/종목코드.*종목명.*a, b/);
  });
  it("헤더만 있거나 비어 있으면 빈 배열", () => {
    expect(parseDelistedCsv("종목코드,종목명")).toEqual([]);
    expect(parseDelistedCsv("")).toEqual([]);
  });
  it("CRLF 와 BOM 을 허용", () => {
    const csv = decodeCsv(new TextEncoder().encode("﻿종목코드,종목명\r\n069500,KODEX 200\r\n"));
    expect(parseDelistedCsv(csv)).toEqual([{ code: "069500", name: "KODEX 200", delistedOn: null }]);
  });
});

describe("decodeCsv", () => {
  it("UTF-8 은 그대로", () => {
    expect(decodeCsv(new TextEncoder().encode("종목명"))).toBe("종목명");
  });
  it("EUC-KR(KRX 다운로드 기본 인코딩)을 감지해 복원", () => {
    // '종목코드' 의 EUC-KR 바이트
    const euckr = new Uint8Array([0xc1, 0xbe, 0xb8, 0xf1, 0xc4, 0xda, 0xb5, 0xe5]);
    expect(decodeCsv(euckr)).toBe("종목코드");
  });
});

describe("normalizeDate: 달력에 없는 날짜", () => {
  it("존재하지 않는 날짜는 거부", () => {
    expect(normalizeDate("20260230")).toBeNull();
    expect(normalizeDate("2026-13-01")).toBeNull();
    expect(normalizeDate("2026-04-31")).toBeNull();
    expect(normalizeDate("2026-00-10")).toBeNull();
  });
  it("윤일은 윤년에만 인정", () => {
    expect(normalizeDate("20240229")).toBe("20240229");
    expect(normalizeDate("20250229")).toBeNull();
  });
});

describe("loadCachedDelisted: 읽지 못한 항목을 조용히 버리지 않는다", () => {
  let dir = "";
  let prev = "";
  const longSeries = (n: number) => {
    const dates = Array.from({ length: n }, (_, i) => `2025${String(1 + Math.floor(i / 28)).padStart(2, "0")}${String(1 + (i % 28)).padStart(2, "0")}`);
    return { dates, close: dates.map((_, i) => 1000 + i), volume: dates.map(() => 10) };
  };
  beforeEach(async () => {
    prev = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "load-delisted-"));
    process.chdir(dir);
    await mkdir("data", { recursive: true });
    await mkdir(".cache/naver/delisted", { recursive: true });
    await writeFile("data/delisted.csv", "종목코드,종목명,상장폐지일\n0AAAA0,정상 ETF,20260624\n0BBBB0,짧은 시세,20260624\n0CCCC0,캐시 없음,20260624\n");
    await writeFile(".cache/naver/delisted/0AAAA0.json", JSON.stringify({ fetchedOn: "20261010", data: { entry: {}, series: longSeries(120) } }));
    await writeFile(".cache/naver/delisted/0BBBB0.json", JSON.stringify({ fetchedOn: "20261010", data: { entry: {}, series: longSeries(30) } }));
  });
  afterEach(async () => {
    process.chdir(prev);
    await rm(dir, { recursive: true, force: true });
  });

  it("읽은 것은 loaded, 캐시가 없거나 시세가 짧은 것은 사유와 함께 skipped", async () => {
    const r = await loadCachedDelisted();
    expect(r.loaded.map((l) => l.rec.code)).toEqual(["0AAAA0"]);
    expect(r.skipped).toEqual([
      { code: "0BBBB0", name: "짧은 시세", reason: "시세가 너무 짧음(30일)" },
      { code: "0CCCC0", name: "캐시 없음", reason: "시세 캐시 없음(npm run sync 필요)" },
    ]);
  });
});
