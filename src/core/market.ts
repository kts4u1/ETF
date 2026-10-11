import { langRecord } from "./i18n";
import type { EtfRecord, Market } from "./types";

/** 상장 시장. 이전 스냅샷(market 필드 없음)은 모두 국내 상장이다. */
export const marketOf = (e: Pick<EtfRecord, "market">): Market => e.market ?? "KR";

export const MARKET_LABEL: Record<Market, string> = langRecord<Market>(
  { KR: "국내 상장", US: "해외(미국) 상장" },
  { KR: "Korea-listed", US: "US-listed" },
);

/** 칩·배지처럼 좁은 곳에 쓰는 짧은 이름 */
export const MARKET_SHORT: Record<Market, string> = langRecord<Market>({ KR: "국내", US: "미국" }, { KR: "KR", US: "US" });

export const isOverseas = (e: Pick<EtfRecord, "market">): boolean => marketOf(e) !== "KR";

/**
 * 해외(미국) 상장 ETF 수집 기준. 미국에는 ETF가 5천 개 가까이 있고 대부분 규모가 작아 거래가 드물다.
 * 화면과 데이터 크기를 감당할 수 있게 순자산·거래대금이 큰 종목만 수집한다(둘 다 원화 환산 기준).
 * sync 가 이 값으로 걸러내고, 화면은 같은 값을 안내 문구에 쓴다.
 */
export const US_MIN_AUM_EOK = 5_000;
export const US_MIN_AVG_VALUE_WON = 1e9;
