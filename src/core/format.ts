/** 화면·설명 문장에서 공통으로 쓰는 숫자 포맷터. 비율(소수)을 받는 것과 % 단위를 받는 것을 이름으로 구분한다. */

export const fmtRatio = (v: number | null, digits = 1, sign = false): string => {
  if (v === null || !Number.isFinite(v)) return "-";
  const s = (v * 100).toFixed(digits);
  return `${sign && v > 0 ? "+" : ""}${s}%`;
};

/** 이미 % 단위인 값(총보수·분배율·괴리율) */
export const fmtPercentUnit = (v: number | null, digits = 2, sign = false): string => {
  if (v === null || !Number.isFinite(v)) return "-";
  return `${sign && v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
};

/** 억원 → "2.4조" / "3,100억" */
export const fmtEok = (eok: number): string => {
  if (eok >= 10_000) {
    const jo = eok / 10_000;
    return `${jo >= 100 ? jo.toFixed(0) : jo.toFixed(1)}조`;
  }
  return `${Math.round(eok).toLocaleString("ko-KR")}억`;
};

/** 원 → "1.2조" / "1,098억" / "3.2억" / "5,200만" */
export const fmtWon = (won: number | null): string => {
  if (won === null) return "-";
  if (won >= 1e12) return `${(won / 1e12).toFixed(1)}조`;
  if (won >= 1e8) {
    const eok = won / 1e8;
    return `${(eok >= 10 ? Math.round(eok) : Math.round(eok * 10) / 10).toLocaleString("ko-KR")}억`;
  }
  return `${Math.round(won / 1e4).toLocaleString("ko-KR")}만`;
};

/**
 * 총보수(%) 표기. S&P500 ETF처럼 0.01% 안팎인 초저보수가 "0.00%"로 반올림되어
 * 서로 구분되지 않는 일이 없도록, 값이 작을수록 소수 자릿수를 늘린다.
 */
export const fmtFee = (fee: number | null): string => {
  if (fee === null || !Number.isFinite(fee)) return "-";
  const digits = fee >= 0.1 ? 2 : fee >= 0.01 ? 3 : 4;
  return `${Number(fee.toFixed(digits))}%`;
};

/** 1,000만원을 1년 보유할 때 총보수로 나가는 금액(원). fee 는 % 단위(0.15 = 연 0.15%). */
export const feeWonPer10M = (fee: number): number => Math.round((fee / 100) * 10_000_000);

/** 20261008 → 2026-10-08 */
export const fmtDate = (ymd: string): string => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

/**
 * 상장폐지 목록을 만든 KRX 스냅샷 기준일(오름차순)이 놓치는 범위를 한 문장 조각으로 설명한다.
 * 기준일 시점에 상장돼 있다가 사라진 ETF만 잡히므로, 가장 이른 기준일 이전 폐지분과
 * 기준일 어디에도 걸리지 않은 채 상장했다가 폐지된 ETF는 빠진다. 스냅샷이 없으면 빈 문자열.
 */
export const fmtSurvivorshipGap = (snapshots: string[]): string => {
  const first = snapshots[0];
  if (!first) return "";
  return snapshots.length === 1
    ? `${fmtDate(first)} 이전에 상장폐지된 ETF, 그리고 ${fmtDate(first)} 이후에 새로 상장했다가 현재 이전에 폐지된 ETF`
    : `${fmtDate(first)} 이전에 상장폐지된 ETF, 그리고 기준일들 사이에 새로 상장했다가 다음 기준일(없으면 현재) 이전에 폐지된 ETF`;
};

/** 수집한 시세의 최대 길이. 이보다 오래된 ETF는 실제 상장일을 알 수 없다. */
export const HISTORY_LIMIT_DAYS = 2000;

/** 시세 보유 기간 표기. 수집 한도에 닿은 ETF는 "8년 이상"으로 적어 실제 상장 시점을 오해하지 않게 한다. */
export const fmtHistory = (years: number, days: number): string =>
  days >= HISTORY_LIMIT_DAYS - 10 ? "8년 이상" : fmtYears(years);

export const fmtYears = (years: number): string => {
  if (years < 1) return `${Math.max(1, Math.round(years * 12))}개월`;
  return `${years.toFixed(1)}년`;
};
