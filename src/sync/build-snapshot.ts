import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HISTORY_LIMIT_DAYS } from "../core/format";
import { marketOf } from "../core/market";
import { classify } from "../core/taxonomy";
import { cleanSeries, computeMetrics } from "../core/metrics";
import type { HoldingRow } from "../core/holdings";
import type { EtfRecord, PriceSeries, SeriesFile, Snapshot } from "../core/types";
import { cleanDescription, fetchDetail, fetchEtfList, fetchHoldings, fetchPrices, type Detail, type ListItem } from "./naver";
import { buildHoldingsFile } from "./build-holdings";
import { cachedJson, readCache, today } from "./cache";
import { loadDelistedEntries, syncDelisted } from "./delisted";
import { mapPool } from "./pool";
import { round, roundMetrics } from "./rounding";
import { syncUs, type UsDeps, type UsStats, type UsSyncResult } from "./us";

// 다른 모듈이 예전처럼 build-snapshot 에서 가져다 쓸 수 있게 다시 내보낸다.
export { cachedJson, roundMetrics };

export const CACHE_DIR = ".cache/naver";
export const OUT_DIR = "public/data";
/** 약 8년치. 5년 지표 + 백테스트 학습 구간 확보용. */
const PRICE_DAYS = HISTORY_LIMIT_DAYS;
/** 차트용 주간 격자 길이(약 5년). */
const GRID_WEEKS = 260;

export interface SyncOptions {
  /** 오늘 받은 캐시가 있어도 다시 받는다 */
  force?: boolean;
  /** 개발용: 상위 N개만 */
  limit?: number;
  concurrency?: number;
  /** 구성종목(겹침 분석용) 수집을 건너뛴다 */
  skipHoldings?: boolean;
  /**
   * 미국 상장 ETF 수집을 건너뛰고 국내만 저장한다. 기존 snapshot.json 에 해외 ETF 가 있었다면
   * 이번 저장에서 빠지므로(지워지므로) 로그로 알린다.
   */
  skipUs?: boolean;
  /** 개발용: 미국 ETF 는 거래대금 상위 N개만 */
  usLimit?: number;
  /** 미국 수집의 네트워크 계층 교체(테스트용) */
  usDeps?: UsDeps;
  log?: (msg: string) => void;
}

export const DOMESTIC_SOURCE = "네이버 금융 (finance.naver.com, m.stock.naver.com)";
export const US_SOURCE = "야후 파이낸스 (finance.yahoo.com — 미국 상장 시세·분배금·환율·펀드 정보), 나스닥 ETF 목록 (api.nasdaq.com)";

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

export async function syncAll(opts: SyncOptions = {}): Promise<{ snapshot: Snapshot; failed: string[]; usStats?: UsStats }> {
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

  // 미국 수집은 국내 수집이 끝난 뒤에 한다. 실패하면 여기서 던져, 아래의 파일 쓰기가 일어나지 않는다
  // (국내만 새것이고 해외는 없거나 묵은 상태의 불완전한 스냅샷을 남기지 않기 위해서).
  let us: UsSyncResult | null = null;
  if (opts.skipUs) {
    const prev = await readExistingOverseasCount();
    log(
      prev > 0
        ? `⚠ --skip-us: 해외(미국) ETF 수집을 건너뜁니다. 기존 snapshot.json 의 해외 ETF ${prev}개는 이번 저장에서 빠집니다(지워집니다).`
        : "⚠ --skip-us: 해외(미국) ETF 수집을 건너뜁니다. 해외 ETF 없이 국내만 저장합니다.",
    );
  } else {
    us = await syncUs({ force, limit: opts.usLimit, concurrency, log }, opts.usDeps);
    for (const f of us.failed) failed.push(`미국 ${f}`);
  }

  const snapshot = composeSnapshot({ domestic: etfs, us, generatedAt: new Date().toISOString() });
  const allSeries = new Map(cleaned);
  if (us) for (const [code, s] of us.series) allSeries.set(code, s);
  await writeFile(join(OUT_DIR, "snapshot.json"), JSON.stringify(snapshot));
  await writeFile(join(OUT_DIR, "series.json"), JSON.stringify(buildSeriesFile(snapshot.etfs, allSeries)));
  log(`스냅샷 저장: 국내 ${etfs.length}개${us ? ` + 해외(미국) ${us.etfs.length}개` : ""}, 국내 기준일 ${snapshot.asOf}${snapshot.asOfUs ? `, 해외 기준일 ${snapshot.asOfUs}` : ""}`);
  if (!opts.skipHoldings) {
    const { available } = await buildHoldingsFile();
    log(`구성종목 저장: ${available}개 ETF에서 겹침 계산 가능${holdingsFailed ? ` (수집 실패 ${holdingsFailed}건)` : ""}`);
  }
  return { snapshot, failed, usStats: us?.stats };
}

/** 기존 snapshot.json 에 들어 있는 해외 ETF 수(없거나 읽을 수 없으면 0) */
async function readExistingOverseasCount(): Promise<number> {
  try {
    const prev = JSON.parse(await readFile(join(OUT_DIR, "snapshot.json"), "utf8")) as Partial<Snapshot>;
    return Array.isArray(prev.etfs) ? prev.etfs.filter((e) => marketOf(e) !== "KR").length : 0;
  } catch {
    return 0;
  }
}

/**
 * 국내 레코드와 (있으면) 해외 수집 결과로 스냅샷을 만든다. etfs 는 국내가 먼저, 해외가 나중이다.
 * asOf 는 반드시 국내 ETF 만의 최신일이다 — 백테스트가 이 날짜로 상장폐지 여부를 판정하므로,
 * 시차가 다른 해외 날짜가 섞이면 판정이 어긋난다. 해외 최신일은 asOfUs, 환율은 fxUsdKrw 에 따로 둔다.
 */
export function composeSnapshot(args: {
  domestic: EtfRecord[];
  us: Pick<UsSyncResult, "etfs" | "asOfUs" | "fx"> | null;
  generatedAt: string;
}): Snapshot {
  const { domestic, us } = args;
  const asOf = domestic.reduce((mx, e) => (e.m.asOf > mx ? e.m.asOf : mx), "");
  const snapshot: Snapshot = {
    version: 1,
    generatedAt: args.generatedAt,
    asOf,
    source: us ? `${DOMESTIC_SOURCE} · ${US_SOURCE}` : DOMESTIC_SOURCE,
    etfs: us ? [...domestic, ...us.etfs] : domestic,
  };
  if (us) {
    snapshot.asOfUs = us.asOfUs;
    snapshot.fxUsdKrw = { rate: us.fx.rate, date: us.fx.date };
  }
  return snapshot;
}

// ───────── 차트용 주간 시계열 ─────────

/**
 * 가장 긴 히스토리를 가진 ETF의 거래일에서 5거래일마다 하나씩 뽑아 공통 격자로 쓴다(마지막 거래일 포함).
 * 격자의 기준은 국내 상장 ETF 가 있으면 국내만 본다 — 국내 차트가 해외 시세의 유무나 길이에 따라 달라지지 않게 하려는 것이다.
 * 거래일이 다른 해외 ETF 는 격자 날짜 이하의 마지막 종가를 이어 써서(휴장일에는 직전 종가) 같은 격자에 올린다.
 */
export function buildSeriesFile(etfs: EtfRecord[], series: Map<string, PriceSeries>): SeriesFile {
  const domestic = etfs.filter((e) => marketOf(e) === "KR" && series.has(e.code));
  let ref: PriceSeries | undefined;
  for (const e of domestic.length > 0 ? domestic : etfs) {
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
