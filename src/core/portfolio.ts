import { tr } from "./i18n";
import { RISK_FREE } from "./metrics";
import type { Exposure } from "./overlap";
import { overlapPct } from "./overlap";
import { PROFILES, diversify } from "./scoring";
import type { EtfRecord, Profile, Scored } from "./types";

/**
 * 2~3개 ETF 조합 제안 (순수 함수).
 *
 * 설계 원칙: 수익률을 예측하지 않는다. 과거 평균 수익률로 비중을 최적화하는 방식(평균-분산 최적화)은
 * 추정 오차에 극도로 민감해 표본 밖에서 단순 균등 배분보다 못한 경우가 많다고 알려져 있다.
 * 그래서 ① 후보 풀은 이미 검증된 추천 엔진의 상위 후보, ② 비중은 균등/역변동성 같은 예측이 필요 없는 규칙,
 * ③ 조합은 "품질 + 분산 효과 − 구성종목 겹침"으로 고르고, ④ 투자 성향 한도(변동성·낙폭)를 조합 수준에서 다시 검사한다.
 */

export const WEEKS_PER_YEAR = 52;
/** 조합 통계를 내려면 모든 구성 ETF가 공통으로 가져야 하는 최소 주 수 */
export const MIN_WEEKS = 52;
/** 통계에 쓰는 최대 주 수(약 3년) */
export const MAX_WEEKS = 156;
/** 구성종목이 이보다 많이 겹치는 두 ETF는 한 조합에 넣지 않는다 */
export const MAX_PAIR_OVERLAP = 40;
/** 주간 수익률 상관이 이보다 높은 두 ETF는 사실상 같은 자산으로 보고 한 조합에 넣지 않는다 */
export const MAX_PAIR_CORR = 0.95;

export type Weighting = "equal" | "inverse-vol";

export interface ComboCandidate {
  etf: EtfRecord;
  /** 추천 엔진 점수(0~100) */
  score: number;
  /** 주간 단순수익률(오래된 것 → 최신). 길이가 곧 사용 가능한 주 수 */
  returns: number[];
  /** 구성종목 노출(없으면 겹침을 계산하지 않는다) */
  exposure?: Exposure;
}

export interface ComboStats {
  /** 통계에 쓴 공통 주 수 */
  weeks: number;
  /** 연환산 수익률(과거) */
  cagr: number;
  /** 연환산 변동성 */
  vol: number;
  /** 최대 낙폭(음수) */
  mdd: number;
  sharpe: number;
  /** 구성 ETF 변동성의 비중 가중 평균 — 분산 효과를 보려는 비교 기준 */
  avgMemberVol: number;
  /** 분산 비율 = Σ w·σ / σ_p. 1이면 분산 효과 없음, 클수록 효과 큼 */
  diversificationRatio: number;
}

export interface Proposal {
  members: { cand: ComboCandidate; weight: number }[];
  stats: ComboStats;
  /** 조합의 주간 수익률(상수 비중 가정). 차트용 */
  returns: number[];
  /** 비중 가중 평균 추천 점수 */
  quality: number;
  /** 분산 효과 점수 0~100 */
  diversification: number;
  /** 구성원 쌍 평균 겹침(%) — 구성종목 정보가 없으면 null */
  avgOverlap: number | null;
  maxOverlap: { a: string; b: string; pct: number } | null;
  /** 종합 점수(조합 순위용) */
  score: number;
}

// ───────── 주간 수익률 ─────────

/** 주간 종가(상장 전은 null) → 끝에서부터 이어지는 연속 구간의 단순수익률 */
export function weeklyReturns(values: (number | null)[]): number[] {
  const out: number[] = [];
  for (let i = values.length - 1; i >= 1; i--) {
    const cur = values[i];
    const prev = values[i - 1];
    if (cur == null || prev == null || prev <= 0) break;
    out.push(cur / prev - 1);
  }
  return out.reverse();
}

// ───────── 조합 통계 ─────────

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
function stdev(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
}
export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  const x = a.slice(a.length - n);
  const y = b.slice(b.length - n);
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] as number) - mx;
    const dy = (y[i] as number) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** 비중을 매주 유지한다고 가정(상수 비중)한 조합의 주간 수익률. 리밸런싱 비용은 제외. */
export function portfolioReturns(series: number[][], weights: number[]): number[] {
  const n = Math.min(...series.map((s) => s.length));
  const out: number[] = [];
  for (let t = 0; t < n; t++) {
    let r = 0;
    for (let k = 0; k < series.length; k++) {
      const s = series[k] as number[];
      r += (weights[k] as number) * (s[s.length - n + t] as number);
    }
    out.push(r);
  }
  return out;
}

export function statsOf(returns: number[], memberReturns: number[][], weights: number[]): ComboStats {
  const weeks = returns.length;
  let value = 1;
  let peak = 1;
  let mdd = 0;
  for (const r of returns) {
    value *= 1 + r;
    peak = Math.max(peak, value);
    mdd = Math.min(mdd, value / peak - 1);
  }
  const cagr = Math.pow(value, WEEKS_PER_YEAR / weeks) - 1;
  const vol = stdev(returns) * Math.sqrt(WEEKS_PER_YEAR);
  const memberVols = memberReturns.map((s) => stdev(s.slice(s.length - weeks)) * Math.sqrt(WEEKS_PER_YEAR));
  const avgMemberVol = memberVols.reduce((s, v, i) => s + v * (weights[i] as number), 0);
  return {
    weeks,
    cagr,
    vol,
    mdd,
    sharpe: (cagr - RISK_FREE) / Math.max(vol, 0.01),
    avgMemberVol,
    diversificationRatio: vol > 1e-9 ? avgMemberVol / vol : 1,
  };
}

// ───────── 비중 ─────────

/** 합이 1이 되도록 step(기본 5%) 단위로 반올림. 나머지는 소수 부분이 큰 순서로 배분. */
export function roundWeights(w: number[], step = 0.05): number[] {
  const units = 1 / step;
  const raw = w.map((x) => x * units);
  const floor = raw.map(Math.floor);
  let rest = Math.round(units - floor.reduce((s, x) => s + x, 0));
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (rest <= 0) break;
    floor[i] = (floor[i] as number) + 1;
    rest--;
  }
  return floor.map((u) => Math.round(u * step * 1e6) / 1e6);
}

const MIN_W = 0.15;
const MAX_W = 0.6;

/** [MIN_W, MAX_W] 로 클리핑하며 합 1 을 맞춘다(반복 재분배) */
function clipWeights(w: number[]): number[] {
  let cur = w.slice();
  for (let iter = 0; iter < 20; iter++) {
    const clipped = cur.map((x) => Math.min(MAX_W, Math.max(MIN_W, x)));
    const sum = clipped.reduce((s, x) => s + x, 0);
    const next = clipped.map((x) => x / sum);
    if (next.every((x, i) => Math.abs(x - (cur[i] as number)) < 1e-9)) return next;
    cur = next;
  }
  return cur;
}

export function weightsFor(rule: Weighting, vols: number[]): number[] {
  const n = vols.length;
  const base = rule === "equal" ? vols.map(() => 1 / n) : (() => {
    const inv = vols.map((v) => 1 / Math.max(v, 0.01));
    const s = inv.reduce((a, b) => a + b, 0);
    return inv.map((x) => x / s);
  })();
  return roundWeights(clipWeights(base));
}

// ───────── 조합 제안 ─────────

export interface ProposeOptions {
  size: 2 | 3;
  weighting?: Weighting;
  /** 후보 풀 크기(상위 점수순) */
  poolSize?: number;
  /** 반환할 제안 수 */
  limit?: number;
}

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < items.length; i++) {
      acc.push(items[i] as T);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  rec(0, []);
  return out;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 같은 지수·같은 (자산군,테마) 버킷에 속한 ETF는 한 조합에 함께 넣지 않는다 */
const bucketOf = (c: ComboCandidate) => `${c.etf.tax.assetClass}|${c.etf.tax.theme ?? c.etf.tax.groupKey}`;

/**
 * 후보 풀에서 2~3개 조합을 골라 점수순으로 돌려준다.
 * 조합 점수 = 0.6·품질(비중 가중 추천 점수) + 0.4·분산 효과 − 0.3·평균 겹침(%)
 * (가중치는 설계상의 선택이며 백테스트에 맞춰 튜닝하지 않았다 — docs/DESIGN.md 참고)
 */
export function proposeCombos(candidates: ComboCandidate[], profile: Profile, opts: ProposeOptions): Proposal[] {
  const weighting = opts.weighting ?? "inverse-vol";
  const pool = candidates
    .filter((c) => c.returns.length >= MIN_WEEKS)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.poolSize ?? 12);
  if (pool.length < opts.size) return [];

  const cfg = PROFILES[profile];
  const vol = new Map(pool.map((c) => [c, stdev(c.returns.slice(-MAX_WEEKS)) * Math.sqrt(WEEKS_PER_YEAR)]));
  const found: Proposal[] = [];

  for (const subset of combinations(pool, opts.size)) {
    // 같은 버킷(같은 자산군·테마)이나 같은 지수는 제외
    if (new Set(subset.map(bucketOf)).size < subset.length) continue;
    if (new Set(subset.map((c) => c.etf.tax.groupKey)).size < subset.length) continue;

    const weeks = Math.min(MAX_WEEKS, ...subset.map((c) => c.returns.length));
    const series = subset.map((c) => c.returns.slice(c.returns.length - weeks));

    // 쌍별 상관·겹침 필터
    let tooSimilar = false;
    for (let i = 0; i < subset.length && !tooSimilar; i++)
      for (let j = i + 1; j < subset.length; j++) {
        if (correlation(series[i] as number[], series[j] as number[]) > MAX_PAIR_CORR) tooSimilar = true;
        const ea = subset[i]!.exposure;
        const eb = subset[j]!.exposure;
        if (ea && eb && overlapPct(ea, eb) > MAX_PAIR_OVERLAP) tooSimilar = true;
      }
    if (tooSimilar) continue;

    const weights = weightsFor(weighting, subset.map((c) => vol.get(c) as number));
    const pr = portfolioReturns(series, weights);
    const stats = statsOf(pr, series, weights);

    // 투자 성향 한도를 조합 수준에서 다시 검사
    if (cfg.maxVol !== null && stats.vol > cfg.maxVol) continue;
    if (cfg.maxMdd !== null && -stats.mdd > cfg.maxMdd) continue;

    const quality = subset.reduce((s, c, i) => s + c.score * (weights[i] as number), 0);
    const diversification = clamp01((stats.diversificationRatio - 1) / 0.5) * 100;

    let sum = 0;
    let cnt = 0;
    let max: Proposal["maxOverlap"] = null;
    for (let i = 0; i < subset.length; i++)
      for (let j = i + 1; j < subset.length; j++) {
        const ea = subset[i]!.exposure;
        const eb = subset[j]!.exposure;
        if (!ea || !eb) continue;
        const p = overlapPct(ea, eb);
        sum += p;
        cnt++;
        if (!max || p > max.pct) max = { a: subset[i]!.etf.code, b: subset[j]!.etf.code, pct: p };
      }
    const avgOverlap = cnt > 0 ? sum / cnt : null;

    found.push({
      members: subset.map((cand, i) => ({ cand, weight: weights[i] as number })),
      stats,
      returns: pr,
      quality,
      diversification,
      avgOverlap,
      maxOverlap: max,
      score: 0.6 * quality + 0.4 * diversification - 0.3 * (avgOverlap ?? 0),
    });
  }

  // 점수순으로, 서로 너무 비슷한 제안(구성원 절반 이상 동일)은 건너뛰며 limit 개
  found.sort((a, b) => b.score - a.score);
  const picked: Proposal[] = [];
  for (const p of found) {
    const codes = new Set(p.members.map((m) => m.cand.etf.code));
    const similar = picked.some((q) => {
      const shared = q.members.filter((m) => codes.has(m.cand.etf.code)).length;
      return shared / (codes.size + q.members.length - shared) >= 0.5;
    });
    if (similar) continue;
    picked.push(p);
    if (picked.length >= (opts.limit ?? 3)) break;
  }
  return picked;
}

/** 조합 안에서의 역할(초보자용 라벨) */
export function roleOf(etf: EtfRecord): string {
  switch (etf.tax.assetClass) {
    case "kr-equity":
    case "global-equity":
      return tr("성장(주식)", "Growth (equity)");
    case "bond":
      return tr("안정(채권)", "Stability (bonds)");
    case "cash":
      return tr("현금성(파킹)", "Cash-like (parking)");
    case "commodity":
    case "fx":
      return tr("대체(원자재·통화)", "Alternative (commodities & currency)");
    case "real-asset":
      return tr("부동산·인프라", "REITs & infrastructure");
    case "crypto":
      return tr("대체(가상자산)", "Alternative (crypto)");
    default:
      return tr("혼합(주식+채권)", "Multi-asset (equity + bonds)");
  }
}

/** 조합 자동 제안에서 제외하는 상품: 선물 기반, 통화(환율) */
export const isComboExcluded = (e: EtfRecord): boolean => e.tax.tags.includes("futures") || e.tax.assetClass === "fx";

/**
 * 조합의 후보 풀: 상위 후보(자산군·테마당 최대 2개) + 자산군별 1위.
 * 자산군별 1위를 더하는 이유: 공격형처럼 상위 후보가 전부 같은 종류(반도체·대형주)면
 * 아무리 잘 섞어도 분산 효과가 없다. 채권·원자재 같은 분산 수단을 풀에 넣어 두면, 조합 점수가 분산 효과를
 * 따져서 필요할 때만 선택한다(품질 점수가 낮은 후보는 어차피 불리하다).
 * 앱과 백테스트가 같은 함수를 써서 검증 대상이 실제 동작과 같음을 보장한다.
 */
export function selectPool(ranked: Scored[], top = 10): Scored[] {
  // 선물 기반·통화 상품은 롤오버 비용과 환율 베팅 성격이 있어 소액 투자자에게 자동으로 제안하지 않는다(탐색에서는 볼 수 있음)
  const eligible = ranked.filter((s) => !isComboExcluded(s.etf));
  const pool = diversify(eligible, top, 2);
  const have = new Set(pool.map((s) => s.etf.code));
  const classSeen = new Set(pool.map((s) => s.etf.tax.assetClass));
  for (const s of eligible) {
    const c = s.etf.tax.assetClass;
    if (classSeen.has(c) || have.has(s.etf.code)) continue;
    classSeen.add(c);
    pool.push(s);
    have.add(s.etf.code);
  }
  return pool;
}
