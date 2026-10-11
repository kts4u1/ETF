import { fmtNum, isEn, tr } from "./i18n";
import { isOverseas } from "./market";
import type { EtfRecord, Snapshot } from "./types";

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

/** 영어 금액: 1조=1T, 10억=1B, 100만=1M. 1.2e12 → "₩1.2T", 4.66e10 → "₩46.6B", 5.2e7 → "₩52M", 작으면 "₩12,345" */
const fmtWonEn = (won: number): string => {
  const trim = (n: number): string => String(Math.round(n * 10) / 10);
  if (won >= 1e12 || Math.round(won / 1e9) >= 1000) {
    const t = won / 1e12;
    return `₩${t >= 100 ? t.toFixed(0) : t.toFixed(1)}T`;
  }
  if (won >= 1e9) return `₩${won / 1e9 >= 100 ? Math.round(won / 1e9) : trim(won / 1e9)}B`;
  if (won >= 1e6) return `₩${won / 1e6 >= 100 ? Math.round(won / 1e6) : trim(won / 1e6)}M`;
  return `₩${fmtNum(Math.round(won))}`;
};

/** 억원 → "2.4조" / "3,100억" */
export const fmtEok = (eok: number): string => {
  if (isEn()) return fmtWonEn(eok * 1e8);
  if (eok >= 10_000) {
    const jo = eok / 10_000;
    return `${jo >= 100 ? jo.toFixed(0) : jo.toFixed(1)}조`;
  }
  return `${Math.round(eok).toLocaleString("ko-KR")}억`;
};

/** 원 → "1.2조" / "1,098억" / "3.2억" / "5,200만" */
export const fmtWon = (won: number | null): string => {
  if (won === null) return "-";
  if (isEn()) return fmtWonEn(won);
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

/** KRX 스냅샷 기준일 목록 표기: 3개 이하면 모두, 많으면 개수와 범위만(예: "12개(2020-12-30~2026-04-10)"). */
export const fmtSnapshotList = (snapshots: string[]): string => {
  if (snapshots.length <= 3) return snapshots.map(fmtDate).join("·");
  const [a, b] = [fmtDate(snapshots[0] as string), fmtDate(snapshots[snapshots.length - 1] as string)];
  return tr(`${snapshots.length}개(${a}~${b})`, `${snapshots.length} snapshots (${a} to ${b})`);
};

/**
 * 상장폐지 목록을 만든 KRX 스냅샷 기준일(오름차순)이 놓치는 범위를 한 문장 조각으로 설명한다.
 * 기준일 시점에 상장돼 있다가 사라진 ETF만 잡히므로, 가장 이른 기준일 이전 폐지분과
 * 기준일 어디에도 걸리지 않은 채 상장했다가 폐지된 ETF는 빠진다. 스냅샷이 없으면 빈 문자열.
 */
export const fmtSurvivorshipGap = (snapshots: string[]): string => {
  const first = snapshots[0];
  if (!first) return "";
  return snapshots.length === 1
    ? tr(
        `${fmtDate(first)} 이전에 상장폐지된 ETF, 그리고 ${fmtDate(first)} 이후에 새로 상장했다가 현재 이전에 폐지된 ETF`,
        `ETFs delisted before ${fmtDate(first)}, and ETFs listed after ${fmtDate(first)} that were delisted before today`,
      )
    : tr(
        `${fmtDate(first)} 이전에 상장폐지된 ETF, 그리고 기준일들 사이에 새로 상장했다가 다음 기준일(없으면 현재) 이전에 폐지된 ETF`,
        `ETFs delisted before ${fmtDate(first)}, and ETFs listed between snapshot dates that were delisted before the next snapshot date (or today)`,
      );
};

/** 수집한 시세의 최대 길이. 이보다 오래된 ETF는 실제 상장일을 알 수 없다. */
export const HISTORY_LIMIT_DAYS = 2000;

/** 시세 보유 기간 표기. 수집 한도에 닿은 ETF는 "8년 이상"으로 적어 실제 상장 시점을 오해하지 않게 한다. */
export const fmtHistory = (years: number, days: number): string =>
  days >= HISTORY_LIMIT_DAYS - 10 ? tr("8년 이상", "8y+") : fmtYears(years);

export const fmtYears = (years: number): string => {
  if (years < 1) return tr(`${Math.max(1, Math.round(years * 12))}개월`, `${Math.max(1, Math.round(years * 12))} mo`);
  return tr(`${years.toFixed(1)}년`, `${years.toFixed(1)}y`);
};

// ───────── 해외(미국) 상장: 달러 가격·환율·기준일 ─────────

/** 달러 금액: 543.2 → "$543.20", 1234.5 → "$1,234.50" */
export const fmtUsd = (v: number | null): string => {
  if (v === null || !Number.isFinite(v)) return "-";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/**
 * 주당 가격처럼 크지 않은 원화 금액을 짧게: 7,600 → "7,600원", 76,000 → "7.6만원", 760,480 → "76만원".
 * 환산값(≈)을 보조로 보여줄 때 쓴다. 정확한 값이 필요한 곳에는 쓰지 않는다.
 */
export const fmtWonShort = (won: number | null): string => {
  if (won === null || !Number.isFinite(won)) return "-";
  if (isEn()) {
    if (won >= 1e9) return `₩${(won / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
    if (won >= 1e6) return `₩${(won / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
    if (won >= 1e4) return `₩${won < 1e5 ? (won / 1e3).toFixed(1).replace(/\.0$/, "") : Math.round(won / 1e3)}K`;
    return `₩${fmtNum(Math.round(won))}`;
  }
  if (won >= 1e8) return `${(won / 1e8).toFixed(1).replace(/\.0$/, "")}억원`;
  if (won >= 1e4) {
    const man = won / 1e4;
    return `${man < 100 ? man.toFixed(1).replace(/\.0$/, "") : Math.round(man).toLocaleString("ko-KR")}만원`;
  }
  return `${Math.round(won).toLocaleString("ko-KR")}원`;
};

/**
 * ETF 가격 표기. 국내는 "9,800원", 해외(미국)는 달러 가격을 크게, 원화 환산값을 보조로 둔다
 * ("$543.20" + "≈ 76만원"). 현지 가격이 없는 해외 레코드는 원화 가격만 보여준다.
 */
export function priceParts(e: Pick<EtfRecord, "market" | "price" | "priceNative">): { main: string; sub: string | null } {
  if (isOverseas(e) && e.priceNative != null && Number.isFinite(e.priceNative)) {
    return { main: fmtUsd(e.priceNative), sub: `≈ ${fmtWonShort(e.price)}` };
  }
  return { main: isEn() ? `₩${fmtNum(Math.round(e.price))}` : `${Math.round(e.price).toLocaleString("ko-KR")}원`, sub: null };
}

/** "$543.20 (≈ 76만원)" / "9,800원" */
export function fmtPriceLine(e: Pick<EtfRecord, "market" | "price" | "priceNative">): string {
  const { main, sub } = priceParts(e);
  return sub ? `${main} (${sub})` : main;
}

/** 원/달러 환율: 1380.5 → "1,380.50원" */
export const fmtFxRate = (rate: number): string => {
  const n = fmtNum(rate, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return isEn() ? `₩${n}` : `${n}원`;
};

/**
 * 시세 기준일 문구. 해외(미국) ETF가 없으면 예전 그대로 "시세 기준일 …" 한 개만,
 * 있으면 국내·해외 기준일을 따로 적고(거래일·시차 때문에 다를 수 있다) 환산에 쓴 최신 환율을 덧붙인다.
 */
export function fmtAsOf(s: Pick<Snapshot, "asOf" | "asOfUs" | "fxUsdKrw">): string {
  if (!s.asOfUs) return tr(`시세 기준일 ${fmtDate(s.asOf)}`, `Prices as of ${fmtDate(s.asOf)}`);
  const differs = s.asOfUs !== s.asOf;
  const parts = [
    tr(`국내 시세 기준일 ${fmtDate(s.asOf)}`, `Korea-listed prices as of ${fmtDate(s.asOf)}`),
    tr(
      `해외(미국) 시세 기준일 ${fmtDate(s.asOfUs)}${differs ? "(국내와 다름)" : ""}`,
      `US-listed prices as of ${fmtDate(s.asOfUs)}${differs ? " (differs from Korea)" : ""}`,
    ),
  ];
  if (s.fxUsdKrw) parts.push(tr(`원/달러 환율 ${fmtFxRate(s.fxUsdKrw.rate)}(${fmtDate(s.fxUsdKrw.date)})`, `USD/KRW ${fmtFxRate(s.fxUsdKrw.rate)} (${fmtDate(s.fxUsdKrw.date)})`));
  return parts.join(" · ");
}
