import type { EtfRecord, Market } from "./types";

/** 상장 시장. 이전 스냅샷(market 필드 없음)은 모두 국내 상장이다. */
export const marketOf = (e: Pick<EtfRecord, "market">): Market => e.market ?? "KR";

export const MARKET_LABEL: Record<Market, string> = {
  KR: "국내 상장",
  US: "해외(미국) 상장",
};

/** 칩·배지처럼 좁은 곳에 쓰는 짧은 이름 */
export const MARKET_SHORT: Record<Market, string> = {
  KR: "국내",
  US: "미국",
};

export const isOverseas = (e: Pick<EtfRecord, "market">): boolean => marketOf(e) !== "KR";
