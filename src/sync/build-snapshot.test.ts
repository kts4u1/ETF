import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HoldingsFile } from "../core/overlap";
import type { EtfRecord, PriceSeries, SeriesFile, Snapshot } from "../core/types";
import { HttpError } from "./naver";
import * as naver from "./naver";
import { DOMESTIC_SOURCE, buildSeriesFile, composeSnapshot, roundChartClose, syncAll } from "./build-snapshot";
import { NOW, makeDeps, weekdays } from "./us.fixtures";
import type { UsDeps } from "./us";

// syncAll 통합 테스트에서 네이버 호출만 바꿔 끼운다(HttpError·withRetry 는 원본 그대로).
vi.mock("./naver", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./naver")>();
  return { ...orig, fetchEtfList: vi.fn(), fetchPrices: vi.fn(), fetchDetail: vi.fn(), fetchHoldings: vi.fn() };
});

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000;

/** 스냅샷 조립·격자 테스트에 쓰는 최소 레코드 */
const rec = (code: string, asOf: string, market?: "US"): EtfRecord =>
  ({ code, name: code, ...(market ? { market } : {}), m: { asOf } }) as unknown as EtfRecord;

describe("composeSnapshot", () => {
  const kr = [rec("069500", "20261008"), rec("360750", "20261007")];
  const us = { etfs: [rec("SPY", "20261009", "US")], asOfUs: "20261009", fx: { rate: 1340.9, date: "20261010" } };

  it("asOf 는 국내 ETF 만의 최신일이다 — 해외 날짜가 더 늦어도 섞지 않는다(백테스트의 상장폐지 판정 기준)", () => {
    const s = composeSnapshot({ domestic: kr, us, generatedAt: "2026-10-10T00:00:00.000Z" });
    expect(s.asOf).toBe("20261008");
    expect(s.asOfUs).toBe("20261009");
    expect(s.fxUsdKrw).toEqual({ rate: 1340.9, date: "20261010" });
  });

  it("etfs 순서는 국내 먼저, 해외 나중", () => {
    const s = composeSnapshot({ domestic: kr, us: { ...us, etfs: [rec("QQQ", "20261009", "US"), rec("SPY", "20261009", "US")] }, generatedAt: "t" });
    expect(s.etfs.map((e) => e.code)).toEqual(["069500", "360750", "QQQ", "SPY"]);
  });

  it("출처 문자열에 야후 파이낸스·나스닥 목록이 들어간다(국내만이면 기존 문자열 그대로)", () => {
    const withUs = composeSnapshot({ domestic: kr, us, generatedAt: "t" });
    expect(withUs.source).toContain(DOMESTIC_SOURCE);
    expect(withUs.source).toContain("야후 파이낸스");
    expect(withUs.source).toContain("나스닥");
    const krOnly = composeSnapshot({ domestic: kr, us: null, generatedAt: "t" });
    expect(krOnly.source).toBe("네이버 금융 (finance.naver.com, m.stock.naver.com)");
    expect(krOnly).not.toHaveProperty("asOfUs");
    expect(krOnly).not.toHaveProperty("fxUsdKrw");
    expect(krOnly.etfs).toEqual(kr);
  });
});

describe("buildSeriesFile: 국내·해외 거래일이 달라도 주간 격자에 맞는다", () => {
  const seriesOf = (dates: string[], base: number, step: number): PriceSeries => ({ dates, close: dates.map((_, i) => base + i * step), volume: dates.map(() => 1) });
  const without = (dates: string[], ...skip: string[]) => dates.filter((d) => !skip.includes(d));

  // 국내 휴장일은 5/25, 해외 휴장일은 5/25(메모리얼데이)·6/19·7/3. 국내는 7/3 까지, 해외는 4/15 부터 7/3(휴장) 직전까지 있다
  const krDates = without(weekdays(utc(2026, 4, 1), utc(2026, 7, 3)), "20260501", "20260525");
  const usDates = without(weekdays(utc(2026, 4, 15), utc(2026, 7, 3)), "20260525", "20260619", "20260703");
  const kr1 = seriesOf(krDates, 10_000, 100);
  const us1 = seriesOf(usDates, 500_000, 1_000);
  const records = [rec("069500", "20260703"), rec("SPY", "20260702", "US")];
  const series = new Map([
    ["069500", kr1],
    ["SPY", us1],
  ]);
  const file = buildSeriesFile(records, series);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const lastOnOrBefore = (s: PriceSeries, d: string) => s.dates.reduce((r, x, i) => (x <= d ? i : r), -1);

  it("시나리오 전제: 격자의 끝은 해외 휴장일이고, 해외는 격자의 앞부분에서 아직 상장 전이다", () => {
    expect(file.grid.at(-1)).toBe("20260703");
    expect(usDates).not.toContain("20260703");
    expect(file.grid[0]! < "20260415").toBe(true);
  });

  it("격자는 국내 시세의 5거래일 간격이다", () => {
    const expected: string[] = [];
    for (let i = krDates.length - 1; i >= 0; i -= 5) expected.push(krDates[i]!);
    expect(file.grid).toEqual(expected.reverse());
  });

  it("해외 ETF 는 격자 날짜 이하의 마지막 종가를 쓴다(해외 휴장일에는 직전 종가를 이어 쓰고, 상장 전 구간은 시작 위치 o 로 건너뜀)", () => {
    const e = file.s.SPY!;
    const firstIdx = file.grid.findIndex((g) => lastOnOrBefore(us1, g) >= 0);
    expect(firstIdx).toBeGreaterThan(0);
    expect(e.o).toBe(firstIdx);
    expect(e.c).toHaveLength(file.grid.length - firstIdx);
    file.grid.slice(firstIdx).forEach((g, k) => expect(e.c[k], g).toBe(round2(us1.close[lastOnOrBefore(us1, g)]!)));
    // 마지막 격자(7/3, 해외 휴장)는 7/2 종가
    expect(e.c.at(-1)).toBe(round2(us1.close[us1.dates.indexOf("20260702")]!));
  });

  it("국내 ETF 의 차트는 해외 ETF 가 있든 없든, 해외 시세가 더 길든 짧든 똑같다", () => {
    const krOnly = buildSeriesFile([rec("069500", "20260703")], new Map([["069500", kr1]]));
    expect(file.grid).toEqual(krOnly.grid);
    expect(file.s["069500"]).toEqual(krOnly.s["069500"]);
    // 해외 쪽이 훨씬 긴 이력을 가져도 격자 기준은 국내
    const longUs = seriesOf(weekdays(utc(2018, 1, 1), utc(2026, 7, 2)), 100, 1);
    const longFile = buildSeriesFile(records, new Map([["069500", kr1], ["SPY", longUs]]));
    expect(longFile.grid).toEqual(krOnly.grid);
    expect(longFile.s["069500"]).toEqual(krOnly.s["069500"]);
    expect(longFile.s.SPY!.o).toBe(0);
  });

  it("해외 시세가 국내 마지막 격자보다 일찍 끝나도 마지막 종가를 이어 쓴다", () => {
    const stale = seriesOf(weekdays(utc(2026, 4, 15), utc(2026, 6, 26)), 1, 1);
    const f = buildSeriesFile(records, new Map([["069500", kr1], ["SPY", stale]]));
    expect(f.s.SPY!.c.at(-1)).toBe(stale.close.at(-1));
  });

  it("국내 ETF 가 없으면 해외 시세로 격자를 만들고, 시세가 아무것도 없으면 빈 격자", () => {
    const f = buildSeriesFile([rec("SPY", "20260702", "US")], new Map([["SPY", us1]]));
    expect(f.grid.at(-1)).toBe(us1.dates.at(-1));
    expect(f.s.SPY!.o).toBe(0);
    expect(buildSeriesFile(records, new Map())).toEqual({ version: 1, grid: [], s: {} });
  });
});

describe("roundChartClose / series.json 의 종가 정밀도", () => {
  it("1,000원 이상은 원 단위, 미만은 소수 둘째 자리 — 국내 정수 종가는 그대로", () => {
    expect(roundChartClose(1_045_611.7265)).toBe(1_045_612);
    expect(roundChartClose(1000)).toBe(1000);
    expect(roundChartClose(999.456)).toBe(999.46);
    expect(roundChartClose(35_000)).toBe(35_000);
    expect(roundChartClose(512)).toBe(512);
  });

  it("해외 ETF 의 원화 환산 종가는 정수로 저장되고 국내 값은 바뀌지 않는다", () => {
    const dates = weekdays(utc(2026, 5, 1), utc(2026, 6, 30));
    const kr: PriceSeries = { dates, close: dates.map((_, i) => 10_000 + i), volume: dates.map(() => 1) };
    const us: PriceSeries = { dates, close: dates.map((_, i) => 1_045_611.7265 + i * 0.3333), volume: dates.map(() => 1) };
    const f = buildSeriesFile([rec("069500", "x"), rec("SPY", "x", "US")], new Map([["069500", kr], ["SPY", us]]));
    expect(f.s["069500"]!.c.every(Number.isInteger)).toBe(true);
    expect(f.s.SPY!.c.every(Number.isInteger)).toBe(true);
    expect(f.s.SPY!.c.at(-1)).toBe(Math.round(us.close.at(-1)!));
  });
});

// ───────── syncAll: 국내 → 미국 → 파일 쓰기 ─────────

describe("syncAll", () => {
  let dir = "";
  let prev = "";
  const logs: string[] = [];
  const log = (m: string) => logs.push(m);

  const ROWS = [
    { code: "069500", name: "KODEX 200", tab: 1, price: 35_000, changeRate: 0.5, nav: 35_010, aumEok: 50_000 },
    { code: "360750", name: "TIGER 미국S&P500", tab: 4, price: 20_000, changeRate: -0.2, nav: 20_005, aumEok: 40_000 },
  ] as const;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    prev = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "sync-all-"));
    process.chdir(dir);
    logs.length = 0;
    // 국내 시세: 마지막 거래일 20261008(미국보다 하루 이르다)
    const krDates = weekdays(utc(2025, 1, 1), utc(2026, 10, 8));
    vi.mocked(naver.fetchEtfList).mockResolvedValue(ROWS.map((r) => ({ ...r })) as never);
    vi.mocked(naver.fetchPrices).mockResolvedValue({ dates: krDates, close: krDates.map((_, i) => 10_000 + i * 10), volume: krDates.map(() => 1_000) });
    vi.mocked(naver.fetchDetail).mockResolvedValue({ issuer: "삼성", fee: 0.15, divYield: 1.2, description: "설명" });
    vi.mocked(naver.fetchHoldings).mockResolvedValue([]);
  });
  afterEach(async () => {
    vi.useRealTimers();
    process.chdir(prev);
    await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  const out = (f: string) => join("public", "data", f);
  const readJson = async <T>(f: string) => JSON.parse(await readFile(out(f), "utf8")) as T;
  const OLD = { snapshot: '{"old":"snapshot"}', series: '{"old":"series"}', holdings: '{"old":"holdings"}' };
  async function seedOld() {
    await mkdir(join("public", "data"), { recursive: true });
    await writeFile(out("snapshot.json"), OLD.snapshot);
    await writeFile(out("series.json"), OLD.series);
    await writeFile(out("holdings.json"), OLD.holdings);
  }
  async function expectUntouched() {
    expect(await readFile(out("snapshot.json"), "utf8")).toBe(OLD.snapshot);
    expect(await readFile(out("series.json"), "utf8")).toBe(OLD.series);
    expect(await readFile(out("holdings.json"), "utf8")).toBe(OLD.holdings);
  }

  it("국내 → 미국 순으로 수집하고 snapshot·series·holdings 를 함께 쓴다", async () => {
    const { deps } = makeDeps(["SPY", "QQQ"], { SPY: { info: { totalAssets: 50e9 } }, QQQ: { info: { totalAssets: 20e9 } } });
    const r = await syncAll({ usDeps: deps, log });

    const snap = await readJson<Snapshot>("snapshot.json");
    expect(snap.etfs.map((e) => e.code)).toEqual(["069500", "360750", "SPY", "QQQ"]);
    expect(snap.asOf).toBe("20261008"); // 국내 기준일 — 해외(20261009)가 아님
    expect(snap.asOfUs).toBe("20261009");
    expect(snap.fxUsdKrw).toEqual({ rate: 1300, date: "20261010" });
    expect(snap.source).toContain("야후 파이낸스");
    expect(snap.etfs[0]).not.toHaveProperty("market"); // 국내 레코드는 이전과 같은 모양
    expect(snap.etfs[2]).toMatchObject({ code: "SPY", market: "US", exchange: "NYSE Arca" });
    expect(r.snapshot.asOf).toBe(snap.asOf);
    expect(r.usStats?.final).toBe(2);
    expect(r.failed).toEqual([]);

    const series = await readJson<SeriesFile>("series.json");
    expect(Object.keys(series.s).sort()).toEqual(["069500", "360750", "QQQ", "SPY"]);
    expect(series.grid.at(-1)).toBe("20261008"); // 격자 기준은 국내

    const holdings = await readJson<HoldingsFile>("holdings.json");
    expect(holdings.unavailable.SPY).toBe("overseas-listed");
    expect(holdings.unavailable.QQQ).toBe("overseas-listed");
    expect(holdings.asOf).toBe("20261008");
    expect(vi.mocked(naver.fetchHoldings).mock.calls.map((c) => c[0]).sort()).toEqual(["069500", "360750"]); // 해외는 구성종목을 찾지 않는다
  });

  it("미국 수집이 실패하면 아무 파일도 쓰지 않고 오류로 끝난다(목록 실패)", async () => {
    await seedOld();
    const { deps } = makeDeps(["SPY"], {}, { fetchNasdaqList: async () => Promise.reject(new HttpError(403, "nasdaq")) });
    await expect(syncAll({ usDeps: deps, log })).rejects.toThrow(/미국 ETF 수집 중단.*나스닥 ETF 목록/);
    await expectUntouched();
  });

  it("환율 실패, 종목별 실패율 초과도 마찬가지로 아무 파일도 쓰지 않는다", async () => {
    await seedOld();
    const syms = Array.from({ length: 10 }, (_, i) => `U${String.fromCharCode(65 + i)}`);
    const base = makeDeps(syms, {}).deps;
    const noFx: UsDeps = { ...base, fetchChart: async (s, a, b, o) => (s === "KRW=X" ? Promise.reject(new HttpError(500, "fx")) : base.fetchChart(s, a, b, o)) };
    await expect(syncAll({ usDeps: noFx, log })).rejects.toThrow(/환율/);
    await expectUntouched();

    const flaky = makeDeps(syms, { UA: { chartError: "quick" }, UB: { chartError: "quick" } }).deps; // 10개 중 2개(20%)
    await expect(syncAll({ usDeps: flaky, force: true, log })).rejects.toThrow(/1차\(시세\)/);
    await expectUntouched();
  });

  it("처음 실행에서 미국이 실패해도 산출물 파일이 생기지 않는다", async () => {
    const { deps } = makeDeps(["SPY"], {}, { openSession: async () => Promise.reject(new Error("쿠키 없음")) });
    await expect(syncAll({ usDeps: deps, log })).rejects.toThrow(/세션/);
    await expect(readFile(out("snapshot.json"), "utf8")).rejects.toThrow();
    await expect(readFile(out("series.json"), "utf8")).rejects.toThrow();
    await expect(readFile(out("holdings.json"), "utf8")).rejects.toThrow();
  });

  it("미국 종목별 실패(10% 이내)는 failed 에 담겨 돌아오고 나머지는 저장된다", async () => {
    const syms = Array.from({ length: 20 }, (_, i) => `V${String.fromCharCode(65 + i)}`);
    const { deps } = makeDeps(syms, { VA: { info: "error" } });
    const r = await syncAll({ usDeps: deps, log, skipHoldings: true });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatch(/^미국 VA /);
    expect((await readJson<Snapshot>("snapshot.json")).etfs).toHaveLength(2 + 19);
  });

  it("--skip-us: 국내만 저장하고, 기존 파일의 해외 ETF 가 지워진다는 것을 로그로 분명히 알린다", async () => {
    await mkdir(join("public", "data"), { recursive: true });
    const old = { version: 1, asOf: "20261001", etfs: [{ code: "069500" }, { code: "SPY", market: "US" }, { code: "QQQ", market: "US" }, { code: "IWM", market: "US" }] };
    await writeFile(out("snapshot.json"), JSON.stringify(old));
    const { deps, n } = makeDeps(["SPY"], {});
    const r = await syncAll({ skipUs: true, usDeps: deps, log, skipHoldings: true });
    expect(n.list).toBe(0); // 미국 수집은 시작도 하지 않는다
    expect(n.chart).toEqual([]);
    const warn = logs.find((l) => l.includes("--skip-us"));
    expect(warn).toContain("⚠");
    expect(warn).toContain("3개");
    expect(warn).toContain("지워집니다");
    const snap = await readJson<Snapshot>("snapshot.json");
    expect(snap.etfs.map((e) => e.code)).toEqual(["069500", "360750"]);
    expect(snap).not.toHaveProperty("asOfUs");
    expect(snap).not.toHaveProperty("fxUsdKrw");
    expect(snap.source).toBe(DOMESTIC_SOURCE);
    expect(r.usStats).toBeUndefined();
  });

  it("--skip-us 인데 기존 해외 ETF 가 없으면 지운다는 경고 없이 국내만 저장한다고만 알린다", async () => {
    await syncAll({ skipUs: true, log, skipHoldings: true });
    const warn = logs.find((l) => l.includes("--skip-us"));
    expect(warn).toContain("국내만 저장");
    expect(warn).not.toContain("지워집니다");
  });

  it("--us-limit 는 미국 수집에 전달된다", async () => {
    const { deps, n } = makeDeps(["AAA", "BBB", "CCC"], { AAA: { shape: { vol: 900_000 } }, BBB: { shape: { vol: 800_000 } }, CCC: { shape: { vol: 700_000 } } });
    await syncAll({ usDeps: deps, usLimit: 2, log, skipHoldings: true });
    expect(n.info.sort()).toEqual(["AAA", "BBB"]);
  });
});
