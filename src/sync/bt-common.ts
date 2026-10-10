/** 백테스트 공통 코드: 과거 시점의 유니버스 구성, 월말 생성, 통계 유틸. */
import { readFile } from "node:fs/promises";
import { cleanSeries, computeMetrics, endedEarly, indexOnOrBefore, shiftMonths } from "../core/metrics";
import type { EtfRecord, PriceSeries, Snapshot } from "../core/types";
import { loadCachedPrices } from "./build-snapshot";
import { loadCachedDelisted, type DelistedSkip } from "./delisted";

export interface Loaded {
  rec: EtfRecord; // 정적 정보(이름·분류)만 사용
  series: PriceSeries;
  /** 시세가 데이터 기준일보다 일찍 끝난 ETF(상장폐지·청산). 보유 도중 끝나면 마지막 가격에 청산된 것으로 계산한다. */
  ended: boolean;
}

export interface AsOfEtf {
  /** 기준일 시점의 레코드. 과거의 총보수·순자산은 알 수 없어 중립값으로 채운다(누출 방지). */
  e: EtfRecord;
  series: PriceSeries;
  /** 기준일에 해당하는 시계열 인덱스 */
  idx: number;
  ended: boolean;
}

export async function loadUniverse(): Promise<{ loaded: Loaded[]; asOf: string; delistedIncluded: number; delistedSkipped: DelistedSkip[] }> {
  const snap = JSON.parse(await readFile("public/data/snapshot.json", "utf8")) as Snapshot;
  const loaded: Loaded[] = [];
  for (const rec of snap.etfs) {
    const raw = await loadCachedPrices(rec.code);
    if (!raw) continue;
    const series = cleanSeries(raw);
    if (series.dates.length > 60) loaded.push({ rec, series, ended: endedEarly(series, snap.asOf) });
  }
  // 사용자가 data/delisted.csv 로 제공한 상장폐지 ETF(있을 때만). 생존편향을 줄이기 위한 것이다.
  let delistedIncluded = 0;
  const { loaded: delisted, skipped: delistedSkipped } = await loadCachedDelisted();
  for (const d of delisted) {
    if (loaded.some((l) => l.rec.code === d.rec.code)) continue; // 이미 상장 목록에 있으면 중복 방지
    loaded.push({ rec: d.rec, series: d.series, ended: true });
    delistedIncluded++;
  }
  return { loaded, asOf: snap.asOf, delistedIncluded, delistedSkipped };
}

/** 기준일 t 시점에 "살아 있던" ETF와 그 시점까지의 지표. 기준일 이후 데이터는 쓰지 않는다. */
export function universeAsOf(loaded: Loaded[], t: string): AsOfEtf[] {
  const out: AsOfEtf[] = [];
  for (const l of loaded) {
    const idx = indexOnOrBefore(l.series.dates, t);
    if (idx < 1) continue;
    // 기준일이 속한 달에 거래 기록이 있어야 한다(거래정지·상장 전 제외)
    if ((l.series.dates[idx] as string) < `${t.slice(0, 6)}01`) continue;
    // 이미 시세가 끝난 ETF(상장폐지)의 마지막 행에서는 이후 관측이 없어 단일 평가가 불가능한데(null),
    // 바스켓에서는 현금으로 남는 불일치가 생긴다. 마지막 행(마지막 거래일 당일 포함)은 유니버스에서 뺀다.
    if (l.ended && idx === l.series.dates.length - 1) continue;
    const m = computeMetrics(l.series, idx);
    if (!m) continue;
    out.push({ e: { ...l.rec, aumEok: 10_000, fee: null, navGap: null, m }, series: l.series, idx, ended: l.ended });
  }
  return out;
}

/** from 이후 ~ to 이하의 달력상 월말(YYYYMMDD) 목록 */
export function monthEnds(from: string, to: string): string[] {
  const out: string[] = [];
  let first = shiftMonths(`${from.slice(0, 6)}01`, 1); // from 다음 달 1일
  for (;;) {
    const y = +first.slice(0, 4);
    const m = +first.slice(4, 6);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const d = `${first.slice(0, 6)}${String(last).padStart(2, "0")}`;
    if (d > to) break;
    out.push(d);
    first = shiftMonths(first, 1);
  }
  return out;
}

export function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}
export function stderr(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1) / xs.length);
}
/** 선형 보간 없는 단순 백분위(0~1) */
export function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))] as number;
}

/**
 * 기준 인덱스에서 5거래일 간격으로 거슬러 올라가며 만든 주간 종가(오래된 것 → 최신).
 * 앱의 주간 격자(series.json)와 같은 방식이라 조합 통계가 같은 정의를 따른다. 상장 전 구간은 null.
 */
export function weeklyClosesAsOf(series: PriceSeries, idx: number, weeks: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let k = weeks; k >= 0; k--) {
    const i = idx - 5 * k;
    out.push(i >= 0 ? (series.close[i] as number) : null);
  }
  return out;
}
