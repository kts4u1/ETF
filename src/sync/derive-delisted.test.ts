import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PriceSeries } from "../core/types";
import { parseDelistedCsv } from "./delisted";
import {
  classifyCandidate,
  deriveDelisted,
  inferSnapshotDate,
  looksLikeCurrentList,
  matchAtDate,
  MIN_KRX_ROWS,
  mergeEntries,
  parseDeriveArgs,
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

  // 오래된 파일: 배당 보정 때문에 대부분 어긋나고 일부(배당을 안 하는 ETF)만 정확히 맞는다 — 실제 파일은 약 14%만 맞았다
  const codes2 = Array.from({ length: 200 }, (_, i) => String(500000 + i));
  const series2 = fakeSeries(codes2);
  const bigRowsAt = (idx: number): KrxRow[] => codes2.map((c) => ({ code: c, name: c, close: (series2.get(c) as SeriesLike).close[idx] as number }));
  const bigOld = (matching: number, otherIdx = -1, otherCount = 0): KrxRow[] =>
    bigRowsAt(1).map((r, i) => {
      if (i < matching) return r;
      if (otherIdx >= 0 && i < matching + otherCount) return { ...r, close: (series2.get(r.code) as SeriesLike).close[otherIdx] as number };
      return { ...r, close: r.close * 1.6 };
    });

  it("일치율이 낮아도(14%) 다른 날짜보다 압도적이면 날짜를 추정한다 — 1~2.5년 전 KRX 파일의 실제 모습", () => {
    const r = inferSnapshotDate(bigOld(28), series2)!; // 200개 중 28개 = 14%
    expect(r.date).toBe("20260407");
    expect(r.matched).toBe(28);
    expect(r.compared).toBe(200);
    expect(r.runnerUp).toBeLessThan(28 / 3); // 2위 날짜는 우연히 맞는 몇 개뿐
  });
  it("1위가 2위보다 3배 미만이면 날짜를 가릴 수 없어 null(동률 포함)", () => {
    expect(inferSnapshotDate(bigOld(28, 3, 28), series2)).toBeNull(); // 04-07 에 28개, 04-09 에도 28개
    expect(inferSnapshotDate(bigOld(30, 3, 11), series2)).toBeNull(); // 30 < 3 × 11
    expect(inferSnapshotDate(bigOld(30, 3, 10), series2)?.date).toBe("20260407"); // 30 = 3 × 10 은 통과(경계)
  });
  it("일치가 15개 미만이거나 비교 종목의 5% 미만이면 null", () => {
    expect(inferSnapshotDate(bigOld(14), series2)).toBeNull(); // 14 < 15
    expect(inferSnapshotDate(bigOld(15), series2)?.date).toBe("20260407"); // 15 = 15, 7.5% ≥ 5%
    const many = Array.from({ length: 400 }, (_, i) => String(600000 + i));
    const seriesMany = fakeSeries(many);
    const rows: KrxRow[] = many.map((c, i) => ({ code: c, name: c, close: ((seriesMany.get(c) as SeriesLike).close[1] as number) * (i < 15 ? 1 : 1.6) }));
    expect(inferSnapshotDate(rows, seriesMany, { sample: 400 })).toBeNull(); // 15/400 = 3.75% < 5%
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
  it("시세가 없거나 너무 짧으면 판정 불가(60거래일부터 판정)", () => {
    expect(classifyCandidate(null, 0, asOf).kind).toBe("no-prices");
    expect(classifyCandidate("20260101", 59, asOf).kind).toBe("no-prices");
    expect(classifyCandidate("20260101", 60, asOf).kind).toBe("delisted");
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

describe("matchAtDate / looksLikeCurrentList", () => {
  const codes = Array.from({ length: 30 }, (_, i) => String(200000 + i));
  const series = fakeSeries(codes);
  const rowsAt = (idx: number): KrxRow[] => codes.map((c) => ({ code: c, name: c, close: (series.get(c) as SeriesLike).close[idx] as number }));

  it("지정한 날짜의 일치 개수를 센다", () => {
    expect(matchAtDate(rowsAt(3), series, "20260409")).toEqual({ matched: 30, compared: 30 });
    expect(matchAtDate(rowsAt(3), series, "20260408")).toEqual({ matched: 0, compared: 30 });
    expect(matchAtDate(rowsAt(3), series, "20250101")).toEqual({ matched: 0, compared: 30 }); // 시세에 없는 날짜
  });
  it("현재 목록과 양쪽 모두 99.5% 이상 겹치면 현재 데이터로 본다(신규 상장 몇 개가 있어도)", () => {
    const current = new Set(Array.from({ length: 1000 }, (_, i) => String(300000 + i)));
    const rows: KrxRow[] = [...current].map((c) => ({ code: c, name: c, close: 1 }));
    expect(looksLikeCurrentList(rows, current)).toBe(true);
    expect(looksLikeCurrentList([...rows, { code: "999999", name: "신규", close: 1 }], current)).toBe(true); // 1개 더 있음
    expect(looksLikeCurrentList(rows.slice(1), current)).toBe(true); // 1개 덜 있음
  });
  it("과거 파일(상당수가 현재 목록에 없거나, 현재 목록의 상당수가 파일에 없음)은 통과", () => {
    const current = new Set(Array.from({ length: 1000 }, (_, i) => String(300000 + i)));
    const rows: KrxRow[] = [...current].map((c) => ({ code: c, name: c, close: 1 }));
    const older = [...rows.slice(0, 900), ...Array.from({ length: 21 }, (_, i) => ({ code: String(900000 + i), name: "폐지", close: 1 }))];
    expect(looksLikeCurrentList(older, current)).toBe(false);
    expect(looksLikeCurrentList([], current)).toBe(false);
  });
});

describe("parseDeriveArgs", () => {
  it("파일만, 파일 1개 + --date, --date=값 형태", () => {
    expect(parseDeriveArgs(["a.csv", "b.csv"])).toEqual({ paths: ["a.csv", "b.csv"], date: undefined });
    expect(parseDeriveArgs(["a.csv", "--date", "20260410"])).toEqual({ paths: ["a.csv"], date: "20260410" });
    expect(parseDeriveArgs(["--date=2026-04-10", "a.csv"])).toEqual({ paths: ["a.csv"], date: "2026-04-10" });
  });
  it("조용히 무시하면 안 되는 잘못된 사용은 모두 오류", () => {
    const err = (a: string[]) => ("error" in (parseDeriveArgs(a) as object) ? (parseDeriveArgs(a) as { error: string }).error : null);
    expect(err([])).toMatch(/경로를 하나 이상/);
    expect(err(["--date", "20260410"])).toMatch(/경로를 하나 이상/);
    expect(err(["a.csv", "--date"])).toMatch(/값이 필요/); // 값이 없음
    expect(err(["a.csv", "--date", "--foo"])).toMatch(/값이 필요/); // 값 자리에 다른 옵션
    expect(err(["a.csv", "--date", "20260230"])).toMatch(/올바른 날짜/);
    expect(err(["a.csv", "--date=abc"])).toMatch(/올바른 날짜/);
    expect(err(["a.csv", "--date", "20260410", "--date", "20260101"])).toMatch(/한 번만/);
    expect(err(["a.csv", "--date", "20260410", "--date=20260101"])).toMatch(/한 번만/);
    expect(err(["a.csv", "b.csv", "--date", "20260410"])).toMatch(/파일이 1개일 때만/);
    expect(err(["a.csv", "--force"])).toMatch(/알 수 없는 옵션/);
  });
});

/** deriveDelisted 통합 시나리오: 임시 폴더에 작은 가짜 저장소(스냅샷·시세 캐시)를 만들고 실제 코드를 돌린다. 네트워크는 쓰지 않는다. */
describe("deriveDelisted", () => {
  const AS_OF = "20261008";
  const NOW = Array.from({ length: 300 }, (_, i) => String(400000 + i)); // 현재 상장 ETF
  let dir = "";
  let prev = "";
  let dates: string[] = [];

  const closeOf = (k: number, i: number) => 10_000 + k * 53 + i * 40; // 날짜마다 0.4% 이상 달라 날짜 추정이 모호하지 않다
  const csv = (rows: { code: string; name: string; close: number }[]) => `종목코드,종목명,종가\n${rows.map((r) => `${r.code},${r.name},${r.close}`).join("\n")}`;
  const nowRowsAt = (date: string, n = NOW.length) => NOW.slice(0, n).map((code, k) => ({ code, name: `ETF${k}`, close: closeOf(k, dates.indexOf(date)) }));
  const write = async (name: string, text: string) => {
    const p = join(dir, name);
    await writeFile(p, text);
    return p;
  };
  const series = (lastDate: string, days: number): PriceSeries => {
    const end = dates.indexOf(lastDate);
    const d = dates.slice(Math.max(0, end - days + 1), end + 1);
    return { dates: d, close: d.map((_, i) => 1000 + i), volume: d.map(() => 10) };
  };
  const stubFetch = (map: Record<string, PriceSeries | Error>) => async (code: string) => {
    const v = map[code];
    if (!v) throw new Error(`네이버에 없는 코드 ${code}`);
    if (v instanceof Error) throw v;
    return v;
  };

  beforeEach(async () => {
    prev = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "derive-delisted-"));
    process.chdir(dir);
    // 2026-01-05 부터 AS_OF 까지 평일
    dates = [];
    for (const d = new Date(Date.UTC(2026, 0, 5)); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
      if (s > AS_OF) break;
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(s);
    }
    await mkdir("public/data", { recursive: true });
    await writeFile("public/data/snapshot.json", JSON.stringify({ version: 1, generatedAt: "", asOf: AS_OF, source: "t", etfs: NOW.map((code) => ({ code })) }));
    await mkdir(".cache/naver/price", { recursive: true });
    for (const [k, code] of NOW.entries()) {
      const data: PriceSeries = { dates, close: dates.map((_, i) => closeOf(k, i)), volume: dates.map(() => 100) };
      await writeFile(`.cache/naver/price/${code}.json`, JSON.stringify({ fetchedOn: "20261008", data }));
    }
  });
  afterEach(async () => {
    process.chdir(prev);
    await rm(dir, { recursive: true, force: true });
  });

  const extras = (name: string) => [{ code: "0AAAA0", name: `${name}A`, close: 5000 }, { code: "0BBBB0", name: `${name}B`, close: 5000 }, { code: "0CCCC0", name: `${name}C`, close: 5000 }];
  const fetches = () => stubFetch({ "0AAAA0": series("20260624", 120), "0BBBB0": series("20261007", 120), "0CCCC0": series("20260301", 30) });

  it("정상 파일: 날짜를 추정하고 폐지·거래 중·시세 부족을 가려 저장한다", async () => {
    const f = await write("a.csv", csv([...nowRowsAt("20260410", 280), ...extras("옛")]));
    const r = await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    expect(r.files[0]).toMatchObject({ verdict: "ok", date: "20260410" });
    expect(r.delisted.map((d) => d.code)).toEqual(["0AAAA0"]);
    expect(r.delisted[0]!.delistedOn).toBe("20260624");
    expect(r.stillTrading.map((d) => d.code)).toEqual(["0BBBB0"]);
    expect(r.noPrices.map((d) => d.code)).toEqual(["0CCCC0"]);
    expect(parseDelistedCsv(await readFile("data/delisted.csv", "utf8"))).toEqual([{ code: "0AAAA0", name: "옛A", delistedOn: "20260624" }]);
    expect(JSON.parse(await readFile("data/delisted.meta.json", "utf8"))).toEqual({ snapshots: ["20260410"] });
    expect(r).toMatchObject({ added: 1, changed: 0, total: 1 });
  });

  it("오늘 데이터(종목·종가가 현재와 같음)는 거부하고 아무것도 저장하지 않는다", async () => {
    const f = await write("today.csv", csv(nowRowsAt(AS_OF)));
    const r = await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    expect(r.files[0]).toMatchObject({ verdict: "rejected", date: AS_OF });
    expect(r.files[0]!.note).toContain("현재(오늘) 데이터");
    expect(existsSync("data/delisted.csv")).toBe(false);
    expect(existsSync("data/delisted.meta.json")).toBe(false);
  });

  it("신규 상장이 하나 섞여 종목 집합이 달라도 오늘 데이터를 거부한다(--date 로 과거 날짜를 우겨도)", async () => {
    const rows = [...nowRowsAt(AS_OF), { code: "0NEW00", name: "신규", close: 7000 }];
    const f = await write("today1.csv", csv(rows));
    for (const date of [undefined, AS_OF]) {
      const r = await deriveDelisted([{ path: f, date }], () => {}, { fetchPrices: fetches() });
      expect(r.files[0]!.verdict).toBe("rejected");
    }
    // 종가가 시세 캐시와 어긋나도(추정 실패) --date 로 과거 날짜를 지정해 우회할 수 없다
    const drift = await write("today-drift.csv", csv(rows.map((x) => ({ ...x, close: Math.round(x.close * 1.03) }))));
    const r = await deriveDelisted([{ path: drift, date: "20260410" }], () => {}, { fetchPrices: fetches() });
    expect(r.files[0]!.verdict).toBe("rejected");
    expect(existsSync("data/delisted.meta.json")).toBe(false);
  });

  it("종목 구성이 현재와 달라도, 날짜가 데이터 기준일 7일 이내면 거부(방금 받은 최근 파일)", async () => {
    const f = await write("recent.csv", csv([...nowRowsAt("20261005", 250), ...extras("옛")]));
    const r = await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    expect(r.files[0]).toMatchObject({ verdict: "rejected", date: "20261005" });
    expect(existsSync("data/delisted.meta.json")).toBe(false);
  });

  it("--date 가 종가로 추정한 날짜와 다르면 거부", async () => {
    const f = await write("a.csv", csv([...nowRowsAt("20260410", 280), ...extras("옛")]));
    const r = await deriveDelisted([{ path: f, date: "20260409" }], () => {}, { fetchPrices: fetches() });
    expect(r.files[0]).toMatchObject({ verdict: "rejected" });
    expect(r.files[0]!.note).toMatch(/20260409.*20260410/);
    expect(existsSync("data/delisted.meta.json")).toBe(false);
  });

  it("종가가 어느 날짜와도 안 맞는데 --date 로 날짜만 지정하면, 그 날짜의 종가가 맞아야 통과한다", async () => {
    const shifted = [...nowRowsAt("20260410", 280).map((r) => ({ ...r, close: Math.round(r.close * 1.03) })), ...extras("옛")];
    const f = await write("a.csv", csv(shifted));
    const noDate = await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    expect(noDate.files[0]!.note).toContain("--date");
    const withDate = await deriveDelisted([{ path: f, date: "20260410" }], () => {}, { fetchPrices: fetches() });
    expect(withDate.files[0]!.verdict).toBe("rejected");
    expect(withDate.files[0]!.note).toContain("거의 맞지 않습니다");
    expect(existsSync("data/delisted.meta.json")).toBe(false);
  });

  it("달력에 없는 --date 는 거부", async () => {
    const f = await write("a.csv", csv([...nowRowsAt("20260410", 280), ...extras("옛")]));
    const r = await deriveDelisted([{ path: f, date: "20260230" }], () => {}, { fetchPrices: fetches() });
    expect(r.files[0]!.verdict).toBe("rejected");
    expect(r.files[0]!.note).toContain("올바른 날짜");
  });

  it("시세 수집이 하나라도 실패하면 '시세 없음'으로 숨기지 않고 보고하며, 아무것도 저장하지 않는다", async () => {
    const f = await write("a.csv", csv([...nowRowsAt("20260410", 280), ...extras("옛")]));
    const fetchPrices = stubFetch({ "0AAAA0": new Error("HTTP 429"), "0BBBB0": series("20261007", 120), "0CCCC0": series("20260301", 30) });
    const r = await deriveDelisted([{ path: f }], () => {}, { fetchPrices });
    expect(r.failed).toEqual([{ code: "0AAAA0", name: "옛A", reason: "HTTP 429" }]);
    expect(r.noPrices.map((d) => d.code)).toEqual(["0CCCC0"]); // 진짜 시세 부족과 구분된다
    expect(existsSync("data/delisted.csv")).toBe(false);
    expect(existsSync("data/delisted.meta.json")).toBe(false);
  });

  it("파일 여러 개: 두 기준일이 모두 기록되고, 같은 종목은 가장 최근 스냅샷의 이름을 쓴다", async () => {
    const older = await write("old.csv", csv([...nowRowsAt("20260209", 260), { code: "0AAAA0", name: "더 옛날 이름", close: 5000 }, { code: "0DDDD0", name: "더 일찍 폐지", close: 5000 }]));
    const newer = await write("new.csv", csv([...nowRowsAt("20260410", 280), ...extras("최근")]));
    const fetchPrices = stubFetch({ "0AAAA0": series("20260624", 120), "0BBBB0": series("20261007", 120), "0CCCC0": series("20260301", 30), "0DDDD0": series("20260515", 70) });
    const r = await deriveDelisted([{ path: older }, { path: newer }], () => {}, { fetchPrices });
    expect(r.files.map((f) => [f.date, f.verdict])).toEqual([["20260209", "ok"], ["20260410", "ok"]]);
    expect(JSON.parse(await readFile("data/delisted.meta.json", "utf8"))).toEqual({ snapshots: ["20260209", "20260410"] });
    const byCode = new Map(parseDelistedCsv(await readFile("data/delisted.csv", "utf8")).map((e) => [e.code, e]));
    expect(byCode.get("0AAAA0")!.name).toBe("최근A");
    expect(byCode.has("0DDDD0")).toBe(true);
  });

  it("새로 사라진 종목이 없어도 그 기준일은 기록된다(그 이후 폐지분이 없다는 뜻이므로 범위에 포함)", async () => {
    const f = await write("a.csv", csv(nowRowsAt("20260410", 250)));
    const r = await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    expect(r.candidates).toBe(0);
    expect(JSON.parse(await readFile("data/delisted.meta.json", "utf8"))).toEqual({ snapshots: ["20260410"] });
  });

  it("행이 너무 적은 파일(헤더만 등)은 --date 를 줘도 거부한다", async () => {
    const empty = await write("empty.csv", "종목코드,종목명,종가\n");
    const few = await write("few.csv", csv(nowRowsAt("20260410", MIN_KRX_ROWS - 1)));
    for (const f of [empty, few]) {
      const r = await deriveDelisted([{ path: f, date: "20260410" }], () => {}, { fetchPrices: fetches() });
      expect(r.files[0]).toMatchObject({ verdict: "rejected" });
      expect(r.files[0]!.note).toContain("전종목 시세 파일이 아닌 것 같습니다");
    }
    expect(existsSync("data/delisted.meta.json")).toBe(false);
    // 경계: 정확히 MIN_KRX_ROWS 개는 통과
    const ok = await write("ok.csv", csv(nowRowsAt("20260410", MIN_KRX_ROWS)));
    expect((await deriveDelisted([{ path: ok }], () => {}, { fetchPrices: fetches() })).files[0]!.verdict).toBe("ok");
  });

  it("오래된 파일(종가 일치 15%)도 날짜 지정 없이 추정된다", async () => {
    const rows = nowRowsAt("20260410", 280).map((r, i) => (i < 42 ? r : { ...r, close: Math.round(r.close * 1.6) }));
    const r = await deriveDelisted([{ path: await write("old15.csv", csv([...rows, ...extras("옛")])) }], () => {}, { fetchPrices: fetches() });
    expect(r.files[0]).toMatchObject({ verdict: "ok", date: "20260410" });
    expect(r.files[0]!.note).toMatch(/종가 일치 42\/280\(2위 날짜 \d+\)/);
  });

  it("추정이 모호할 때(두 날짜가 비슷하게 맞음) --date 로 지정한 날짜는 그 날짜의 종가가 10% 이상 맞아야 통과한다(경계 포함)", async () => {
    // k개는 04-10 종가, 다른 k개는 04-09 종가, 나머지는 어긋남 → 04-10 과 04-09 가 동률이라 추정은 실패한다
    const rowsAmbiguous = (k: number) =>
      nowRowsAt("20260410", 280).map((r, i) => {
        if (i < k) return r;
        if (i < 2 * k) return { ...r, close: closeOf(i, dates.indexOf("20260409")) };
        return { ...r, close: Math.round(r.close * 1.6) };
      });
    const run = async (k: number, date?: string) =>
      (await deriveDelisted([{ path: await write(`m${k}${date ?? ""}.csv`, csv([...rowsAmbiguous(k), ...extras("옛")])), date }], () => {}, { fetchPrices: fetches() })).files[0]!;
    expect((await run(28)).note).toContain("--date"); // 지정이 없으면 추정 실패
    const accepted = await run(28, "20260410"); // 280개 중 28개 = 정확히 10%
    expect(accepted.verdict).toBe("ok");
    expect(accepted.note).toContain("종가 일치 28/");
    expect((await run(27, "20260410")).verdict).toBe("rejected"); // 27개 = 9.6%
  });

  it("이미 저장된 항목이 있는 상태에서 다시 도출하면 바뀐 것만 '갱신'으로 센다", async () => {
    const f = await write("a.csv", csv([...nowRowsAt("20260410", 280), ...extras("옛")]));
    await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    await writeFile("data/delisted.csv", toDelistedCsv([{ code: "0AAAA0", name: "손으로 고친 이름", delistedOn: "20260624" }]));
    const r = await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    expect(r).toMatchObject({ added: 0, changed: 1, total: 1 });
    expect(parseDelistedCsv(await readFile("data/delisted.csv", "utf8"))[0]!.name).toBe("옛A"); // 새로 도출한 값으로 갱신됨(문서화된 동작)
  });

  it("실행을 나눠도(최근 파일 먼저, 이른 파일 나중) 기준일이 오름차순으로 누적되고 목록은 합쳐진다", async () => {
    const newer = await write("new.csv", csv([...nowRowsAt("20260410", 280), ...extras("최근")]));
    const older = await write("old.csv", csv([...nowRowsAt("20260209", 260), { code: "0DDDD0", name: "더 일찍 폐지", close: 5000 }]));
    const fetchPrices = stubFetch({ "0AAAA0": series("20260624", 120), "0BBBB0": series("20261007", 120), "0CCCC0": series("20260301", 30), "0DDDD0": series("20260515", 70) });
    await deriveDelisted([{ path: newer }], () => {}, { fetchPrices });
    expect(JSON.parse(await readFile("data/delisted.meta.json", "utf8"))).toEqual({ snapshots: ["20260410"] });
    const r = await deriveDelisted([{ path: older }], () => {}, { fetchPrices });
    expect(JSON.parse(await readFile("data/delisted.meta.json", "utf8"))).toEqual({ snapshots: ["20260209", "20260410"] });
    expect(parseDelistedCsv(await readFile("data/delisted.csv", "utf8")).map((e) => e.code).sort()).toEqual(["0AAAA0", "0DDDD0"]);
    expect(r).toMatchObject({ added: 1, total: 2 });
  });

  it("다시 실행해도 결과가 같다(멱등) — 신규 0, 갱신 0", async () => {
    const f = await write("a.csv", csv([...nowRowsAt("20260410", 280), ...extras("옛")]));
    await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    const first = await readFile("data/delisted.csv", "utf8");
    const r = await deriveDelisted([{ path: f }], () => {}, { fetchPrices: fetches() });
    expect(await readFile("data/delisted.csv", "utf8")).toBe(first);
    expect(r).toMatchObject({ added: 0, changed: 0, total: 1 });
  });
});
