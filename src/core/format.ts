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

/** 원 → "180억" / "3.2억" / "5,200만" */
export const fmtWon = (won: number | null): string => {
  if (won === null) return "-";
  if (won >= 1e12) return `${(won / 1e12).toFixed(1)}조`;
  if (won >= 1e8) return `${(won / 1e8).toFixed(won >= 1e10 ? 0 : 1)}억`;
  return `${Math.round(won / 1e4).toLocaleString("ko-KR")}만`;
};

/** 20261008 → 2026-10-08 */
export const fmtDate = (ymd: string): string => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

export const fmtYears = (years: number): string => {
  if (years < 1) return `${Math.max(1, Math.round(years * 12))}개월`;
  return `${years.toFixed(1)}년`;
};
