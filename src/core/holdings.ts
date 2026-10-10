/**
 * ETF 구성종목(PDF)을 "겹침 계산에 쓸 수 있는 노출(exposure)"로 바꾼다. 순수 함수.
 *
 * 실제 데이터에서 확인한 사실에 기반한 규칙이다.
 *  - ISIN 접두사로 자산 종류를 구분할 수 있다: KRD=현금·예금, KRY=스왑(TRS), 그 외(KR7 주식, KR1/3/4/6 채권, KRZ 단기사채, US/JP/CN… 해외주식)는 종목.
 *  - 비중 합이 100이 아닌 ETF가 흔하다(레버리지 150%+, 인버스 음수) → 파생 구조 ETF는 겹침 계산 대상에서 뺀다.
 *  - 145개 ETF가 다른 ETF를 담는다(TDF·자산배분·커버드콜 밸런스) → 한 단계 풀어서(look-through) 실제 종목으로 환산한다.
 *  - "PLUS 국채선물10년"처럼 이름에 '선물'이 들어간 ETF가 있어 이름만으로 파생을 판별하면 안 된다 → ETF 코드 일치를 먼저 본다.
 */

export interface HoldingRow {
  /** ISIN(없으면 종목코드) */
  id: string;
  /** 6자리 종목코드. ETF·국내주식은 값이 있고 해외주식·채권·현금은 대개 null */
  code: string | null;
  name: string;
  /** 순자산 대비 % */
  weight: number;
}

export type RowKind = "cash" | "derivative" | "etf" | "security";

const CASH_NAME = /^(원화|USD|YEN|JPY|EUR|CNY|HKD|\[[A-Z]{3}\])\s?(현금|예금)|^REPO\b|^콜론|예금$/;
const DERIV_NAME = /선물|스왑|SWAP|\bTRS\b|옵션|FUTURE|E-MINI|NDX|EMINI/i;

/** self 는 자기 자신을 가리키는 행(있다면)을 걸러내기 위한 코드 */
export function classifyRow(r: HoldingRow, etfCodes: ReadonlySet<string>, self: string): RowKind {
  if (r.code && etfCodes.has(r.code) && r.code !== self) return "etf";
  if (r.id.startsWith("KRD") || r.id.startsWith("USDZ") || CASH_NAME.test(r.name)) return "cash";
  if (r.id.startsWith("KRY") || DERIV_NAME.test(r.name)) return "derivative";
  return "security";
}

export interface EtfInput {
  code: string;
  name: string;
  rows: HoldingRow[];
  /** 레버리지·인버스·합성(스왑) 등 구성종목이 실제 노출을 나타내지 않는 구조 */
  derivativeStructure: boolean;
}

export type Unavailable = "derivative-structure" | "low-coverage" | "no-data";

export interface ExposureResult {
  code: string;
  /** 식별 가능한 종목: id → 순자산 대비 비중(%) */
  atoms: Map<string, number>;
  /** id → 표시 이름 */
  names: Map<string, string>;
  /** 식별 가능 비중 합(%) — 현금·파생 제외, ETF 풀어서 환산 후 */
  total: number;
  /** 다른 ETF를 풀어서 환산한 비중(%) */
  lookThrough: number;
  /** 사용 불가 사유. 있으면 atoms 는 비어 있다 */
  unavailable?: Unavailable;
}

/** 식별 가능 비중이 이보다 낮으면(예: 선물·스왑 중심) 겹침이 실제 노출을 대표하지 못한다고 보고 제외 */
export const MIN_COVERAGE = 50;
const MAX_DEPTH = 2;

/** 모든 ETF의 노출을 계산한다. ETF가 담은 ETF는 depth 한도까지 재귀로 풀고, 풀 수 없는 ETF는 ETF 자체를 하나의 종목으로 남긴다. */
export function buildExposures(inputs: EtfInput[]): Map<string, ExposureResult> {
  const byCode = new Map(inputs.map((i) => [i.code, i]));
  const etfCodes = new Set(byCode.keys());
  const memo = new Map<string, ExposureResult>();

  const compute = (code: string, depth: number): ExposureResult => {
    const cached = memo.get(`${code}@${depth}`);
    if (cached) return cached;
    const input = byCode.get(code);
    const empty = (unavailable: Unavailable): ExposureResult => ({ code, atoms: new Map(), names: new Map(), total: 0, lookThrough: 0, unavailable });
    if (!input || input.rows.length === 0) return empty("no-data");
    if (input.derivativeStructure) return empty("derivative-structure");

    const atoms = new Map<string, number>();
    const names = new Map<string, string>();
    let lookThrough = 0;
    const add = (id: string, name: string, w: number) => {
      atoms.set(id, (atoms.get(id) ?? 0) + w);
      if (!names.has(id)) names.set(id, name);
    };

    for (const r of input.rows) {
      const kind = classifyRow(r, etfCodes, code);
      if (kind === "cash" || kind === "derivative") continue;
      if (r.weight <= 0) continue; // 공매도·음수 비중은 노출로 보지 않는다
      if (kind === "security") {
        add(r.id, r.name, r.weight);
        continue;
      }
      // kind === "etf": 담고 있는 ETF를 실제 종목으로 환산
      const child = depth < MAX_DEPTH ? compute(r.code as string, depth + 1) : undefined;
      if (child && !child.unavailable) {
        lookThrough += r.weight;
        for (const [id, cw] of child.atoms) add(id, child.names.get(id) ?? id, (r.weight * cw) / 100);
      } else {
        add(`ETF:${r.code}`, r.name, r.weight); // 풀 수 없으면 ETF 자체를 하나의 노출로
      }
    }

    let total = 0;
    for (const w of atoms.values()) total += w;
    if (total < MIN_COVERAGE) return { ...empty("low-coverage"), total };
    const res: ExposureResult = { code, atoms, names, total, lookThrough };
    memo.set(`${code}@${depth}`, res);
    return res;
  };

  const out = new Map<string, ExposureResult>();
  for (const i of inputs) out.set(i.code, compute(i.code, 0));
  return out;
}
