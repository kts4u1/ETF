import { describe, expect, it } from "vitest";
import type { EtfRecord, PriceSeries } from "../core/types";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { weekdays } from "./us.fixtures";
import { assertUniverseUsable, ci95, icInterval, indepRangeText, loadUniverse, mean, phaseCI, stderr, tCritical95, universeAsOf, type Loaded } from "./bt-common";

/** 2023-01-02 부터 평일마다 하나씩, 완만하게 오르는 시세 */
function make(n: number): PriceSeries {
  const dates: string[] = [];
  const d = new Date(Date.UTC(2023, 0, 2));
  while (dates.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const close = dates.map((_, i) => 100 * Math.pow(1.0005, i) * (1 + 0.004 * Math.sin(i)));
  return { dates, close, volume: dates.map(() => 100_000) };
}

const rec = { code: "000001", name: "테스트" } as EtfRecord;

describe("universeAsOf", () => {
  const full = make(500);
  const lastDate = full.dates[full.dates.length - 1] as string;

  it("기준일이 속한 달에 거래가 있는 ETF 는 포함", () => {
    const loaded: Loaded[] = [{ rec, series: full, ended: false }];
    expect(universeAsOf(loaded, "20240531")).toHaveLength(1);
  });

  it("시세가 끝난(상장폐지) ETF 의 마지막 거래가 기준일보다 앞서면 그 기준일에는 제외한다", () => {
    // 마지막 거래일이 기준일(월말) 이전인 경우: 이후 관측이 없어 평가할 수 없다
    const cut = 400;
    const ended: Loaded = { rec, series: { dates: full.dates.slice(0, cut), close: full.close.slice(0, cut), volume: full.volume.slice(0, cut) }, ended: true };
    const lastTrade = ended.series.dates[cut - 1] as string;
    const monthEnd = `${lastTrade.slice(0, 6)}31`;
    expect(lastTrade < monthEnd).toBe(true); // 테스트 전제: 달의 마지막 날 이전에 끝남
    expect(universeAsOf([ended], monthEnd)).toHaveLength(0);
  });

  it("같은 ETF 도 마지막 거래 이전의 기준일에는 포함된다", () => {
    const cut = 400;
    const ended: Loaded = { rec, series: { dates: full.dates.slice(0, cut), close: full.close.slice(0, cut), volume: full.volume.slice(0, cut) }, ended: true };
    expect(universeAsOf([ended], "20240229")).toHaveLength(1);
  });

  it("마지막 거래일 당일이 기준일이어도 제외한다(이후 관측이 없어 단일 평가가 불가능하고 바스켓에서는 현금이 되는 불일치를 막는다)", () => {
    const cut = 400;
    const ended: Loaded = { rec, series: { dates: full.dates.slice(0, cut), close: full.close.slice(0, cut), volume: full.volume.slice(0, cut) }, ended: true };
    const lastTrade = ended.series.dates[cut - 1] as string;
    expect(universeAsOf([ended], lastTrade)).toHaveLength(0);
    // 바로 전 거래일에는 이후 관측이 있으므로 포함
    expect(universeAsOf([ended], ended.series.dates[cut - 2] as string)).toHaveLength(1);
  });

  it("종료 표시가 없는 현재 상장 ETF 는 마지막 거래가 기준일 전이어도 이 규칙으로 제외되지 않는다", () => {
    const loaded: Loaded[] = [{ rec, series: full, ended: false }];
    expect(universeAsOf(loaded, `${lastDate.slice(0, 6)}31`)).toHaveLength(1);
  });
});

describe("tCritical95 / ci95: 겹치지 않는 표본(2~22개)의 95% 신뢰구간", () => {
  it("교과서 t 임계값(양측 95%)과 일치", () => {
    const table: [number, number][] = [[1, 12.706], [2, 4.303], [3, 3.182], [4, 2.776], [5, 2.571], [10, 2.228], [20, 2.086], [30, 2.042]];
    for (const [df, t] of table) expect(tCritical95(df), `df=${df}`).toBeCloseTo(t, 3);
  });
  it("df 1~30 표 전체가 교과서 값과 같다(표를 실수로 고치지 못하게)", () => {
    const ref = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
    ref.forEach((t, i) => expect(tCritical95(i + 1), `df=${i + 1}`).toBeCloseTo(t, 3));
    expect([tCritical95(31), tCritical95(41), tCritical95(61), tCritical95(121)]).toEqual([2.042, 2.021, 2, 1.98]); // 구간별 보수적 근사
  });
  it("자유도가 커질수록 줄어들어 1.96 에 수렴하고, 잘못된 자유도는 NaN", () => {
    for (let df = 1; df < 200; df++) expect(tCritical95(df + 1)).toBeLessThanOrEqual(tCritical95(df));
    expect(tCritical95(1000)).toBeLessThan(1.99);
    expect(tCritical95(1000)).toBeGreaterThanOrEqual(1.96);
    expect(tCritical95(0)).toBeNaN();
    expect(tCritical95(-3)).toBeNaN();
  });
  it("표본이 작을수록 정규분포 1.96 보다 훨씬 넓다: 3개면 2.2배, 2개면 6.5배(작은 표본에서 '유의'가 쉽게 생기던 문제)", () => {
    const three = [3.6, 3.7, 3.9];
    expect(ci95(three) / (1.96 * stderr(three))).toBeCloseTo(4.303 / 1.96, 6);
    const two = [3.6, 3.9];
    expect(ci95(two) / (1.96 * stderr(two))).toBeCloseTo(12.706 / 1.96, 6);
  });
  it("표본이 2개 미만이면 NaN", () => {
    expect(ci95([])).toBeNaN();
    expect(ci95([1])).toBeNaN();
    expect(Number.isFinite(ci95([1, 2]))).toBe(true);
  });
});

describe("phaseCI: 시작 위상 m가지를 모두 평균한 비중첩 표본의 평균·95% 구간", () => {
  const xs = [0.02, -0.01, 0.03, 0.05, 0.0, 0.04, -0.02, 0.06, 0.01, 0.03, 0.02, -0.03]; // 12개월
  it("m=3: 위상 3개의 평균과 구간 반폭을 각각 평균한다(손으로 계산한 값과 일치)", () => {
    const subs = [0, 1, 2].map((p) => xs.filter((_, i) => i % 3 === p));
    const r = phaseCI(xs, 3);
    expect(r.n).toBe(4);
    expect(r.mean).toBeCloseTo(mean(subs.map((x) => mean(x))), 12);
    expect(r.ci).toBeCloseTo(mean(subs.map((x) => ci95(x))), 12);
    expect(r.mean).toBeCloseTo(mean(xs), 12); // 위상별 크기가 같으면 전체 평균과 같다
  });
  it("위상별 표본 수가 다르면(10개월, m=3 → 4·3·3개) 평균은 위상 평균이지 전체 평균이 아니다", () => {
    const ys = [0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1];
    const subs = [0, 1, 2].map((p) => ys.filter((_, i) => i % 3 === p));
    const r = phaseCI(ys, 3);
    expect(r.mean).toBeCloseTo(mean(subs.map((x) => mean(x))), 12);
    expect(r.mean).not.toBeCloseTo(mean(ys), 6);
    expect(r.n).toBe(3);
  });
  it("첫 달부터만 뽑는 방식(위상 0 하나)과 달라질 수 있다 — 그 의존성을 없애는 것이 목적", () => {
    const phase0 = xs.filter((_, i) => i % 3 === 0);
    expect(phaseCI(xs, 3).ci).not.toBeCloseTo(ci95(phase0), 6);
  });
  it("위상별 표본이 2개 미만이면 그 위상은 건너뛴다(예: 23개월, m=12 → 위상 11 만 1개)", () => {
    const long = Array.from({ length: 23 }, (_, i) => (i % 5) / 100);
    const r = phaseCI(long, 12);
    expect(r.n).toBe(2); // 쓴 위상 11개의 크기가 모두 2
    const used = Array.from({ length: 11 }, (_, p) => long.filter((_, i) => i % 12 === p)); // 크기 2 인 위상 11개 (위상 11 은 크기 1 로 제외)
    expect(r.ci).toBeCloseTo(mean(used.map((x) => ci95(x))), 12);
    expect(r.ci).toBeGreaterThan(10 * 0.001); // t(1)=12.7 이라 구간이 매우 넓다
  });
  it("쓸 수 있는 위상이 없으면 구간은 NaN, 평균은 전체 평균", () => {
    const r = phaseCI([0.01, 0.03, 0.05], 12);
    expect(r.ci).toBeNaN();
    expect(r.mean).toBeCloseTo(0.03, 12);
    expect(phaseCI([], 3).mean).toBeNaN();
  });
});

describe("assertUniverseUsable: 시세 캐시가 비었을 때 커밋된 결과를 덮어쓰지 않는다", () => {
  it("현재 상장 ETF의 절반 미만만 읽었으면 중단", () => {
    expect(() => assertUniverseUsable(0, 1172)).toThrow(/npm run sync/);
    expect(() => assertUniverseUsable(585, 1172)).toThrow(/585/);
  });
  it("절반 이상이면 통과, 부분 실행 허용 옵션이면 항상 통과, 스냅샷이 비었으면 통과", () => {
    expect(() => assertUniverseUsable(586, 1172)).not.toThrow();
    expect(() => assertUniverseUsable(1172, 1172)).not.toThrow();
    expect(() => assertUniverseUsable(0, 1172, true)).not.toThrow();
    expect(() => assertUniverseUsable(0, 0)).not.toThrow();
  });
});

describe("phaseCI: 위상별 평균 표본 수가 x.5 일 때의 반올림", () => {
  it("63개월, m=6 → 위상 크기 11·11·11·10·10·10, n=11(커밋된 결과의 n=11 이 이 반올림에 의존)", () => {
    const xs = Array.from({ length: 63 }, (_, i) => Math.sin(i) / 50);
    expect(phaseCI(xs, 6).n).toBe(11);
  });
});

describe("icInterval / indepRangeText", () => {
  it("icInterval: phaseCI 의 구간과 같고, 표본이 모자라면 null(JSON 으로 NaN 이 되지 않게)", () => {
    const xs = Array.from({ length: 30 }, (_, i) => Math.cos(i) / 10);
    expect(icInterval(xs, 3)).toBeCloseTo(phaseCI(xs, 3).ci, 12);
    expect(icInterval(xs, 6)).not.toBeCloseTo(phaseCI(xs, 3).ci, 6); // m 이 구간에 반영된다
    expect(icInterval([0.1, 0.2], 12)).toBeNull();
  });
  it("indepRangeText: 최소~최대", () => {
    expect(indepRangeText([22, 11, 5, 2, 11])).toBe("2~22");
    expect(indepRangeText([4])).toBe("4~4");
  });
});

describe("loadUniverse: 시세 캐시가 모자랄 때 중단(커밋된 결과를 덮어쓰지 않기 위해)", () => {
  let dir = "";
  let prev = "";
  const writeSnapshot = (n: number) => writeFile("public/data/snapshot.json", JSON.stringify({ version: 1, generatedAt: "", asOf: "20261008", source: "t", etfs: Array.from({ length: n }, (_, i) => ({ code: String(100000 + i), name: "t" })) }));
  beforeEach(async () => {
    prev = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "load-universe-"));
    process.chdir(dir);
    await mkdir("public/data", { recursive: true });
    await mkdir(".cache/naver/price", { recursive: true });
  });
  afterEach(async () => {
    delete process.env.BACKTEST_ALLOW_PARTIAL;
    process.chdir(prev);
    await rm(dir, { recursive: true, force: true });
  });

  it("캐시가 비어 있으면 던진다", async () => {
    await writeSnapshot(40);
    await expect(loadUniverse()).rejects.toThrow(/npm run sync/);
  });
  it("sync --limit N 으로 스냅샷이 줄었어도 캐시된 전체 목록을 기준으로 중단한다", async () => {
    await writeSnapshot(5); // --limit 5 가 남긴 스냅샷
    await writeFile(".cache/naver/list.json", JSON.stringify({ fetchedOn: "20261010", data: Array.from({ length: 1172 }, (_, i) => ({ code: String(100000 + i), name: "t" })) }));
    // 시세 캐시는 5개 중 5개 읽혔더라도(100%) 전체 목록 1172개의 절반에 못 미친다
    for (let i = 0; i < 5; i++) {
      const dates = Array.from({ length: 80 }, (_, k) => `2026${String(1 + Math.floor(k / 28)).padStart(2, "0")}${String(1 + (k % 28)).padStart(2, "0")}`);
      await writeFile(`.cache/naver/price/${100000 + i}.json`, JSON.stringify({ fetchedOn: "20261010", data: { dates, close: dates.map((_, k) => 1000 + k), volume: dates.map(() => 10) } }));
    }
    await expect(loadUniverse()).rejects.toThrow(/1172개 중 5개/);
  });
  it("BACKTEST_ALLOW_PARTIAL=1 이면 통과한다", async () => {
    await writeSnapshot(40);
    process.env.BACKTEST_ALLOW_PARTIAL = "1";
    const r = await loadUniverse();
    expect(r.loaded).toHaveLength(0);
  });
});

describe("loadUniverse: 해외 상장 ETF 가 섞인 스냅샷에서도 백테스트 유니버스는 국내 상장만으로 같다", () => {
  let dir = "";
  let prev = "";
  const KR = ["100000", "100001", "100002"];
  const US = ["SPY", "QQQ", "IWM", "TLT", "GLD", "VTI"];
  const krRec = (code: string) => ({ code, name: `국내 ${code}` });
  const usRec = (code: string) => ({ code, name: `US ${code}`, market: "US", priceNative: 100 });
  const snapshot = (etfs: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, generatedAt: "", asOf: "20261008", source: "t", etfs, ...extra });
  const writePrices = async (code: string) => {
    const dates = weekdays(Date.UTC(2026, 4, 1) / 1000, Date.UTC(2026, 9, 8) / 1000); // 5/1 ~ 10/8
    await writeFile(`.cache/naver/price/${code}.json`, JSON.stringify({ fetchedOn: "20261010", data: { dates, close: dates.map((_, k) => 1000 + k), volume: dates.map(() => 10) } }));
  };

  beforeEach(async () => {
    prev = process.cwd();
    dir = await mkdtemp(join(tmpdir(), "load-universe-us-"));
    process.chdir(dir);
    await mkdir("public/data", { recursive: true });
    await mkdir(".cache/naver/price", { recursive: true });
    for (const c of KR) await writePrices(c);
    // 해외 ETF 의 시세가 (잘못) 국내 캐시 폴더에 있어도 유니버스에 들어가면 안 된다
    for (const c of US) await writePrices(c);
  });
  afterEach(async () => {
    delete process.env.BACKTEST_ALLOW_PARTIAL;
    process.chdir(prev);
    await rm(dir, { recursive: true, force: true });
  });

  it("해외 레코드를 읽지 않는다: 국내 3개만 로드된다", async () => {
    await writeFile("public/data/snapshot.json", JSON.stringify(snapshot([...KR.map(krRec), ...US.map(usRec)])));
    const r = await loadUniverse();
    expect(r.loaded.map((l) => l.rec.code)).toEqual(KR);
    expect(r.loaded.every((l) => l.rec.market === undefined)).toBe(true);
  });

  it("국내만 있는 스냅샷과 해외가 섞인 스냅샷의 결과가 완전히 같다(asOf·종료 여부·상장폐지 포함 수)", async () => {
    await writeFile("public/data/snapshot.json", JSON.stringify(snapshot(KR.map(krRec))));
    const domesticOnly = await loadUniverse();
    // 해외 기준일(asOfUs)이 한 달 넘게 뒤여도 종료(endedEarly) 판정은 국내 기준일(asOf)로 한다
    await writeFile("public/data/snapshot.json", JSON.stringify(snapshot([...KR.map(krRec), ...US.map(usRec)], { asOfUs: "20261130", fxUsdKrw: { rate: 1300, date: "20261130" } })));
    const mixed = await loadUniverse();
    expect(mixed).toEqual(domesticOnly);
    expect(mixed.asOf).toBe("20261008");
    expect(mixed.loaded.every((l) => !l.ended)).toBe(true);
  });

  it("전체 개수(fullCount)는 국내 레코드만 센다: 해외가 더 많아도 '절반 미만'으로 중단하지 않는다", async () => {
    // 국내 3개가 모두 읽히지만, 해외 6개를 세면 9개 중 3개(절반 미만)가 되어 던지게 된다
    await writeFile("public/data/snapshot.json", JSON.stringify(snapshot([...KR.map(krRec), ...US.map(usRec)])));
    await expect(loadUniverse()).resolves.toBeTruthy();
  });

  it("국내 시세 캐시가 부족하면 해외가 아무리 많아도 여전히 중단한다(assertUniverseUsable 의 의미 유지)", async () => {
    await rm(".cache/naver/price/100001.json");
    await rm(".cache/naver/price/100002.json");
    await writeFile("public/data/snapshot.json", JSON.stringify(snapshot([...KR.map(krRec), ...US.map(usRec)])));
    await expect(loadUniverse()).rejects.toThrow(/현재 상장 ETF 3개 중 1개만 읽음/);
  });

  it("market 필드가 없는 이전 스냅샷은 모두 국내로 본다", async () => {
    await writeFile("public/data/snapshot.json", JSON.stringify(snapshot(KR.map(krRec))));
    expect((await loadUniverse()).loaded).toHaveLength(3);
  });
});
