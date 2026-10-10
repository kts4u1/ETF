import { MARKET_LABEL, marketOf } from "./market";
import type {
  EtfRecord,
  Exclusion,
  ExclusionCode,
  FactorKey,
  FactorScores,
  Horizon,
  Preferences,
  Profile,
  Recommendation,
  Scored,
} from "./types";

/**
 * 추천 점수 엔진 (순수 함수).
 *
 * 구조: ① 하드 게이트(자격 심사) → ② 팩터별 0~100 점수 → ③ 투자 성향·기간별 가중합 → ④ 동일 지수 중복 제거.
 *
 * 중요한 한계: 이 점수는 "과거 데이터에서 위험 대비 성과가 좋고, 비용이 낮고, 거래가 잘 되는 ETF"를
 * 가려내는 필터이지 미래 수익률 예측기가 아니다. docs/DESIGN.md 의 "검증 결과" 참고.
 */

export const FACTOR_KEYS: FactorKey[] = ["ret", "eff", "safety", "trend", "cost", "trust"];

export const FACTOR_LABELS: Record<FactorKey, { name: string; hint: string }> = {
  ret: { name: "수익성", hint: "최근 1·3·5년 연환산 수익률" },
  eff: { name: "효율", hint: "위험 대비 수익(샤프지수)" },
  safety: { name: "안정성", hint: "최대낙폭·변동성·고점 대비 위치" },
  trend: { name: "추세", hint: "12개월 모멘텀·200일선 위 여부" },
  cost: { name: "비용", hint: "연 총보수가 낮을수록 높음" },
  trust: { name: "신뢰", hint: "순자산 규모와 거래대금" },
};

export interface ProfileConfig {
  label: string;
  description: string;
  weights: FactorScores;
  /** 연 변동성 상한(소수). 초과하면 후보에서 제외. null=제한 없음 */
  maxVol: number | null;
  /** 최대낙폭 한도(양수). 초과하면 후보에서 제외. null=제한 없음 */
  maxMdd: number | null;
}

export const PROFILES: Record<Profile, ProfileConfig> = {
  stable: {
    label: "안정형",
    description: "원금 손실을 최소화하고 싶어요. 낙폭이 작고 꾸준한 ETF를 우선합니다.",
    weights: { ret: 0.1, eff: 0.25, safety: 0.35, trend: 0.05, cost: 0.12, trust: 0.13 },
    // 위험 등급(explain.riskGrade)의 3등급 상한(변동성 15%)과 일치
    maxVol: 0.15,
    maxMdd: 0.25,
  },
  balanced: {
    label: "중립형",
    description: "어느 정도 변동은 감수하고 수익과 안정의 균형을 원해요.",
    weights: { ret: 0.25, eff: 0.25, safety: 0.2, trend: 0.1, cost: 0.1, trust: 0.1 },
    // 4등급 상한(변동성 30%)과 일치 — "위험 매우 높음(5등급)" 상품은 중립형에 추천하지 않는다
    maxVol: 0.3,
    maxMdd: 0.45,
  },
  aggressive: {
    label: "공격형",
    description: "큰 등락을 감수하더라도 높은 수익을 노려요.",
    weights: { ret: 0.4, eff: 0.15, safety: 0.05, trend: 0.22, cost: 0.08, trust: 0.1 },
    maxVol: null,
    maxMdd: null,
  },
};

export const HORIZONS: Record<Horizon, { label: string; description: string; mult: FactorScores }> = {
  short: {
    label: "1년 미만",
    description: "단기: 최근 추세와 모멘텀 비중을 높입니다.",
    mult: { ret: 1, eff: 1, safety: 1, trend: 1.5, cost: 0.6, trust: 1 },
  },
  mid: {
    label: "1~3년",
    description: "중기: 기본 가중치를 사용합니다.",
    mult: { ret: 1, eff: 1, safety: 1, trend: 1, cost: 1, trust: 1 },
  },
  long: {
    label: "3년 이상",
    description: "장기: 비용(복리로 누적)과 위험 대비 효율 비중을 높이고 단기 추세 비중을 낮춥니다.",
    mult: { ret: 1, eff: 1.2, safety: 1, trend: 0.5, cost: 1.5, trust: 1 },
  },
};

/** 수익률 창(1·3·5년)과 샤프(1·3년)에서 투자 기간별로 어느 구간을 더 보는지 */
const RET_WINDOW_WEIGHTS: Record<Horizon, [number, number, number]> = {
  short: [0.6, 0.3, 0.1],
  mid: [0.35, 0.5, 0.15],
  long: [0.2, 0.4, 0.4],
};
const EFF_WINDOW_WEIGHTS: Record<Horizon, [number, number]> = {
  short: [0.6, 0.4],
  mid: [0.4, 0.6],
  long: [0.3, 0.7],
};

/** 점수 계산 대상이 되려면 최소한 필요한 일평균 거래대금(원) */
export const MIN_AVG_VALUE = 3e8;
/** 상장 3년 미만에 적용하는 최대 감점 */
const MAX_YOUNG_PENALTY = 8;

export const DEFAULT_PREFS: Preferences = {
  profile: "balanced",
  horizon: "mid",
  assetClasses: null,
  market: "all",
  includeLeveraged: false,
  includeCoveredCall: true,
  includeYoung: false,
  minAumEok: 300,
  maxFee: null,
  dedupe: true,
};

/** 투자 성향·기간을 반영해 합이 1이 되도록 정규화한 최종 가중치 */
export function effectiveWeights(profile: Profile, horizon: Horizon): FactorScores {
  const base = PROFILES[profile].weights;
  const mult = HORIZONS[horizon].mult;
  const raw = Object.fromEntries(FACTOR_KEYS.map((k) => [k, base[k] * mult[k]])) as FactorScores;
  const sum = FACTOR_KEYS.reduce((s, k) => s + raw[k], 0);
  return Object.fromEntries(FACTOR_KEYS.map((k) => [k, raw[k] / sum])) as FactorScores;
}

// ───────── ① 자격 심사 ─────────

export function isLeveraged(e: EtfRecord): boolean {
  return e.tax.tags.includes("leveraged") || e.tax.tags.includes("inverse");
}

/** 변동성·낙폭은 3년 지표를 우선하고, 없으면 1년 지표를 쓴다 */
export const volOf = (e: EtfRecord) => e.m.vol3y ?? e.m.vol1y;
export const mddOf = (e: EtfRecord) => e.m.mdd3y ?? e.m.mdd1y ?? e.m.mddAll;

export const EXCLUSION_LABEL: Record<ExclusionCode, string> = {
  market: "선택하지 않은 상장 시장",
  "asset-class": "선택하지 않은 자산군",
  leveraged: "레버리지·인버스",
  "covered-call": "커버드콜",
  "small-aum": "순자산이 작음",
  "low-liquidity": "거래대금이 적음",
  "too-young": "상장 3개월 미만",
  "no-track-record": "상장 1년 미만",
  "high-fee": "총보수 상한 초과",
  "risk-limit": "투자 성향 위험 한도 초과",
};

export interface Ineligible {
  code: ExclusionCode;
  reason: string;
}

/** 후보에서 제외해야 하면 사유(코드 + 사람이 읽는 문장)를, 통과하면 null 을 돌려준다 */
export function checkEligibility(e: EtfRecord, p: Preferences): Ineligible | null {
  const no = (code: ExclusionCode, reason: string): Ineligible => ({ code, reason });
  if (p.market !== "all" && marketOf(e) !== p.market) return no("market", `${MARKET_LABEL[marketOf(e)]} ETF — 선택한 시장(${MARKET_LABEL[p.market]})이 아님`);
  if (p.assetClasses && !p.assetClasses.includes(e.tax.assetClass)) return no("asset-class", "선택하지 않은 자산군");
  if (isLeveraged(e) && !p.includeLeveraged) return no("leveraged", "레버리지·인버스 상품 (설정에서 포함 가능)");
  if (e.tax.tags.includes("covered-call") && !p.includeCoveredCall) return no("covered-call", "커버드콜 상품 (설정에서 포함 가능)");
  if (e.aumEok < p.minAumEok) {
    return no("small-aum", `순자산 ${Math.round(e.aumEok).toLocaleString("ko-KR")}억원 — 최소 ${p.minAumEok.toLocaleString("ko-KR")}억원 미만`);
  }
  if (e.m.avgValue20 === null || e.m.avgValue20 < MIN_AVG_VALUE) return no("low-liquidity", `일평균 거래대금이 ${MIN_AVG_VALUE / 1e8}억원 미만이라 사고팔기 어려움`);
  if (!p.includeYoung && e.m.ret.y1 === null) return no("no-track-record", "상장 1년 미만이라 성과 검증 부족 (설정에서 포함 가능)");
  if (p.includeYoung && e.m.ret.m3 === null) return no("too-young", "상장 3개월 미만이라 지표 계산 불가");
  if (p.maxFee !== null && e.fee !== null && e.fee > p.maxFee) return no("high-fee", `총보수 ${e.fee}% — 상한 ${p.maxFee}% 초과`);

  const cfg = PROFILES[p.profile];
  const vol = volOf(e);
  if (cfg.maxVol !== null && vol !== null && vol > cfg.maxVol) {
    return no("risk-limit", `변동성 연 ${(vol * 100).toFixed(0)}% — ${cfg.label} 한도(${(cfg.maxVol * 100).toFixed(0)}%) 초과`);
  }
  const mdd = mddOf(e);
  if (cfg.maxMdd !== null && mdd !== null && -mdd > cfg.maxMdd) {
    return no("risk-limit", `최대낙폭 ${(mdd * 100).toFixed(0)}% — ${cfg.label} 한도(-${(cfg.maxMdd * 100).toFixed(0)}%) 초과`);
  }
  return null;
}

// ───────── ② 팩터 점수 ─────────

/** 평균 순위 방식 백분위(0~100). null 은 그대로 null. 값이 하나뿐이면 50. */
export function percentileRanks(values: (number | null)[]): (number | null)[] {
  const idx: number[] = [];
  values.forEach((v, i) => {
    if (v !== null && Number.isFinite(v)) idx.push(i);
  });
  const n = idx.length;
  const out: (number | null)[] = values.map(() => null);
  if (n === 0) return out;
  if (n === 1) {
    out[idx[0] as number] = 50;
    return out;
  }
  idx.sort((a, b) => (values[a] as number) - (values[b] as number));
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1] as number] === values[idx[i] as number]) j++;
    const pct = (((i + j) / 2) / (n - 1)) * 100; // 동점은 평균 순위
    for (let k = i; k <= j; k++) out[idx[k] as number] = pct;
    i = j + 1;
  }
  return out;
}

/** (값, 가중치) 쌍에서 null 을 빼고 가중치를 재정규화한 평균. 전부 null 이면 fallback. */
function weightedMean(parts: [number | null, number][], fallback: number): number {
  let s = 0;
  let w = 0;
  for (const [v, wt] of parts) {
    if (v === null) continue;
    s += v * wt;
    w += wt;
  }
  return w > 0 ? s / w : fallback;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** log 스케일 0~100: lo 이하 0점, hi 이상 100점 */
function logScale(v: number, lo: number, hi: number): number {
  if (v <= 0) return 0;
  return clamp01((Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100;
}

/** 비용 점수: 총보수 0% = 100점, 0.7% 이상 = 0점. 모르면 중립 50점. */
export function costScore(fee: number | null): number {
  if (fee === null) return 50;
  return clamp01(1 - fee / 0.7) * 100;
}

/** 신뢰 점수: 순자산(300억~1조, log)과 일평균 거래대금(3억~100억, log)의 평균 */
export function trustScore(aumEok: number, avgValue20: number | null): number {
  const aum = logScale(aumEok, 300, 10_000);
  const liq = avgValue20 === null ? 0 : logScale(avgValue20, 3e8, 1e10);
  return (aum + liq) / 2;
}

export function computeFactors(cands: EtfRecord[], horizon: Horizon): FactorScores[] {
  const col = (f: (e: EtfRecord) => number | null) => percentileRanks(cands.map(f));
  const [r1, r3, r5] = RET_WINDOW_WEIGHTS[horizon];
  const [s1, s3] = EFF_WINDOW_WEIGHTS[horizon];

  const pCagr1 = col((e) => e.m.cagr1y);
  const pCagr3 = col((e) => e.m.cagr3y);
  const pCagr5 = col((e) => e.m.cagr5y);
  const pSh1 = col((e) => e.m.sharpe1y);
  const pSh3 = col((e) => e.m.sharpe3y);

  // 안정성: 값이 작을수록 좋은 지표는 부호를 뒤집어 순위를 매긴다
  const pMdd1 = col((e) => (e.m.mdd1y === null ? null : e.m.mdd1y)); // 음수라 클수록(0에 가까울수록) 좋음
  const pMdd3 = col((e) => (e.m.mdd3y === null ? null : e.m.mdd3y));
  const pVol1 = col((e) => (e.m.vol1y === null ? null : -e.m.vol1y));
  const pVol3 = col((e) => (e.m.vol3y === null ? null : -e.m.vol3y));
  const pDd = col((e) => e.m.drawdown); // 0에 가까울수록(고점 근처) 높음

  const pMom = col((e) => e.m.mom12_1);
  const pM6 = col((e) => e.m.ret.m6);
  const pTrend = col((e) => e.m.trend200);

  return cands.map((e, i) => {
    const at = (a: (number | null)[]) => a[i] ?? null;
    return {
      ret: weightedMean([[at(pCagr1), r1], [at(pCagr3), r3], [at(pCagr5), r5]], 40),
      eff: weightedMean([[at(pSh1), s1], [at(pSh3), s3]], 40),
      safety: weightedMean(
        [[at(pMdd1), 0.2], [at(pMdd3), 0.3], [at(pVol1), 0.15], [at(pVol3), 0.2], [at(pDd), 0.15]],
        40,
      ),
      trend: weightedMean([[at(pMom), 0.4], [at(pM6), 0.3], [at(pTrend), 0.3]], 40),
      cost: costScore(e.fee),
      trust: trustScore(e.aumEok, e.m.avgValue20),
    };
  });
}

/** 상장 3년 미만 감점: 짧을수록 크다 */
export function youngPenalty(years: number): number {
  return years >= 3 ? 0 : (clamp01((3 - years) / 3)) * MAX_YOUNG_PENALTY;
}

// ───────── ③④ 종합 및 중복 제거 ─────────

export function rankEtfs(universe: EtfRecord[], prefs: Preferences): Recommendation {
  const excluded: Exclusion[] = [];
  const cands: EtfRecord[] = [];
  for (const e of universe) {
    const why = checkEligibility(e, prefs);
    if (why) excluded.push({ etf: e, ...why });
    else cands.push(e);
  }

  const w = effectiveWeights(prefs.profile, prefs.horizon);
  const factors = computeFactors(cands, prefs.horizon);
  const scored: Scored[] = cands.map((etf, i) => {
    const f = factors[i] as FactorScores;
    const base = FACTOR_KEYS.reduce((s, k) => s + w[k] * f[k], 0);
    const pen = youngPenalty(etf.m.years);
    return {
      etf,
      score: Math.max(0, base - pen),
      factors: f,
      youngPenalty: pen,
      groupRank: 1,
      groupSize: 1,
      alternatives: [],
    };
  });

  // 같은 지수(groupKey)끼리 묶어 순위를 매긴다. 점수가 같으면 총보수가 낮은 쪽, 그다음 규모가 큰 쪽.
  const groups = new Map<string, Scored[]>();
  for (const s of scored) {
    const k = s.etf.tax.groupKey;
    const arr = groups.get(k);
    if (arr) arr.push(s);
    else groups.set(k, [s]);
  }
  const cmp = (a: Scored, b: Scored) =>
    b.score - a.score || (a.etf.fee ?? 9) - (b.etf.fee ?? 9) || b.etf.aumEok - a.etf.aumEok;
  const reps: Scored[] = [];
  for (const arr of groups.values()) {
    arr.sort(cmp);
    arr.forEach((s, i) => {
      s.groupRank = i + 1;
      s.groupSize = arr.length;
      s.alternatives = arr.filter((x) => x !== s).map((x) => x.etf.code);
    });
    if (prefs.dedupe) reps.push(arr[0] as Scored);
    else reps.push(...arr);
  }
  reps.sort(cmp);
  return { ranked: reps, excluded, universeSize: cands.length };
}

/** 같은 지수/상품군에 속한 모든 ETF(제외 여부와 무관). 비교 화면용. */
export function sameGroup(all: EtfRecord[], target: EtfRecord): EtfRecord[] {
  return all.filter((e) => e.tax.groupKey === target.tax.groupKey).sort((a, b) => b.aumEok - a.aumEok);
}

/**
 * 상위 목록이 한 종류로 쏠리지 않게 한다. 같은 (자산군, 테마) 버킷에서 perBucket 개까지만 허용하고
 * 순위는 유지한다. 예) 안정형 상위가 전부 CD금리/머니마켓이거나, 코스피200 계열 3개가 연달아 나오는 것을 방지.
 */
export function diversify(ranked: Scored[], limit: number, perBucket = 2): Scored[] {
  const count = new Map<string, number>();
  const out: Scored[] = [];
  for (const s of ranked) {
    const key = `${s.etf.tax.assetClass}|${s.etf.tax.theme ?? s.etf.tax.groupKey}`;
    const c = count.get(key) ?? 0;
    if (c >= perBucket) continue;
    count.set(key, c + 1);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}
