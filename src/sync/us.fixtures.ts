/**
 * 미국 수집 테스트가 함께 쓰는 fixture: 네트워크 없이 야후·나스닥 응답을 흉내 내는 생성기들.
 * (테스트 파일끼리 import 하면 다른 파일의 describe 가 다시 실행되므로 별도 모듈로 둔다)
 */
import { HttpError } from "./naver";
import type { NasdaqList, UsDeps } from "./us";
import { NotFoundError, type ChartData, type FundInfo } from "./yahoo";

export const NOW = Date.UTC(2026, 9, 10, 3, 0); // 2026-10-10(토) 03:00Z — 미국 마지막 거래일은 10/9(금)
export const DAY = 86_400;

export const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

/** [fromUnix, toUnix] 안의 평일(UTC 기준) 날짜 */
export function weekdays(fromUnix: number, toUnix: number): string[] {
  const out: string[] = [];
  for (let d = Math.floor(fromUnix / DAY); d <= Math.floor(toUnix / DAY); d++) {
    const dow = new Date(d * DAY * 1000).getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(ymd(d * DAY * 1000));
  }
  return out;
}

/** start(YYYYMMDD) 부터 n 개의 달력일 */
export function calDays(start: string, n: number): string[] {
  const t0 = Date.UTC(+start.slice(0, 4), +start.slice(4, 6) - 1, +start.slice(6, 8));
  return Array.from({ length: n }, (_, i) => ymd(t0 + i * DAY * 1000));
}

export interface Shape {
  /** i 번째 거래일의 종가(USD) */
  px?: (i: number) => number;
  vol?: number;
  currency?: string;
  /** 상장 후 며칠만 시세가 있는지(없으면 요청 기간 전체) */
  lastNDays?: number;
  dividends?: ChartData["dividends"];
}

export function usChart(symbol: string, from: number, to: number, s: Shape = {}): ChartData {
  let dates = weekdays(from, to);
  if (s.lastNDays !== undefined) dates = dates.filter((d) => d >= ymd(to * 1000 - s.lastNDays! * DAY * 1000));
  const px = s.px ?? ((i: number) => 100 * 1.0003 ** i);
  const close = dates.map((_, i) => px(i));
  return {
    symbol,
    currency: s.currency ?? "USD",
    exchangeName: "NYSEArca",
    gmtoffset: -14_400,
    dates,
    close,
    adjClose: close,
    volume: dates.map(() => s.vol ?? 1_000_000),
    dividends: s.dividends ?? [],
  };
}

export const fxChart = (from: number, to: number, rate: number | ((d: string) => number) = 1300): ChartData => {
  const dates = weekdays(from, to);
  dates.push(ymd(to * 1000)); // 야후는 마지막 점으로 오늘(토요일) 값을 한 번 더 준다
  const close = dates.map((d) => (typeof rate === "number" ? rate : rate(d)));
  return { symbol: "KRW=X", currency: "KRW", exchangeName: "CCY", gmtoffset: 3600, dates, close, adjClose: close, volume: dates.map(() => 0), dividends: [] };
};

export const info = (o: Partial<FundInfo> = {}): FundInfo => ({
  symbol: "X",
  quoteType: "ETF",
  longName: "Test ETF",
  exchangeName: "NYSEArca",
  currency: "USD",
  totalAssets: 10e9,
  expenseRatio: 0.0009,
  category: "Large Blend",
  family: "Test Family",
  legalType: "Exchange Traded Fund",
  ...o,
});

export const list = (symbols: string[]): NasdaqList => ({
  dataAsOf: "10/9/2026",
  rows: symbols.map((symbol) => ({ symbol, name: `${symbol} Fund` })),
  total: symbols.length,
  badTicker: 0,
  etnExcluded: 0,
});


export interface Spec {
  shape?: Shape;
  /** 1개월·장기 시세 모두 404 */
  chartNotFound?: boolean;
  info?: Partial<FundInfo> | "notfound" | "error";
  chartError?: "quick" | "price";
}

/** 종목별 사양으로 네트워크 계층을 흉내 낸다. 호출을 센다. */
export function makeDeps(symbols: string[], specs: Record<string, Spec>, over: Partial<UsDeps> = {}) {
  const n = { list: 0, chart: [] as string[], info: [] as string[], session: 0 };
  const deps: UsDeps = {
    async fetchNasdaqList() {
      n.list++;
      return list(symbols);
    },
    async fetchChart(symbol, from, to) {
      n.chart.push(symbol);
      if (symbol === "KRW=X") return fxChart(from, to);
      const s = specs[symbol] ?? {};
      if (s.chartNotFound) throw new NotFoundError(symbol);
      if (s.chartError === "quick" && to - from < 100 * DAY) throw new HttpError(500, `chart/${symbol}`);
      if (s.chartError === "price" && to - from > 100 * DAY) throw new HttpError(500, `chart/${symbol}`);
      return usChart(symbol, from, to, s.shape);
    },
    async fetchFundInfo(symbol) {
      n.info.push(symbol);
      const s = specs[symbol]?.info;
      if (s === "notfound") throw new NotFoundError(symbol);
      if (s === "error") throw new HttpError(500, `info/${symbol}`);
      return info({ symbol, longName: `${symbol} Fund`, ...(s ?? {}) });
    },
    async openSession() {
      n.session++;
    },
    ...over,
  };
  return { deps, n };
}

