/**
 * 미국 상장 ETF 수집: 나스닥 ETF 목록 → (1차) 거래대금 → (2차) 순자산 → (3차) 약 8년 일별 시세 → 원화 환산 → EtfRecord.
 *
 * 미국에는 ETF가 5천 개 가까이 있고 대부분 작아서, 비싼 호출(펀드 정보·장기 시세)은 싼 호출(1개월 시세)로
 * 거른 뒤의 종목에만 한다. 수익률은 달러 수정종가에 "같은 날" 원/달러 환율을 곱한 원화 시계열로 계산해서
 * 기존 computeMetrics 를 그대로 쓴다(환율 변동이 수익률·변동성·낙폭에 반영된다).
 *
 * 실패 정책: 목록·환율·세션 실패는 즉시 중단한다. 종목별 실패는 failed 에 모으되 한 단계에서 허용 수(failure-policy.ts 의
 * US_STAGE_RULE: 후보의 0.3% 와 2개 중 큰 쪽)를 넘으면 중단한다 — 조용히 줄어든 유니버스로 스냅샷을 만들지 않기 위해서다.
 * 실패한 종목은 스냅샷과 검색 색인에서 모두 빠지므로 기준을 낮게 두고, 중단되면 같은 날 다시 실행해 캐시로 채운다.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { HISTORY_LIMIT_DAYS } from "../core/format";
import { US_MIN_AUM_EOK, US_MIN_AVG_VALUE_WON } from "../core/market";
import { cleanSeries, computeMetrics, indexOnOrBefore, shiftMonths } from "../core/metrics";
import { classifyUs } from "../core/taxonomy-us";
import type { EtfRecord, PriceSeries, UsIndexFile, UsSkipReason } from "../core/types";
import { cachedJson } from "./cache";
import { assertWithinLimit, US_STAGE_RULE } from "./failure-policy";
import { HttpError, withRetry } from "./naver";
import { mapPool } from "./pool";
import { round, roundMetrics } from "./rounding";
import { NotFoundError, YahooClient, ymdFromUnix, type ChartData, type FetchLike, type FundInfo } from "./yahoo";

export const US_CACHE_DIR = ".cache/yahoo";
export const FX_SYMBOL = "KRW=X";
/** 환율 상식 범위(원/달러). 밖의 값은 데이터 오류로 보고 멈춘다 */
export const FX_MIN_WON = 500;
export const FX_MAX_WON = 3000;
/** 환율이 없는 날은 직전 값을 이어 쓰되, 이만큼(달력일) 이상 이월되면 그 날의 행을 버린다 */
export const FX_MAX_CARRY_DAYS = 7;
/** 1차 필터가 보는 거래일 수 */
const LIQUIDITY_DAYS = 20;

const DAY = 86_400;
/** 1차 시세 기간: 20거래일을 확보할 달력일(휴일 포함 여유) */
const QUICK_CALENDAR_DAYS = 40;
/** 최대 2000거래일(미국 연 약 252일 → 약 7.9년)을 받을 달력일. 받은 뒤 마지막 2000행으로 자른다 */
const PRICE_CALENDAR_DAYS = 3000;
const FX_CALENDAR_DAYS = PRICE_CALENDAR_DAYS + 40;

// ───────── 나스닥 ETF 목록 ─────────

export interface NasdaqList {
  /** 나스닥이 알려준 기준 시각 문자열(참고용) */
  dataAsOf: string | null;
  /** 티커·ETN·중복 정리를 통과한 후보 */
  rows: { symbol: string; name: string }[];
  /** 원본 행 수 */
  total: number;
  /** 티커 형식(영문 대문자 1~5자)이 아니어서 뺀 수 */
  badTicker: number;
  /** 이름에 ETN 이 있어 뺀 수 */
  etnExcluded: number;
  /** 뺀 ETN 의 티커·이름(검색 색인용). 이전 캐시에는 없을 수 있다 */
  etnRows?: { symbol: string; name: string }[];
}

export const NASDAQ_LIST_URL = "https://api.nasdaq.com/api/screener/etf?download=true";
/** 실제 목록은 5천 행 안팎이다. 이보다 적으면 응답이 잘렸거나 형식이 바뀐 것이다 */
export const NASDAQ_MIN_ROWS = 1000;
const TICKER = /^[A-Z]{1,5}$/;
const ETN_WORD = /\bETNs?\b/;

/**
 * ETN(상환 보장 증권)은 야후에서도 법적 형태가 "Exchange Traded Fund"로 나오지만 발행사 신용 위험이 있는 채권이라
 * ETF 가 아니다. 이름에 단어 ETN/ETNs 가 있는 것만 뺀다("Floating Rate Note ETF" 처럼 Note 만 있는 것은 ETF).
 */
export const isEtnName = (name: string): boolean => ETN_WORD.test(name);

export function parseNasdaqList(json: unknown, minRows = NASDAQ_MIN_ROWS): NasdaqList {
  const data = (json as { data?: { dataAsOf?: unknown; data?: { rows?: unknown } } } | null)?.data;
  const rows = data?.data?.rows;
  if (!Array.isArray(rows) || rows.length < minRows) {
    throw new Error(`나스닥 ETF 목록 응답 형식이 예상과 다릅니다(행 ${Array.isArray(rows) ? rows.length : "없음"}개 < ${minRows}). 엔드포인트가 바뀌었을 수 있습니다.`);
  }
  const out: NasdaqList = {
    dataAsOf: typeof data?.dataAsOf === "string" ? data.dataAsOf : null,
    rows: [],
    total: rows.length,
    badTicker: 0,
    etnExcluded: 0,
    etnRows: [],
  };
  const seen = new Set<string>();
  let withSymbol = 0;
  for (const r of rows as Record<string, unknown>[]) {
    const symbol = typeof r?.symbol === "string" ? r.symbol.trim() : "";
    if (symbol) withSymbol++;
    if (!TICKER.test(symbol)) {
      out.badTicker++;
      continue;
    }
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const name = typeof r.companyName === "string" ? r.companyName.trim() : "";
    if (isEtnName(name)) {
      out.etnExcluded++;
      out.etnRows?.push({ symbol, name });
      continue;
    }
    out.rows.push({ symbol, name });
  }
  if (withSymbol < rows.length / 2) throw new Error("나스닥 ETF 목록의 symbol 필드를 읽지 못했습니다. 응답 형식이 바뀌었을 수 있습니다.");
  return out;
}

export async function fetchNasdaqList(fetchFn: FetchLike = (u, i) => fetch(u, i), retry: { attempts?: number; baseMs?: number } = {}): Promise<NasdaqList> {
  const json = await withRetry(
    async () => {
      const res = await fetchFn(NASDAQ_LIST_URL, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        await res.body?.cancel().catch(() => {});
        throw new HttpError(res.status, NASDAQ_LIST_URL);
      }
      return (await res.json()) as unknown;
    },
    retry.attempts ?? 4,
    retry.baseMs ?? 800,
  );
  return parseNasdaqList(json);
}

// ───────── 환율 ─────────

export interface FxTable {
  /** YYYYMMDD 오름차순 */
  dates: string[];
  /** 원/달러 */
  rate: number[];
}

/** KRW=X 일별 시세 → 환율표. 상식 범위(500~3000원) 밖 값이 하나라도 있으면 조용히 쓰지 않고 중단한다. */
export function buildFxTable(chart: Pick<ChartData, "dates" | "close">): FxTable {
  if (chart.dates.length === 0) throw new Error(`환율(${FX_SYMBOL}) 시세가 비어 있습니다.`);
  for (let i = 0; i < chart.dates.length; i++) {
    const v = chart.close[i] as number;
    if (!(v >= FX_MIN_WON && v <= FX_MAX_WON)) {
      throw new Error(`환율(${FX_SYMBOL}) ${chart.dates[i]} 값 ${v} 이(가) 상식 범위(${FX_MIN_WON}~${FX_MAX_WON}원)를 벗어났습니다. 원화 환산을 믿을 수 없어 중단합니다.`);
    }
  }
  return { dates: [...chart.dates], rate: [...chart.close] };
}

const utcDay = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 86_400_000;
export const daysBetween = (from: string, to: string): number => Math.round(utcDay(to) - utcDay(from));

/**
 * date 의 환율. 그 날 값이 없으면 직전 값을 이어 쓴다(주말·휴장·null 행). 이월이 FX_MAX_CARRY_DAYS 일 이상이거나
 * 환율표보다 이른 날짜면 null — 낡은 환율로 가격을 만들지 않고 호출자가 그 날의 행을 버리게 한다.
 */
export function fxRateOn(fx: FxTable, date: string): number | null {
  const i = indexOnOrBefore(fx.dates, date);
  if (i < 0) return null;
  return daysBetween(fx.dates[i] as string, date) >= FX_MAX_CARRY_DAYS ? null : (fx.rate[i] as number);
}

export function fxLatest(fx: FxTable): { rate: number; date: string } {
  const i = fx.dates.length - 1;
  return { rate: fx.rate[i] as number, date: fx.dates[i] as string };
}

/**
 * 환율표의 최신일이 현재보다 FX_MAX_CARRY_DAYS 일 이상 뒤처졌으면 중단한다. 이월 규칙이 최근 시세 행을 하나씩 버려
 * 기준일이 조용히 뒤로 밀리거나, 순자산이 낡은 환율로 환산되는 것을 막는다.
 */
export function assertFxFresh(latestFxDate: string, nowUnix: number): void {
  const age = daysBetween(latestFxDate, ymdFromUnix(nowUnix, 0));
  if (age >= FX_MAX_CARRY_DAYS) {
    throw new Error(`환율(${FX_SYMBOL})의 최신일 ${latestFxDate} 이(가) 현재보다 ${age}일 앞서 있어 쓸 수 없습니다(허용 ${FX_MAX_CARRY_DAYS - 1}일 이내).`);
  }
}

/** 달러 수정종가 × 같은 날짜 환율 = 원화 수정종가. 거래량은 주식 수라 그대로. 환율을 구할 수 없는 날은 뺀다. */
export function toKrwSeries(usd: Pick<ChartData, "dates" | "adjClose" | "volume">, fx: FxTable): PriceSeries {
  const out: PriceSeries = { dates: [], close: [], volume: [] };
  for (let i = 0; i < usd.dates.length; i++) {
    const date = usd.dates[i] as string;
    const rate = fxRateOn(fx, date);
    if (rate === null) continue;
    out.dates.push(date);
    out.close.push((usd.adjClose[i] as number) * rate);
    out.volume.push(usd.volume[i] as number);
  }
  return out;
}

// ───────── 선별 기준 ─────────

/**
 * 최근 20거래일 평균 거래대금(원) = 원시 종가(달러) × 거래량 × 그날 환율의 평균. 20거래일이 안 되면 null(유동성을 증명할 수 없다).
 * 환율을 구할 수 없는 날은 빼고 센다.
 */
export function avgTradedValueWon(chart: Pick<ChartData, "dates" | "close" | "volume">, fx: FxTable): number | null {
  const vals: number[] = [];
  for (let i = chart.dates.length - 1; i >= 0 && vals.length < LIQUIDITY_DAYS; i--) {
    const rate = fxRateOn(fx, chart.dates[i] as string);
    if (rate === null) continue;
    vals.push((chart.close[i] as number) * (chart.volume[i] as number) * rate);
  }
  return vals.length < LIQUIDITY_DAYS ? null : vals.reduce((a, b) => a + b, 0) / LIQUIDITY_DAYS;
}

export const passesLiquidity = (avgValueWon: number | null): boolean => avgValueWon !== null && avgValueWon >= US_MIN_AVG_VALUE_WON;

/** 달러 순자산 × 환율 → 억원 */
/**
 * 야후의 순자산(totalAssets)이 ETF 클래스만이 아니라 펀드 전체 합계인 운용사. 뱅가드 ETF 는 같은 펀드의 뮤추얼펀드 클래스와
 * 한 몸이라 VTI·VOO 등의 값이 실제 ETF 규모의 몇 배로 나온다(야후는 ETF 클래스만의 값을 주지 않아 보정할 수 없고 표시로 알린다).
 */
export const hasFundLevelAum = (family: string | null): boolean => family !== null && /^vanguard\b/i.test(family);

export const aumEokFromUsd = (totalAssetsUsd: number, rate: number): number => (totalAssetsUsd * rate) / 1e8;

export const passesAum = (aumEok: number | null): boolean => aumEok !== null && aumEok >= US_MIN_AUM_EOK;

// ───────── EtfRecord 생성 ─────────

/** 야후 거래소 이름 → 화면 표기. 모르는 이름은 원문 그대로 둔다. */
export function exchangeLabel(raw: string | null): string | null {
  if (raw === null) return null;
  switch (raw) {
    case "NYSEArca":
      return "NYSE Arca";
    case "NasdaqGM":
    case "NasdaqGS":
    case "NasdaqCM":
      return "Nasdaq";
    case "Cboe US":
      return "Cboe BZX";
    case "NYSE":
      return "NYSE";
    case "NYSE American":
      return "NYSE American";
    default:
      return raw;
  }
}

/** 최근 12개월 분배금 합 ÷ 최근 종가 × 100(%). 시세가 1년에 못 미치면 null, 1년 이상인데 분배가 없으면 0. */
export function trailingDivYield(chart: Pick<ChartData, "dates" | "dividends">, lastClose: number, lastDate: string): number | null {
  const start = shiftMonths(lastDate, -12);
  if (chart.dates.length === 0 || (chart.dates[0] as string) > start) return null;
  let sum = 0;
  for (const d of chart.dividends) if (d.date > start && d.date <= lastDate) sum += d.amount;
  return round((sum / lastClose) * 100, 2);
}

/** 마지막 2000행만 남긴다(국내와 같은 최대 거래일). 분배금은 그대로 둔다 */
export function trimChart(chart: ChartData, maxRows = HISTORY_LIMIT_DAYS): ChartData {
  const n = chart.dates.length;
  if (n <= maxRows) return chart;
  const s = n - maxRows;
  return { ...chart, dates: chart.dates.slice(s), close: chart.close.slice(s), adjClose: chart.adjClose.slice(s), volume: chart.volume.slice(s) };
}

export interface UsRecordInput {
  symbol: string;
  /** 나스닥 목록의 이름(야후 longName 이 없을 때만 쓴다) */
  listName: string;
  info: FundInfo;
  /** 달러 일별 시세(약 8년) */
  chart: ChartData;
  fx: FxTable;
}

/**
 * 한 종목의 EtfRecord 와 원화 시계열. 지표를 낼 수 없으면(시세 2행 미만) null.
 * price 는 마지막 거래일의 원시 종가(USD) × 그날 환율, aumEok 는 달러 순자산 × 최신 환율이다.
 */
export function buildUsRecord(input: UsRecordInput): { etf: EtfRecord; series: PriceSeries } | null {
  const { symbol, info, chart, fx } = input;
  const krw = cleanSeries(toKrwSeries(chart, fx));
  const m = computeMetrics(krw);
  if (!m) return null;
  // 환율을 구한 마지막 행 = 원화 시계열의 마지막 날짜
  const last = chart.dates.lastIndexOf(m.asOf);
  const rate = fxRateOn(fx, m.asOf);
  if (last < 1 || rate === null) return null;
  const lastClose = chart.close[last] as number;
  const prevClose = chart.close[last - 1] as number;
  const name = info.longName ?? input.listName;
  const latest = fxLatest(fx);
  const etf: EtfRecord = {
    code: symbol,
    name,
    market: "US",
    exchange: exchangeLabel(info.exchangeName),
    priceNative: round(lastClose, 4),
    category: info.category,
    issuer: info.family,
    price: Math.round(lastClose * rate),
    changeRate: round((lastClose / prevClose - 1) * 100, 2),
    aumEok: info.totalAssets === null ? 0 : Math.round(aumEokFromUsd(info.totalAssets, latest.rate)),
    ...(hasFundLevelAum(info.family) ? { aumScope: "fund" as const } : {}),
    // 야후는 소수(0.000945)로 주지만 앱의 fee 는 % 단위다
    fee: info.expenseRatio === null ? null : round(info.expenseRatio * 100, 4),
    divYield: trailingDivYield(chart, lastClose, m.asOf),
    navGap: null,
    description: "",
    tax: classifyUs({ symbol, name, category: info.category, family: info.family, legalType: info.legalType }),
    m: roundMetrics(m),
  };
  return { etf, series: krw };
}

// ───────── 오케스트레이터 ─────────

/** 네트워크 계층. 테스트는 이것만 바꿔 끼우면 네트워크 없이 전체 흐름을 돌릴 수 있다. */
export interface UsDeps {
  fetchNasdaqList(): Promise<NasdaqList>;
  fetchChart(symbol: string, fromUnix: number, toUnix: number, opts?: { requireAdjClose?: boolean; tzIndependentDate?: boolean }): Promise<ChartData>;
  fetchFundInfo(symbol: string): Promise<FundInfo>;
  /** 펀드 정보용 쿠키+crumb 세션을 미리 만든다. 실패하면 던진다(없으면 건너뜀) */
  openSession?(): Promise<void>;
}

export function createUsDeps(fetchFn?: FetchLike): UsDeps {
  const client = new YahooClient({ fetch: fetchFn });
  return {
    fetchNasdaqList: () => fetchNasdaqList(fetchFn),
    fetchChart: (s, a, b, o) => client.fetchChart(s, a, b, o),
    fetchFundInfo: (s) => client.fetchFundInfo(s),
    openSession: () => client.openSession(),
  };
}

export interface SyncUsOptions {
  /** 오늘 받은 캐시가 있어도 다시 받는다 */
  force?: boolean;
  /** 개발용: 1차(거래대금) 통과 종목 중 거래대금 상위 N개만 다음 단계로 */
  limit?: number;
  concurrency?: number;
  /** 캐시 폴더(기본 .cache/yahoo) */
  cacheDir?: string;
  /** 현재 시각(ms). 시세 요청 기간과 환율 신선도 검사의 기준이다. 테스트에서 고정할 때 쓴다 */
  nowMs?: number;
  log?: (msg: string) => void;
}

export interface UsStats {
  /** 나스닥 목록 원본 행 수 */
  listRows: number;
  badTicker: number;
  etnExcluded: number;
  /** 1차 입력(티커·ETN·중복 정리 후) */
  candidates: number;
  quick: { notFound: number; tooShort: number; lowValue: number; passed: number; limitedTo: number | null };
  info: { notFound: number; etn: number; noAum: number; lowAum: number; passed: number };
  final: number;
}

export interface UsSyncResult {
  /** 순자산(원화) 내림차순 */
  etfs: EtfRecord[];
  /** 원화 환산 수정종가 시계열(cleanSeries 적용) */
  series: Map<string, PriceSeries>;
  /** 해외 ETF 시세의 최신일 */
  asOfUs: string;
  /** 원화 환산에 쓴 최신 환율과 그 날짜 */
  fx: { rate: number; date: string };
  /** 종목별 실패 사유("티커 (단계: 사유)") */
  failed: string[];
  /** failed 중 호출 제한(429)·네트워크 같은 일시 오류로 못 받은 종목의 티커 — 같은 날 다시 실행하면 캐시로 채울 수 있다(USD 가 아닌 종목·시세 부족은 제외) */
  retryable: string[];
  stats: UsStats;
  /** 수집 기준을 못 넘어 데이터에 들지 못한 종목(검색 색인용). 실패한 종목은 failed 에 있고 여기에는 없다 */
  notCollected: { symbol: string; name: string; reason: UsSkipReason }[];
}

/**
 * 수집하지 않은 종목의 이름 색인(public/data/us-index.json). 점수·지표 없이 "검색은 되지만 데이터에는 없음"을 알리는 용도라
 * 새로 상장한 소형 ETF도 검색에 나타난다. 티커 순, 같은 티커는 한 번만.
 */
export function buildUsIndex(notCollected: UsSyncResult["notCollected"], asOf: string): UsIndexFile {
  const seen = new Set<string>();
  const etfs: UsIndexFile["etfs"] = [];
  for (const r of [...notCollected].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0))) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol);
    etfs.push([r.symbol, r.name, r.reason]);
  }
  return { version: 1, asOf, etfs };
}

/** 한 단계의 종목별 실패가 허용 수(후보의 0.3% 와 2개 중 큰 쪽)를 넘으면 중단 */
export function assertFailureRate(stage: string, failures: number, total: number): void {
  assertWithinLimit(`미국 ETF ${stage} 단계`, failures, total, US_STAGE_RULE);
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function syncUs(opts: SyncUsOptions = {}, deps: UsDeps = createUsDeps()): Promise<UsSyncResult> {
  const log = opts.log ?? (() => {});
  const force = opts.force ?? false;
  const concurrency = opts.concurrency ?? 6;
  const dir = opts.cacheDir ?? US_CACHE_DIR;
  for (const sub of ["quick", "info", "price"]) await mkdir(join(dir, sub), { recursive: true });
  const nowUnix = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const failed: string[] = [];
  const retryable: string[] = [];
  const notCollected: UsSyncResult["notCollected"] = [];

  const progress = (label: string) => {
    let last = 0;
    return (done: number, total: number) => {
      if (done === total || done - last >= 200) {
        last = done;
        log(`  ${label} ${done}/${total}`);
      }
    };
  };
  /** 목록·환율·세션처럼 실패하면 전체를 멈춰야 하는 단계 */
  const must = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      throw new Error(`미국 ETF 수집 중단: ${label} 실패 — ${msg(e)}`, { cause: e });
    }
  };

  log("미국 상장 ETF 목록 수집 중(나스닥)…");
  const list = await must("나스닥 ETF 목록", () => cachedJson(join(dir, "list.json"), force, () => deps.fetchNasdaqList()));
  log(`  목록 ${list.total}행 → 후보 ${list.rows.length}개 (티커 형식 불량 ${list.badTicker}, ETN ${list.etnExcluded} 제외)`);
  for (const r of list.etnRows ?? []) notCollected.push({ symbol: r.symbol, name: r.name, reason: "etn" });

  log("환율(원/달러) 수집 중…");
  const fx = await must("환율", async () => {
    // 범위 검사를 통과한 응답만 캐시에 남긴다(이상한 값이 캐시되면 같은 날 다시 실행해도 같은 오류가 반복된다)
    const chart = await cachedJson(join(dir, "fx.json"), force, async () => {
      const c = await deps.fetchChart(FX_SYMBOL, nowUnix - FX_CALENDAR_DAYS * DAY, nowUnix, { requireAdjClose: false, tzIndependentDate: true });
      buildFxTable(c);
      return c;
    });
    return buildFxTable(chart);
  });
  const fxNow = fxLatest(fx);
  log(`  ${fx.dates.length}일, 최신 ${fxNow.date} ${fxNow.rate}원`);
  await must("환율 신선도", async () => assertFxFresh(fxNow.date, nowUnix));

  await must("야후 세션(쿠키·crumb)", async () => deps.openSession?.());

  const stats: UsStats = {
    listRows: list.total,
    badTicker: list.badTicker,
    etnExcluded: list.etnExcluded,
    candidates: list.rows.length,
    quick: { notFound: 0, tooShort: 0, lowValue: 0, passed: 0, limitedTo: null },
    info: { notFound: 0, etn: 0, noAum: 0, lowAum: 0, passed: 0 },
    final: 0,
  };

  // 야후에 없는 종목(404)은 실패가 아니라 "정보 없음"이다. null 로 캐시해 같은 날 다시 묻지 않는다.
  const orNotFound = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      throw e;
    }
  };
  const notUsd = (c: ChartData) => c.currency !== null && c.currency !== "USD";

  // ── 1차: 1개월 시세로 20일 평균 거래대금(원화) ──
  log(`1차 필터: 1개월 시세로 거래대금 확인(≥ ${(US_MIN_AVG_VALUE_WON / 1e8).toFixed(0)}억원/일)…`);
  const quickRun = await mapPool(
    list.rows,
    concurrency,
    (r) => cachedJson<ChartData | null>(join(dir, "quick", `${r.symbol}.json`), force, () => orNotFound(() => deps.fetchChart(r.symbol, nowUnix - QUICK_CALENDAR_DAYS * DAY, nowUnix))),
    progress("1차"),
  );
  const quickPassed: { symbol: string; name: string; avgValue: number }[] = [];
  let quickFailures = 0;
  list.rows.forEach((r, i) => {
    if (quickRun.errors.has(i)) {
      quickFailures++;
      retryable.push(r.symbol);
      failed.push(`${r.symbol} (1차 시세: ${msg(quickRun.errors.get(i))})`);
      return;
    }
    const chart = quickRun.results[i];
    if (!chart) {
      stats.quick.notFound++;
      notCollected.push({ symbol: r.symbol, name: r.name, reason: "no-data" });
      return;
    }
    if (notUsd(chart)) {
      quickFailures++;
      failed.push(`${r.symbol} (1차 시세: 통화가 USD 가 아님 ${chart.currency})`);
      return;
    }
    const avg = avgTradedValueWon(chart, fx);
    if (avg === null) {
      stats.quick.tooShort++;
      notCollected.push({ symbol: r.symbol, name: r.name, reason: "short" });
    } else if (!passesLiquidity(avg)) {
      stats.quick.lowValue++;
      notCollected.push({ symbol: r.symbol, name: r.name, reason: "low-trading" });
    } else {
      quickPassed.push({ symbol: r.symbol, name: r.name, avgValue: avg });
    }
  });
  assertFailureRate("1차(시세)", quickFailures, list.rows.length);
  stats.quick.passed = quickPassed.length;
  log(`  통과 ${quickPassed.length}개 (야후에 없음 ${stats.quick.notFound}, 20거래일 미만 ${stats.quick.tooShort}, 거래대금 미달 ${stats.quick.lowValue}, 실패 ${quickFailures})`);
  quickPassed.sort((a, b) => b.avgValue - a.avgValue || (a.symbol < b.symbol ? -1 : 1));
  if (opts.limit && quickPassed.length > opts.limit) {
    quickPassed.length = opts.limit;
    stats.quick.limitedTo = opts.limit;
    log(`  개발용 제한: 거래대금 상위 ${opts.limit}개만 진행`);
  }

  // ── 2차: 펀드 정보로 순자산(억원) ──
  log(`2차 필터: 펀드 정보로 순자산 확인(≥ ${US_MIN_AUM_EOK}억원)…`);
  const infoRun = await mapPool(
    quickPassed,
    concurrency,
    (r) => cachedJson<FundInfo | null>(join(dir, "info", `${r.symbol}.json`), force, () => orNotFound(() => deps.fetchFundInfo(r.symbol))),
    progress("펀드 정보"),
  );
  const infoPassed: { symbol: string; name: string; info: FundInfo }[] = [];
  let infoFailures = 0;
  quickPassed.forEach((r, i) => {
    if (infoRun.errors.has(i)) {
      infoFailures++;
      retryable.push(r.symbol);
      failed.push(`${r.symbol} (펀드 정보: ${msg(infoRun.errors.get(i))})`);
      return;
    }
    const info = infoRun.results[i];
    if (!info) {
      stats.info.notFound++;
      notCollected.push({ symbol: r.symbol, name: r.name, reason: "no-data" });
    } else if (info.longName !== null && isEtnName(info.longName)) {
      stats.info.etn++;
      notCollected.push({ symbol: r.symbol, name: r.name, reason: "etn" });
    } else if (info.totalAssets === null) {
      stats.info.noAum++; // 신탁 등 순자산을 모르면 제외
      notCollected.push({ symbol: r.symbol, name: r.name, reason: "no-aum" });
    } else if (!passesAum(aumEokFromUsd(info.totalAssets, fxNow.rate))) {
      stats.info.lowAum++;
      notCollected.push({ symbol: r.symbol, name: r.name, reason: "small-aum" });
    } else {
      infoPassed.push({ symbol: r.symbol, name: r.name, info });
    }
  });
  assertFailureRate("2차(펀드 정보)", infoFailures, quickPassed.length);
  stats.info.passed = infoPassed.length;
  log(`  통과 ${infoPassed.length}개 (정보 없음 ${stats.info.notFound}, ETN ${stats.info.etn}, 순자산 미상 ${stats.info.noAum}, 순자산 미달 ${stats.info.lowAum}, 실패 ${infoFailures})`);

  // ── 3차: 통과 종목의 약 8년 일별 시세 ──
  log("약 8년 일별 시세 수집 중…");
  const priceRun = await mapPool(
    infoPassed,
    concurrency,
    (r) =>
      cachedJson<ChartData>(join(dir, "price", `${r.symbol}.json`), force, async () =>
        trimChart(await deps.fetchChart(r.symbol, nowUnix - PRICE_CALENDAR_DAYS * DAY, nowUnix)),
      ),
    progress("시세"),
  );
  const etfs: EtfRecord[] = [];
  const series = new Map<string, PriceSeries>();
  let priceFailures = 0;
  infoPassed.forEach((r, i) => {
    const fail = (why: string) => {
      priceFailures++;
      failed.push(`${r.symbol} (시세: ${why})`);
    };
    if (priceRun.errors.has(i)) {
      retryable.push(r.symbol);
      return fail(msg(priceRun.errors.get(i)));
    }
    const chart = priceRun.results[i];
    if (!chart) return fail("응답 없음");
    if (notUsd(chart)) return fail(`통화가 USD 가 아님 ${chart.currency}`);
    const built = buildUsRecord({ symbol: r.symbol, listName: r.name, info: r.info, chart, fx });
    if (!built) return fail("시세 부족");
    etfs.push(built.etf);
    series.set(r.symbol, built.series);
  });
  assertFailureRate("3차(일별 시세)", priceFailures, infoPassed.length);
  if (etfs.length === 0) throw new Error("미국 ETF 선별 결과가 0개입니다. 수집 기준이나 데이터 소스를 확인하세요.");

  etfs.sort((a, b) => b.aumEok - a.aumEok || (a.code < b.code ? -1 : 1));
  stats.final = etfs.length;
  const asOfUs = etfs.reduce((mx, e) => (e.m.asOf > mx ? e.m.asOf : mx), "");
  log(`미국 ETF ${etfs.length}개, 시세 기준일 ${asOfUs}${failed.length ? `, 실패 ${failed.length}건` : ""}`);
  return { etfs, series, asOfUs, fx: fxNow, failed, retryable, stats, notCollected };
}
