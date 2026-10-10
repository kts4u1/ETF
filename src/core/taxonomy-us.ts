import type { Taxonomy } from "./types";

/**
 * 해외(미국) 상장 ETF 분류기 — 계약만 정의한 임시 구현입니다. 실제 규칙은 이 파일에서 구현합니다.
 *
 * 입력은 미국 상장 ETF 한 종목의 원천 정보(영문 이름과 모닝스타 카테고리 등)이고, 출력은 국내 ETF와
 * 같은 `Taxonomy` 입니다(자산군·지역·테마는 화면에 한글로 나옵니다).
 */
export interface UsEtfInfo {
  /** 티커(예: "SPY") */
  symbol: string;
  /** 영문 상품명(예: "SPDR S&P 500 ETF Trust") */
  name: string;
  /** 모닝스타 카테고리(예: "Large Blend", "Trading--Leveraged Equity"). 없을 수 있음 */
  category: string | null;
  /** 운용사 그룹(예: "State Street Investment Management"). 없을 수 있음 */
  family: string | null;
  /** 법적 형태(예: "Exchange Traded Fund", "Grantor Trust"). 없을 수 있음 */
  legalType: string | null;
}

export function classifyUs(info: UsEtfInfo): Taxonomy {
  const brand = info.name.split(" ")[0] ?? "";
  return {
    assetClass: "global-equity",
    region: "US",
    theme: null,
    broad: false,
    tags: [],
    leverage: 1,
    brand,
    groupKey: `us:${info.symbol.toLowerCase()}`,
  };
}
