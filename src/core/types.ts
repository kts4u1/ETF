/**
 * 도메인 타입. core는 I/O가 없는 순수 로직이라 브라우저(web)와 Node(sync) 양쪽에서 그대로 쓴다.
 * 수익률·변동성 등 비율 값은 모두 소수(0.12 = 12%)로 저장하고, 화면에서만 %로 변환한다.
 * 단, fee / divYield / navGap 은 원천 데이터 관례대로 % 단위(0.15 = 0.15%)다.
 */

export type AssetClass =
  | "kr-equity" // 국내 주식
  | "global-equity" // 해외 주식
  | "bond" // 채권
  | "cash" // 현금성(머니마켓·CD·KOFR 등)
  | "commodity" // 원자재(금·은·원유 등)
  | "multi" // 혼합자산(주식+채권, TDF, 자산배분)
  | "real-asset" // 리츠·인프라
  | "fx"; // 통화

/** 상장 시장. 국내(KRX)와 미국(NYSE Arca·Nasdaq·Cboe 등). 이전 스냅샷에는 필드가 없고, 없으면 국내로 본다. */
export type Market = "KR" | "US";
/** 화면·추천 설정의 시장 선택. all 은 국내와 해외를 한 목록에서 함께 본다. */
export type MarketFilter = "all" | Market;

export type Region = "KR" | "US" | "CN" | "JP" | "IN" | "VN" | "EU" | "GLOBAL" | "NA";

/** 상품 구조상의 특징. 위험/비용/기대수익 해석에 영향을 주는 것들만 둔다. */
export type StructureTag =
  | "leveraged" // 레버리지 (일간 수익률의 n배 추종)
  | "inverse" // 인버스 (일간 수익률의 -n배)
  | "covered-call" // 커버드콜 (옵션 프리미엄 수취, 상승 제한)
  | "hedged" // 환헤지(H)
  | "synthetic" // 합성(스왑) 복제
  | "active" // 액티브 운용
  | "total-return" // TR (분배금 재투자)
  | "dividend" // 배당 지향
  | "concentrated" // 단일종목 또는 소수(TOP1~5) 종목 집중
  | "futures"; // 선물 기반(만기 교체 비용 발생)

export interface Taxonomy {
  assetClass: AssetClass;
  region: Region;
  /** 화면에 칩으로 보여줄 테마명. 시장대표지수(S&P500, 코스피200 등)는 지수명. */
  theme: string | null;
  /** 시장 대표 지수(넓게 분산)인지 */
  broad: boolean;
  tags: StructureTag[];
  /** 레버리지 배수. 일반 1, 2배 레버리지 2, 인버스 -1, 인버스 2배 -2 */
  leverage: number;
  /** 운용사 브랜드(KODEX, TIGER …) */
  brand: string;
  /** 브랜드를 뗀 정규화 이름. 같은 지수를 추종하는 ETF끼리 같은 값이 된다. */
  groupKey: string;
}

/** 일별 시세. 배당·분배금이 보정된 수정주가 기준이라 총수익(Total Return)에 가깝다. */
export interface PriceSeries {
  /** YYYYMMDD, 오름차순 */
  dates: string[];
  close: number[];
  volume: number[];
}

export interface Returns {
  m1: number | null;
  m3: number | null;
  m6: number | null;
  y1: number | null;
  y3: number | null; // 3년 누적
  y5: number | null; // 5년 누적
}

export interface Metrics {
  /** 지표 기준일 YYYYMMDD */
  asOf: string;
  /** 지표 기준일까지의 거래일 수 */
  days: number;
  firstDate: string;
  /** 거래일 기준 상장 후 경과 연수 */
  years: number;
  ret: Returns;
  /** 연환산 수익률(CAGR). 1년 미만이면 null */
  cagr1y: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  vol1y: number | null; // 연환산 변동성
  vol3y: number | null;
  mdd1y: number | null; // 최대 낙폭(음수)
  mdd3y: number | null;
  mddAll: number | null;
  /** 직전 고점 대비 현재 낙폭(음수 또는 0) — 52주 */
  drawdown: number | null;
  sharpe1y: number | null;
  sharpe3y: number | null;
  /** 12개월 전~1개월 전 수익률(최근 1개월 단기 반등/조정 제외한 모멘텀) */
  mom12_1: number | null;
  /** 종가 / 200일 이동평균 - 1 */
  trend200: number | null;
  /** 최근 20거래일 평균 거래대금(원). 해외 상장은 거래일 환율로 환산한 값 */
  avgValue20: number | null;
}

export interface EtfRecord {
  /** 국내는 6자리 종목코드, 해외(미국)는 티커(1~5자 영문 대문자) */
  code: string;
  name: string;
  /** 상장 시장. 없으면 국내(KR)로 본다 — 이전 스냅샷과 호환. 읽을 때는 core/market.ts 의 marketOf 를 쓴다. */
  market?: Market;
  /** 해외 상장: 거래소 이름(예: "NYSE Arca"). 국내는 없음 */
  exchange?: string | null;
  /** 해외 상장: 현지 통화 가격(USD). 없으면 price 가 곧 원화 가격이다 */
  priceNative?: number | null;
  /** 해외 상장: 원천(모닝스타)이 붙인 영문 분류(예: "Large Blend"). 분류 규칙의 근거로 쓰고 화면에는 참고로만 보여준다 */
  category?: string | null;
  issuer: string | null;
  /** 원화 가격. 해외 상장은 현지 통화 가격에 기준일 환율을 곱한 값(USD/KRW) */
  price: number;
  /** 당일 등락률 % */
  changeRate: number | null;
  /** 순자산총액(억원). 해외 상장은 달러 순자산에 기준일 환율을 곱해 환산한 값 */
  aumEok: number;
  /** 총보수 % (연) */
  fee: number | null;
  /** 최근 12개월 분배율 % */
  divYield: number | null;
  /** 괴리율 % (시장가격 − NAV) / NAV */
  navGap: number | null;
  /** 운용사가 공시한 상품 설명(요약) */
  description: string;
  tax: Taxonomy;
  m: Metrics;
}

export interface Snapshot {
  version: 1;
  /** 스냅샷 생성 시각(ISO) */
  generatedAt: string;
  /** 시세 기준일 YYYYMMDD — 국내 상장 ETF 시세의 최신일(백테스트의 상장폐지 판정 기준이므로 해외 시세로 바꾸지 않는다) */
  asOf: string;
  /** 해외 상장 ETF 시세의 최신일. 해외 ETF가 없으면 없음 */
  asOfUs?: string;
  /** 해외 ETF 원화 환산에 쓴 최신 환율(원/달러)과 그 날짜 */
  fxUsdKrw?: { rate: number; date: string };
  source: string;
  etfs: EtfRecord[];
}

/** 차트용 주간 종가. 모든 ETF가 공통 날짜 격자(grid)를 공유하고 상장 전 구간은 offset 으로 건너뛴다. */
export interface SeriesFile {
  version: 1;
  grid: string[];
  s: Record<string, { o: number; c: number[] }>;
}

// ───────── 추천 입력/출력 ─────────

export type Profile = "stable" | "balanced" | "aggressive";
export type Horizon = "short" | "mid" | "long";

export interface Preferences {
  profile: Profile;
  horizon: Horizon;
  /** null 이면 전체 자산군 */
  assetClasses: AssetClass[] | null;
  /** 레버리지·인버스 포함 (기본 제외) */
  includeLeveraged: boolean;
  includeCoveredCall: boolean;
  /** 상장 1년 미만 포함 (기본 제외) */
  includeYoung: boolean;
  /** 상장 시장: 전체(국내+해외) / 국내 상장만 / 해외 상장만 */
  market: MarketFilter;
  /** 순자산 하한(억원) */
  minAumEok: number;
  /** 총보수 상한 % (null=제한 없음) */
  maxFee: number | null;
  /** 같은 지수를 추종하는 ETF는 점수가 가장 높은 하나만 대표로 노출 */
  dedupe: boolean;
}

export type FactorKey = "ret" | "eff" | "safety" | "trend" | "cost" | "trust";

export type FactorScores = Record<FactorKey, number>;

export interface Scored {
  etf: EtfRecord;
  /** 0~100 종합 점수 */
  score: number;
  factors: FactorScores;
  /** 검증 기간이 짧아서 깎인 점수(0 이상) */
  youngPenalty: number;
  /** 같은 지수/상품군 안에서의 순위(1이 최고)와 크기 */
  groupRank: number;
  groupSize: number;
  /** 같은 상품군에서 이 ETF 대신 선택 가능한 다른 ETF 코드(점수순) */
  alternatives: string[];
}

/** 후보에서 제외된 이유의 종류. UI 에서 사유별로 묶어 보여줄 때 쓴다. */
export type ExclusionCode =
  | "market"
  | "asset-class"
  | "leveraged"
  | "covered-call"
  | "small-aum"
  | "low-liquidity"
  | "too-young"
  | "no-track-record"
  | "high-fee"
  | "risk-limit";

export interface Exclusion {
  etf: EtfRecord;
  code: ExclusionCode;
  /** 사람이 읽을 수 있는 제외 사유(수치 포함) */
  reason: string;
}

export interface Recommendation {
  ranked: Scored[];
  excluded: Exclusion[];
  /** 점수 계산에 쓰인 후보 수(제외 후) */
  universeSize: number;
}
