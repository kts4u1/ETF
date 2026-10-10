import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { HISTORY_LIMIT_DAYS } from "../core/format";
import { classify } from "../core/taxonomy";
import { cleanSeries, computeMetrics } from "../core/metrics";
import type { HoldingRow } from "../core/holdings";
import type { EtfRecord, PriceSeries, SeriesFile, Snapshot } from "../core/types";
import { cleanDescription, fetchDetail, fetchEtfList, fetchHoldings, fetchPrices, type Detail, type ListItem } from "./naver";
import { buildHoldingsFile } from "./build-holdings";
import { loadDelistedEntries, syncDelisted } from "./delisted";
import { mapPool } from "./pool";

export const CACHE_DIR = ".cache/naver";
export const OUT_DIR = "public/data";
/** 약 8년치. 5년 지표 + 백테스트 학습 구간 확보용. */
const PRICE_DAYS = HISTORY_LIMIT_DAYS;
/** 차트용 주간 격자 길이(약 5년). */
const GRID_WEEKS = 260;

interface SyncOptions {
  /** 오늘 받은 캐시가 있어도 다시 받는다 */
  force?: boolean;
  /** 개발용: 상위 N개만 */
  limit?: number;
  concurrency?: number;
  /** 구성종목(겹침 분석용) 수집을 건너뛴다 */
  skipHoldings?: boolean;
  log?: (msg: string) => void;
}

const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

interface Cached<T> {
  fetchedOn: string;
  data: T;
}

async function readCache<T>(path: string): Promise<Cached<T> | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as Cached<T>;
  } catch {
    return null;
  }
}

/** 같은 날 받은 캐시가 있으면 재사용하고, 없으면 load 로 받아 저장한다. */
export async function cachedJson<T>(path: string, force: boolean, load: () => Promise<T>): Promise<T> {
  if (!force) {
    const c = await readCache<T>(path);
    if (c && c.fetchedOn === today()) return c.data;
  }
  const data = await load();
  await writeFile(path, JSON.stringify({ fetchedOn: today(), data } satisfies Cached<T>));
  return data;
}

/** 백테스트 등 오프라인 작업에서 캐시된 시세를 읽는다. */
export async function loadCachedPrices(code: string): Promise<PriceSeries | null> {
  const c = await readCache<PriceSeries>(join(CACHE_DIR, "price", `${code}.json`));
  return c ? c.data : null;
}

export async function loadCachedHoldings(code: string): Promise<HoldingRow[] | null> {
  const c = await readCache<HoldingRow[]>(join(CACHE_DIR, "holdings", `${code}.json`));
  return c ? c.data : null;
}

export async function loadCachedList(): Promise<ListItem[] | null> {
  const c = await readCache<ListItem[]>(join(CACHE_DIR, "list.json"));
  return c ? c.data : null;
}

export async function syncAll(opts: SyncOptions = {}): Promise<{ snapshot: Snapshot; failed: string[] }> {
  const log = opts.log ?? (() => {});
  const force = opts.force ?? false;
  const concurrency = opts.concurrency ?? 6;
  await mkdir(join(CACHE_DIR, "price"), { recursive: true });
  await mkdir(join(CACHE_DIR, "detail"), { recursive: true });
  await mkdir(join(CACHE_DIR, "holdings"), { recursive: true });
  await mkdir(OUT_DIR, { recursive: true });

  log("ETF 목록 수집 중…");
  // 목록은 항상 새로 받는다(가격·순자산이 매일 바뀜).
  let list = await fetchEtfList();
  await writeFile(join(CACHE_DIR, "list.json"), JSON.stringify({ fetchedOn: today(), data: list }));
  if (opts.limit) list = list.slice(0, opts.limit);
  log(`  ${list.length}개 ETF`);

  const progress = (label: string) => {
    let last = 0;
    return (done: number, total: number) => {
      if (done === total || done - last >= 100) {
        last = done;
        log(`  ${label} ${done}/${total}`);
      }
    };
  };

  log("일별 시세 수집 중…");
  const priceRun = await mapPool(
    list,
    concurrency,
    (it) => cachedJson(join(CACHE_DIR, "price", `${it.code}.json`), force, () => fetchPrices(it.code, PRICE_DAYS)),
    progress("시세"),
  );

  log("상세 정보(총보수·분배율·설명) 수집 중…");
  const detailRun = await mapPool(
    list,
    concurrency,
    (it) => cachedJson<Detail>(join(CACHE_DIR, "detail", `${it.code}.json`), force, () => fetchDetail(it.code)),
    progress("상세"),
  );

  let holdingsFailed = 0;
  if (!opts.skipHoldings) {
    log("구성종목(PDF) 수집 중…");
    const holdingsRun = await mapPool(
      list,
      concurrency,
      (it) => cachedJson(join(CACHE_DIR, "holdings", `${it.code}.json`), force, () => fetchHoldings(it.code)),
      progress("구성종목"),
    );
    holdingsFailed = holdingsRun.errors.size;
  }

  // 선택: 사용자가 data/delisted.csv 로 제공한 상장폐지 ETF의 시세(백테스트 생존편향 보정용)
  const delisted = await loadDelistedEntries();
  if (delisted.length > 0) {
    log(`상장폐지 ETF ${delisted.length}개(data/delisted.csv) 시세 수집 중…`);
    const r = await syncDelisted(delisted, PRICE_DAYS, concurrency, log);
    for (const s of r.skipped.slice(0, 10)) log(`  건너뜀 ${s.code}: ${s.reason}`);
  }

  const failed: string[] = [];
  const etfs: EtfRecord[] = [];
  const cleaned = new Map<string, PriceSeries>();

  list.forEach((it, i) => {
    const raw = priceRun.results[i];
    if (!raw) {
      failed.push(`${it.code} ${it.name} (시세)`);
      return;
    }
    const series = cleanSeries(raw);
    const m = computeMetrics(series);
    if (!m) {
      failed.push(`${it.code} ${it.name} (시세 부족)`);
      return;
    }
    const d = detailRun.results[i];
    if (!d) failed.push(`${it.code} ${it.name} (상세 — 총보수 등 없이 포함)`);
    cleaned.set(it.code, series);
    etfs.push({
      code: it.code,
      name: it.name,
      issuer: d?.issuer ?? null,
      price: it.price,
      changeRate: it.changeRate,
      aumEok: it.aumEok,
      fee: d?.fee ?? null,
      divYield: d?.divYield ?? null,
      navGap: it.nav && it.nav > 0 ? round((it.price / it.nav - 1) * 100, 2) : null,
      // 캐시에는 정리 이전 버전이 남아 있을 수 있어 한 번 더 정리한다(멱등).
      description: cleanDescription(d?.description ?? ""),
      tax: classify(it.name, it.tab),
      m: roundMetrics(m),
    });
  });

  const asOf = etfs.reduce((mx, e) => (e.m.asOf > mx ? e.m.asOf : mx), "");
  const snapshot: Snapshot = {
    version: 1,
    generatedAt: new Date().toISOString(),
    asOf,
    source: "네이버 금융 (finance.naver.com, m.stock.naver.com)",
    etfs,
  };
  await writeFile(join(OUT_DIR, "snapshot.json"), JSON.stringify(snapshot));
  await writeFile(join(OUT_DIR, "series.json"), JSON.stringify(buildSeriesFile(etfs, cleaned)));
  log(`스냅샷 저장: ${etfs.length}개 ETF, 기준일 ${asOf}`);
  if (!opts.skipHoldings) {
    const { available } = await buildHoldingsFile();
    log(`구성종목 저장: ${available}개 ETF에서 겹침 계산 가능${holdingsFailed ? ` (수집 실패 ${holdingsFailed}건)` : ""}`);
  }
  return { snapshot, failed };
}

// ───────── 차트용 주간 시계열 ─────────

/** 가장 긴 히스토리를 가진 ETF의 거래일에서 5거래일마다 하나씩 뽑아 공통 격자로 쓴다(마지막 거래일 포함). */
export function buildSeriesFile(etfs: EtfRecord[], series: Map<string, PriceSeries>): SeriesFile {
  let ref: PriceSeries | undefined;
  for (const e of etfs) {
    const s = series.get(e.code);
    if (s && (!ref || s.dates.length > ref.dates.length)) ref = s;
  }
  if (!ref) return { version: 1, grid: [], s: {} };
  const grid: string[] = [];
  for (let i = ref.dates.length - 1; i >= 0 && grid.length < GRID_WEEKS; i -= 5) grid.push(ref.dates[i]!);
  grid.reverse();

  const out: SeriesFile["s"] = {};
  for (const e of etfs) {
    const s = series.get(e.code);
    if (!s) continue;
    let o = -1;
    const c: number[] = [];
    let p = 0; // s 상에서 grid[g] 이하의 마지막 날짜를 가리키는 포인터
    for (let g = 0; g < grid.length; g++) {
      const gd = grid[g]!;
      while (p + 1 < s.dates.length && s.dates[p + 1]! <= gd) p++;
      if (s.dates[p]! > gd) continue; // 이 격자 시점에는 아직 상장 전
      if (o < 0) o = g;
      c.push(Math.round(s.close[p]! * 100) / 100);
    }
    if (o >= 0) out[e.code] = { o, c };
  }
  return { version: 1, grid, s: out };
}

// ───────── 직렬화 크기 축소용 반올림 ─────────

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function roundMetrics(m: NonNullable<ReturnType<typeof computeMetrics>>) {
  const r = (v: number | null, d = 4) => (v === null ? null : round(v, d));
  return {
    ...m,
    years: round(m.years, 2),
    ret: {
      m1: r(m.ret.m1),
      m3: r(m.ret.m3),
      m6: r(m.ret.m6),
      y1: r(m.ret.y1),
      y3: r(m.ret.y3),
      y5: r(m.ret.y5),
    },
    cagr1y: r(m.cagr1y),
    cagr3y: r(m.cagr3y),
    cagr5y: r(m.cagr5y),
    vol1y: r(m.vol1y),
    vol3y: r(m.vol3y),
    mdd1y: r(m.mdd1y),
    mdd3y: r(m.mdd3y),
    mddAll: r(m.mddAll),
    drawdown: r(m.drawdown),
    sharpe1y: r(m.sharpe1y, 3),
    sharpe3y: r(m.sharpe3y, 3),
    mom12_1: r(m.mom12_1),
    trend200: r(m.trend200),
    avgValue20: m.avgValue20 === null ? null : Math.round(m.avgValue20),
  };
}
