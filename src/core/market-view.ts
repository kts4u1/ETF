import { fmtNum, langRecord, tr } from "./i18n";
import { fmtEok, fmtWon } from "./format";
import { MARKET_LABEL, US_MIN_AUM_EOK, US_MIN_AVG_VALUE_WON, marketOf } from "./market";
import { DEFAULT_PREFS } from "./scoring";
import type { EtfRecord, Exclusion, ExclusionCode, Market, MarketFilter, Preferences } from "./types";

/**
 * 화면이 상장 시장(국내/해외)을 다루는 데 쓰는 순수 함수 모음.
 * 개수·문구·검색·저장된 설정 복원처럼 컴포넌트 밖에서 테스트할 수 있는 것만 둔다.
 */

// ───────── 시장 필터 ─────────

export const MARKET_FILTERS: MarketFilter[] = ["all", "KR", "US"];

export const MARKET_FILTER_LABEL: Record<MarketFilter, string> = langRecord<MarketFilter>(
  { all: "전체", KR: "국내 상장", US: "해외(미국) 상장" },
  { all: "All", KR: "Korea-listed", US: "US-listed" },
);

export const isMarketFilter = (v: unknown): v is MarketFilter => v === "all" || v === "KR" || v === "US";

/**
 * 브라우저에 저장된 추천 설정을 복원한다. 시장 필터가 생기기 전에 저장된 설정에는 market 이 없고,
 * 손상됐거나 알 수 없는 값일 수도 있으므로 그럴 때는 기본값(전체)으로 둔다.
 */
export function mergeSavedPrefs(saved: unknown): Preferences {
  const obj = saved && typeof saved === "object" && !Array.isArray(saved) ? (saved as Partial<Preferences>) : {};
  const merged: Preferences = { ...DEFAULT_PREFS, ...obj };
  if (!isMarketFilter(merged.market)) merged.market = DEFAULT_PREFS.market;
  return merged;
}

// ───────── 개수·문구 ─────────

export type MarketCounts = Record<Market, number>;

/** 스냅샷에서 시장별 ETF 수를 센다. 화면 문구에 개수를 박아 두지 않고 항상 여기서 계산한다. */
export function countByMarket(etfs: Pick<EtfRecord, "market">[]): MarketCounts {
  const out: MarketCounts = { KR: 0, US: 0 };
  for (const e of etfs) out[marketOf(e)]++;
  return out;
}

/** "국내 상장 ETF 1,172개" / "국내 상장 ETF 1,172개와 해외(미국) 상장 ETF 1,204개". 0개인 시장은 말하지 않는다. */
export function describeCounts(counts: MarketCounts): string {
  const parts = (["KR", "US"] as const)
    .filter((m) => counts[m] > 0)
    .map((m) => tr(`${MARKET_LABEL[m]} ETF ${fmtNum(counts[m])}개`, `${fmtNum(counts[m])} ${MARKET_LABEL[m]} ETFs`));
  return parts.length ? parts.join(tr("와 ", " and ")) : tr("ETF 0개", "0 ETFs");
}

/** 해외(미국) 상장 수집 기준 안내. 숫자는 수집기와 같은 상수에서 가져온다. */
export function usCollectionRule(): string {
  return tr(
    `해외(미국) 상장은 순자산 ${fmtEok(US_MIN_AUM_EOK)}원·일평균 거래대금 ${fmtWon(US_MIN_AVG_VALUE_WON)}원 이상만 수집합니다`,
    `US-listed ETFs are collected only with net assets of at least ${fmtEok(US_MIN_AUM_EOK)} and average daily trading value of at least ${fmtWon(US_MIN_AVG_VALUE_WON)}`,
  );
}

/** 순자산 표기. 펀드 전체 합계(aumScope "fund")는 † 를 붙여 ETF 클래스만의 값이 아님을 알린다. */
export const aumText = (e: Pick<EtfRecord, "aumEok" | "aumScope">): string => `${fmtEok(e.aumEok)}${e.aumScope === "fund" ? "†" : ""}`;

export const aumFundNote = (): string =>
  tr(
    "† 펀드 전체 순자산: 같은 펀드의 뮤추얼펀드 등 다른 클래스까지 합친 값이라 이 ETF만의 규모보다 훨씬 클 수 있습니다(야후 제공값).",
    "† Fund-level net assets: includes other share classes of the same fund (e.g., the mutual fund), so it can be far larger than this ETF alone (Yahoo data).",
  );

/** 원화 환산 방식 한 줄. 가격·순자산·차트 근처에 같은 문구로 밝힌다. */
/** 환산 방식(접두사 없이): 문장 중간에 끼워 쓴다 */
export const fxMethod = (): string => tr("달러 가격 × 같은 날 원/달러 환율", "USD price × same-day USD/KRW rate");
export const fxNote = (): string => tr(`원화 환산: ${fxMethod()}`, `KRW conversion: ${fxMethod()}`);

/** 해외(미국) 상장 ETF의 거래소·모닝스타 카테고리 한 줄(참고). 국내 상장이면 null. */
export function listingLine(e: Pick<EtfRecord, "market" | "exchange" | "category">): string | null {
  if (marketOf(e) === "KR") return null;
  const parts = [e.exchange ?? null, e.category ? tr(`모닝스타 ${e.category}(참고)`, `Morningstar ${e.category} (for reference)`) : null].filter((x): x is string => !!x);
  return parts.length ? parts.join(" · ") : null;
}

// ───────── 제외 사유 요약 ─────────

export interface ExclusionSummary {
  /** 사유별 묶음(많은 순). 시장 선택으로 빠진 것은 포함하지 않는다 */
  rows: [ExclusionCode, Exclusion[]][];
  /** 자격 심사에서 제외된 ETF 수(시장 선택으로 빠진 것 제외) */
  judged: number;
  /** 선택하지 않은 시장이라 심사 대상에서 뺀 ETF 수 */
  outOfScope: number;
}

/**
 * 제외 사유를 묶는다. 선택하지 않은 시장의 ETF는 '나빠서 제외'된 것이 아니라 대상이 아닌 것이므로
 * 목록(수천 개가 될 수 있다)에 펼치지 않고 개수만 따로 센다.
 */
export function summarizeExclusions(excluded: Exclusion[]): ExclusionSummary {
  const by = new Map<ExclusionCode, Exclusion[]>();
  let outOfScope = 0;
  for (const x of excluded) {
    if (x.code === "market") {
      outOfScope++;
      continue;
    }
    const arr = by.get(x.code);
    if (arr) arr.push(x);
    else by.set(x.code, [x]);
  }
  return { rows: [...by.entries()].sort((a, b) => b[1].length - a[1].length), judged: excluded.length - outOfScope, outOfScope };
}

// ───────── 검색 ─────────

/** 대소문자와 공백을 무시하고 비교하기 위한 정규화. "s&p500" 으로 영문 이름 "S&P 500" 을 찾을 수 있다. */
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, "");

/**
 * 검색어와 ETF의 일치 정도. 0 = 불일치, 1 = 이름·테마에 포함, 2 = 코드(티커) 앞부분 일치, 3 = 코드 정확히 일치.
 * 대상은 코드(국내 6자리, 해외 티커)·이름(국내 한글, 해외 영문)·테마(한글). 빈 검색어는 모두 1.
 */
export function matchRank(e: Pick<EtfRecord, "code" | "name" | "tax">, query: string): 0 | 1 | 2 | 3 {
  const q = norm(query);
  if (!q) return 1;
  const code = norm(e.code);
  if (code === q) return 3;
  if (code.startsWith(q)) return 2;
  if (code.includes(q) || norm(e.name).includes(q) || norm(e.tax.theme ?? "").includes(q)) return 1;
  return 0;
}

export const matchesQuery = (e: Pick<EtfRecord, "code" | "name" | "tax">, query: string): boolean => matchRank(e, query) > 0;
