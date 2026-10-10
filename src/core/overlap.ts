/**
 * 구성종목 겹침 계산(순수 함수).
 *
 * 정의: 두 ETF에 같은 금액을 넣었을 때 같은 종목에 겹쳐 들어가는 비중(%).
 *       overlap(A, B) = Σ_i min(wA_i, wB_i)   (wX_i = ETF X 순자산 대비 종목 i 비중 %)
 * 예) KODEX 200에 삼성전자 34%, 반도체 ETF에 삼성전자 27%이면 삼성전자 몫으로 27%p가 겹친다.
 *
 * 비중은 "식별 가능한 종목"(주식·채권·다른 ETF)만 담는다. 현금·예금·선물·스왑은 종목이 아니므로 제외하고,
 * 그 비율은 coverage 로 따로 알려 준다. 다른 ETF를 담은 ETF(TDF 등)는 sync 단계에서 한 단계 풀어서(look-through)
 * 저장하므로 여기서는 이미 풀린 비중을 그대로 쓴다.
 */

export interface Exposure {
  /** 식별 가능한 보유 자산의 순자산 대비 합(%) — 상위 N개만 저장해도 전체 합을 보존 */
  total: number;
  /** 식별 가능한 전체 종목 수 */
  n: number;
  /** 상위 종목 id (사전 인덱스) */
  ids: number[];
  /** 위 id 에 대응하는 순자산 대비 비중(%) — 내림차순 */
  w: number[];
}

/** 합이 100%를 넘는 경우(예: 옵션 프리미엄 포함)에만 100%로 스케일해 비교 가능하게 한다 */
const scaleOf = (e: Exposure) => (e.total > 100 ? 100 / e.total : 1);

/** 두 ETF의 겹침(%, 0~100). 저장된 상위 종목만 비교하므로 꼬리(작은 비중)는 빠진 하한 추정치다. */
export function overlapPct(a: Exposure, b: Exposure): number {
  if (a.ids.length === 0 || b.ids.length === 0) return 0;
  const sa = scaleOf(a);
  const sb = scaleOf(b);
  const map = new Map<number, number>();
  for (let i = 0; i < a.ids.length; i++) map.set(a.ids[i] as number, (a.w[i] as number) * sa);
  let sum = 0;
  for (let i = 0; i < b.ids.length; i++) {
    const wa = map.get(b.ids[i] as number);
    if (wa !== undefined) sum += Math.min(wa, (b.w[i] as number) * sb);
  }
  return sum;
}

export interface CommonHolding {
  id: number;
  /** 각 ETF에서의 비중(%) */
  wa: number;
  wb: number;
  /** 겹치는 몫 = min(wa, wb) */
  common: number;
}

/** 겹치는 종목을 겹치는 몫이 큰 순으로 */
export function commonHoldings(a: Exposure, b: Exposure, limit = 8): CommonHolding[] {
  const sa = scaleOf(a);
  const sb = scaleOf(b);
  const map = new Map<number, number>();
  for (let i = 0; i < a.ids.length; i++) map.set(a.ids[i] as number, (a.w[i] as number) * sa);
  const out: CommonHolding[] = [];
  for (let i = 0; i < b.ids.length; i++) {
    const id = b.ids[i] as number;
    const wa = map.get(id);
    if (wa === undefined) continue;
    const wb = (b.w[i] as number) * sb;
    out.push({ id, wa, wb, common: Math.min(wa, wb) });
  }
  return out.sort((x, y) => y.common - x.common).slice(0, limit);
}

/** 상위 n개 종목이 차지하는 비중(%) — 집중도. 식별 비중 대비가 아니라 순자산 대비 값. */
export function topWeight(e: Exposure, n: number): number {
  let s = 0;
  for (let i = 0; i < Math.min(n, e.w.length); i++) s += e.w[i] as number;
  return s;
}

/** 겹침 수준을 사람이 읽는 말로 */
export function overlapLevel(pct: number): { label: string; level: "high" | "mid" | "low" } {
  if (pct >= 50) return { label: "매우 비슷함", level: "high" };
  if (pct >= 25) return { label: "상당히 겹침", level: "mid" };
  if (pct >= 10) return { label: "일부 겹침", level: "low" };
  return { label: "거의 안 겹침", level: "low" };
}

/** 대칭 행렬(대각선 100). exposures 가 undefined 인 항목은 NaN 으로 표시한다(계산 불가). */
export function overlapMatrix(list: (Exposure | undefined)[]): number[][] {
  const n = list.length;
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(Number.NaN));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const a = list[i];
      const b = list[j];
      const v = !a || !b ? Number.NaN : i === j ? 100 : overlapPct(a, b);
      (m[i] as number[])[j] = v;
      (m[j] as number[])[i] = v;
    }
  }
  return m;
}

/**
 * target 과 구성이 가장 비슷한 ETF를 겹침 큰 순으로. target 의 맵을 한 번만 만들어 수백 개와 비교한다.
 * @param others [코드, 노출] 목록(target 자신이 섞여 있어도 code 로 걸러낸다)
 */
export function rankOverlaps(
  targetCode: string,
  target: Exposure,
  others: Iterable<[string, Exposure]>,
  limit = 8,
  minPct = 5,
): { code: string; pct: number }[] {
  const s = scaleOf(target);
  const map = new Map<number, number>();
  for (let i = 0; i < target.ids.length; i++) map.set(target.ids[i] as number, (target.w[i] as number) * s);
  const out: { code: string; pct: number }[] = [];
  for (const [code, e] of others) {
    if (code === targetCode) continue;
    const se = scaleOf(e);
    let sum = 0;
    for (let i = 0; i < e.ids.length; i++) {
      const wa = map.get(e.ids[i] as number);
      if (wa !== undefined) sum += Math.min(wa, (e.w[i] as number) * se);
    }
    if (sum >= minPct) out.push({ code, pct: sum });
  }
  return out.sort((a, b) => b.pct - a.pct).slice(0, limit);
}

// ───────── 저장 형식(public/data/holdings.json) ─────────

/** 사용할 수 없는 이유(구성종목 겹침을 계산할 수 없는 ETF) */
export type UnavailableReason = "derivative-structure" | "low-coverage" | "no-data";

export interface HoldingsFile {
  version: 1;
  asOf: string;
  /** ETF마다 저장한 종목 수의 상한(비중 0.01% 이상만 저장) */
  topK: number;
  /** 종목 사전: 인덱스 → ISIN(또는 ETF:코드) / 표시 이름 */
  ids: string[];
  names: string[];
  etfs: Record<
    string,
    {
      /** 식별 가능 비중 합(%) */
      t: number;
      /** 식별 가능 종목 수 */
      n: number;
      /** 다른 ETF를 풀어서 환산한 비중(%) — 0이면 직접 보유만 */
      lt: number;
      /** 상위 종목 사전 인덱스 */
      i: number[];
      /** 비중 ×100 (정수, 3447 = 34.47%) */
      w: number[];
    }
  >;
  unavailable: Record<string, UnavailableReason>;
}

/** 저장 형식 → 계산용 Exposure. 계산 불가면 undefined. */
export function exposureOf(file: HoldingsFile, code: string): Exposure | undefined {
  const e = file.etfs[code];
  if (!e) return undefined;
  return { total: e.t, n: e.n, ids: e.i, w: e.w.map((x) => x / 100) };
}
