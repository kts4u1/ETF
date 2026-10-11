/** 백테스트 공통 코드: 과거 시점의 유니버스 구성, 월말 생성, 통계 유틸. */
import { readFile } from "node:fs/promises";
import { marketOf } from "../core/market";
import { cleanSeries, computeMetrics, endedEarly, indexOnOrBefore, shiftMonths } from "../core/metrics";
import type { EtfRecord, PriceSeries, Snapshot } from "../core/types";
import { loadCachedList, loadCachedPrices } from "./build-snapshot";
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
  // 백테스트(워크포워드 검증)는 국내 상장 ETF 만 쓴다. 해외 상장 ETF 가 스냅샷에 섞여 있어도 유니버스가 달라지지 않는다.
  // (해외는 시세 캐시가 .cache/yahoo 에 따로 있고, snap.asOf 도 국내 기준일이다.)
  const domestic = snap.etfs.filter((e) => marketOf(e) === "KR");
  const loaded: Loaded[] = [];
  for (const rec of domestic) {
    const raw = await loadCachedPrices(rec.code);
    if (!raw) continue;
    const series = cleanSeries(raw);
    if (series.dates.length > 60) loaded.push({ rec, series, ended: endedEarly(series, snap.asOf) });
  }
  // 기준은 스냅샷(sync --limit N 이 N개로 줄여 쓴다)과 캐시된 전체 목록 중 큰 쪽이다. 해외 레코드는 세지 않는다
  // (세면 국내 시세 캐시가 충분해도 "절반 미만"으로 잘못 중단된다).
  const fullCount = Math.max(domestic.length, (await loadCachedList())?.length ?? 0);
  assertUniverseUsable(loaded.length, fullCount, process.env.BACKTEST_ALLOW_PARTIAL === "1");
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
/**
 * 양측 95% Student t 임계값(자유도 df). 겹치지 않는 표본은 2~22개뿐이라 정규분포의 1.96 을 쓰면
 * 구간이 크게 좁아져(표본 3개면 2.2배, 2개면 6.5배) 우연한 '유의'가 생긴다. df>30 은 구간별 보수적 근사.
 */
const T95 = [
  NaN, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086,
  2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];
export function tCritical95(df: number): number {
  if (!(df >= 1)) return NaN;
  if (df <= 30) return T95[Math.floor(df)] as number;
  if (df <= 40) return 2.042; // df 30 의 값(보수적)
  if (df <= 60) return 2.021;
  if (df <= 120) return 2.0;
  return 1.98;
}

/** 표본 평균의 95% 신뢰구간 반폭(t 분포). 표본이 2개 미만이면 NaN. */
export function ci95(xs: number[]): number {
  return xs.length > 1 ? tCritical95(xs.length - 1) * stderr(xs) : NaN;
}

/**
 * 매월 겹치는 m개월 수익률에서 "겹치지 않는 표본"의 평균과 95% 구간(t 분포).
 * 월 시계열에서 m개월 간격으로 뽑으면 겹치지 않지만, 어느 달부터 뽑느냐(시작 위상 0..m-1)에 따라 결과가 달라진다 —
 * 첫 달부터만 뽑으면 위상 하나에 결과가 좌우된다(실제로 위상에 따라 유의 칸 수가 0~1개로 바뀌었다).
 * 그래서 가능한 m가지 시작 위상을 모두 계산해(표본이 2개 이상인 위상만) 평균과 구간 반폭을 각각 평균한다.
 * n 은 쓴 위상들의 평균 표본 수(반올림). 쓸 수 있는 위상이 없으면 n=floor(길이/m), mean 은 전체 평균, ci 는 NaN.
 */
export function phaseCI(xs: number[], m: number): { mean: number; ci: number; n: number } {
  const means: number[] = [];
  const cis: number[] = [];
  const sizes: number[] = [];
  for (let p = 0; p < m; p++) {
    const sub = xs.filter((_, i) => i % m === p);
    if (sub.length < 2) continue;
    means.push(mean(sub));
    cis.push(ci95(sub));
    sizes.push(sub.length);
  }
  if (!means.length) return { mean: xs.length ? mean(xs) : NaN, ci: NaN, n: Math.floor(xs.length / m) };
  return { mean: mean(means), ci: mean(cis), n: Math.round(mean(sizes)) };
}

/** IC 의 비중첩 표본 구간 반폭(없으면 null). 요약 JSON 과 리포트의 IC 표가 같은 값을 쓰도록 한 곳에 둔다. */
export function icInterval(ic: number[], m: number): number | null {
  const ci = phaseCI(ic, m).ci;
  return Number.isFinite(ci) ? ci : null;
}

/** 칸들의 겹치지 않는 표본 수 범위 표기(예: "2~22"). */
export function indepRangeText(ns: number[]): string {
  return `${Math.min(...ns)}~${Math.max(...ns)}`;
}

/**
 * 상장 ETF 시세 캐시가 비었거나 일부만 있는 상태에서 백테스트를 돌리면 빈 결과가 커밋된 산출물(backtest.json,
 * BACKTEST.md)을 덮어쓴다. 현재 상장 ETF의 절반 미만만 읽었으면 중단한다(개발용 부분 실행은 allowPartial).
 */
export function assertUniverseUsable(listedLoaded: number, snapshotCount: number, allowPartial = false): void {
  if (allowPartial || snapshotCount === 0) return;
  if (listedLoaded < snapshotCount / 2) {
    throw new Error(
      `시세 캐시가 부족합니다(현재 상장 ETF ${snapshotCount}개 중 ${listedLoaded}개만 읽음). 먼저 \`npm run sync\` 를 실행하세요. `
        + "(부분 캐시로 일부러 돌리려면 BACKTEST_ALLOW_PARTIAL=1)",
    );
  }
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
