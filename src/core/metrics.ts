import type { Metrics, PriceSeries, Returns } from "./types";

/** 무위험 수익률(연). 샤프지수 계산용 단순 상수. 국내 CD금리/단기금리 수준의 근사치. */
export const RISK_FREE = 0.03;
/** 샤프지수 분모(변동성) 하한. 머니마켓처럼 변동성이 0에 가까운 상품에서 샤프가 폭주하는 것을 막는다. */
const VOL_FLOOR = 0.01;

/**
 * 수익률 구간은 거래일 수가 아니라 달력(개월) 기준이다.
 * 한국은 공휴일이 많아 "3개월 = 63거래일"로 잡으면 실제 3개월(약 60거래일)과 어긋나고,
 * 포털/증권사가 보여주는 1·3·6개월 수익률과 숫자가 달라 신뢰를 잃는다.
 */
export const MONTHS = { m1: 1, m3: 3, m6: 6, y1: 12, y3: 36, y5: 60 } as const;

/** 종가 0 이하·비정상 행과 중복 날짜를 제거한다. 입력은 날짜 오름차순이라고 가정한다. */
export function cleanSeries(s: PriceSeries): PriceSeries {
  const dates: string[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  for (let i = 0; i < s.dates.length; i++) {
    const c = s.close[i];
    const d = s.dates[i];
    if (d === undefined || c === undefined || !Number.isFinite(c) || c <= 0) continue;
    if (dates.length > 0 && dates[dates.length - 1] === d) continue;
    dates.push(d);
    close.push(c);
    volume.push(Math.max(0, s.volume[i] ?? 0));
  }
  return { dates, close, volume };
}

// ───────── 날짜 유틸 (YYYYMMDD 문자열) ─────────

/** ymd 에서 months 개월을 더한(음수면 뺀) 날짜. 말일은 해당 월 말일로 보정한다(예: 3/31 − 1개월 = 2/28). */
export function shiftMonths(ymd: string, months: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  const total = y * 12 + m + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const lastDay = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${String(ny).padStart(4, "0")}${String(nm + 1).padStart(2, "0")}${String(nd).padStart(2, "0")}`;
}

/** dates(오름차순)에서 target 이하인 마지막 인덱스. 모두 target 보다 크면 -1. */
export function indexOnOrBefore(dates: string[], target: string): number {
  let lo = 0;
  let hi = dates.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((dates[mid] as string) <= target) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * 기준 인덱스 end 에서 months 개월 전 시점의 인덱스. 상장 이후 기간이 모자라면 null.
 * "모자람" 판정: 첫 거래일이 목표일보다 늦으면 그 기간은 아직 존재하지 않은 것으로 본다.
 */
function startIndex(dates: string[], end: number, months: number): number | null {
  const target = shiftMonths(dates[end] as string, -months);
  if ((dates[0] as string) > target) return null;
  const i = indexOnOrBefore(dates, target);
  return i >= 0 && i < end ? i : null;
}

const at = (a: number[], i: number): number => a[i] as number;

function periodReturn(close: number[], dates: string[], end: number, months: number): number | null {
  const s = startIndex(dates, end, months);
  return s === null ? null : at(close, end) / at(close, s) - 1;
}

function annualize(cumulative: number | null, months: number): number | null {
  return cumulative === null ? null : Math.pow(1 + cumulative, 12 / months) - 1;
}

/** [start, end] 구간의 일간 로그수익률 표준편차를 연환산. 연간 관측 수는 구간의 실제 관측 밀도로 추정한다. */
function volatility(close: number[], dates: string[], end: number, months: number): number | null {
  const start = startIndex(dates, end, months);
  if (start === null) return null;
  const n = end - start;
  if (n < 20) return null;
  let sum = 0;
  let sumSq = 0;
  for (let i = start + 1; i <= end; i++) {
    const r = Math.log(at(close, i) / at(close, i - 1));
    sum += r;
    sumSq += r * r;
  }
  const mean = sum / n;
  const variance = Math.max(0, (sumSq - n * mean * mean) / (n - 1));
  const perYear = n / (months / 12);
  return Math.sqrt(variance) * Math.sqrt(perYear);
}

/** [start, end] 구간 내 최대 낙폭(음수 또는 0). months=null 이면 전체 구간. */
function maxDrawdown(close: number[], dates: string[], end: number, months: number | null): number | null {
  let start = 0;
  if (months !== null) {
    const s = startIndex(dates, end, months);
    if (s === null) return null;
    start = s;
  }
  let peak = at(close, start);
  let worst = 0;
  for (let i = start; i <= end; i++) {
    const c = at(close, i);
    if (c > peak) peak = c;
    const dd = c / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function sharpe(cagr: number | null, vol: number | null): number | null {
  if (cagr === null || vol === null) return null;
  return (cagr - RISK_FREE) / Math.max(vol, VOL_FLOOR);
}

/**
 * 시세에서 위험·수익 지표를 계산한다.
 * @param asOfIndex 기준일 인덱스. 기본은 마지막 거래일. 백테스트에서 과거 시점 기준 지표를 만들 때 쓴다.
 *                  기준일 이후 데이터는 절대 참조하지 않는다(미래 정보 누출 방지).
 */
export function computeMetrics(series: PriceSeries, asOfIndex: number = series.close.length - 1): Metrics | null {
  const { close, volume, dates } = series;
  const end = asOfIndex;
  // 신규 상장 ETF도 "데이터 부족"으로 보여줄 수 있도록 가격이 2개만 있어도 계산한다. 기간이 모자란 항목은 null.
  if (end < 1 || end >= close.length) return null;

  const ret: Returns = {
    m1: periodReturn(close, dates, end, MONTHS.m1),
    m3: periodReturn(close, dates, end, MONTHS.m3),
    m6: periodReturn(close, dates, end, MONTHS.m6),
    y1: periodReturn(close, dates, end, MONTHS.y1),
    y3: periodReturn(close, dates, end, MONTHS.y3),
    y5: periodReturn(close, dates, end, MONTHS.y5),
  };
  const cagr1y = annualize(ret.y1, MONTHS.y1);
  const cagr3y = annualize(ret.y3, MONTHS.y3);
  const cagr5y = annualize(ret.y5, MONTHS.y5);
  const vol1y = volatility(close, dates, end, MONTHS.y1);
  const vol3y = volatility(close, dates, end, MONTHS.y3);

  // 직전 52주(상장 3개월 미만이면 null) 고점 대비 현재 낙폭
  const lookStart = startIndex(dates, end, 12) ?? 0;
  let drawdown: number | null = null;
  if (end - lookStart >= 60) {
    let hi = 0;
    for (let i = lookStart; i <= end; i++) hi = Math.max(hi, at(close, i));
    drawdown = at(close, end) / hi - 1;
  }

  // 12-1 모멘텀: 12개월 전 → 1개월 전 수익률
  let mom12_1: number | null = null;
  const s12 = startIndex(dates, end, 12);
  const s1 = startIndex(dates, end, 1);
  if (s12 !== null && s1 !== null && s1 > s12) mom12_1 = at(close, s1) / at(close, s12) - 1;

  let trend200: number | null = null;
  if (end >= 199) {
    let s = 0;
    for (let i = end - 199; i <= end; i++) s += at(close, i);
    trend200 = at(close, end) / (s / 200) - 1;
  }

  let avgValue20: number | null = null;
  if (end >= 19) {
    let s = 0;
    for (let i = end - 19; i <= end; i++) s += at(close, i) * (volume[i] ?? 0);
    avgValue20 = s / 20;
  }

  const firstDate = dates[0] as string;
  const lastDate = dates[end] as string;
  const years = (Date.UTC(+lastDate.slice(0, 4), +lastDate.slice(4, 6) - 1, +lastDate.slice(6, 8)) -
    Date.UTC(+firstDate.slice(0, 4), +firstDate.slice(4, 6) - 1, +firstDate.slice(6, 8))) / (365.25 * 86_400_000);

  return {
    asOf: lastDate,
    days: end + 1,
    firstDate,
    years,
    ret,
    cagr1y,
    cagr3y,
    cagr5y,
    vol1y,
    vol3y,
    mdd1y: maxDrawdown(close, dates, end, MONTHS.y1),
    mdd3y: maxDrawdown(close, dates, end, MONTHS.y3),
    mddAll: maxDrawdown(close, dates, end, null),
    drawdown,
    sharpe1y: sharpe(cagr1y, vol1y),
    sharpe3y: sharpe(cagr3y, vol3y),
    mom12_1,
    trend200,
    avgValue20,
  };
}

/** 기준 인덱스에서 months 개월 뒤(달력) 수익률. 백테스트의 "실현 수익". 아직 그 날짜가 오지 않았으면 null. */
export function forwardReturnMonths(series: PriceSeries, index: number, months: number): number | null {
  const { dates, close } = series;
  const target = shiftMonths(dates[index] as string, months);
  if ((dates[dates.length - 1] as string) < target) return null;
  const j = indexOnOrBefore(dates, target);
  if (j <= index) return null;
  return at(close, j) / at(close, index) - 1;
}

/** 기준 인덱스부터 months 개월 보유했을 때 보유기간 중 최대 낙폭(음수 또는 0). 데이터가 모자라면 null. */
export function forwardMaxDrawdown(series: PriceSeries, index: number, months: number): number | null {
  const { dates, close } = series;
  const target = shiftMonths(dates[index] as string, months);
  if ((dates[dates.length - 1] as string) < target) return null;
  const j = indexOnOrBefore(dates, target);
  if (j <= index) return null;
  let peak = at(close, index);
  let worst = 0;
  for (let i = index; i <= j; i++) {
    const c = at(close, i);
    if (c > peak) peak = c;
    worst = Math.min(worst, c / peak - 1);
  }
  return worst;
}
