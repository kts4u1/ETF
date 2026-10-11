/**
 * 장바구니 내보내기: 증권사 앱에서 종목을 찾을 코드 목록, 메모 앱에 붙일 요약 글, 스프레드시트용 CSV.
 * 순수 함수라 현재 언어(tr)만 따른다. 수치는 화면과 같은 서식 함수를 쓰고, 해외(미국) ETF 는 원화 환산값임을 밝힌다.
 */
import type { BasketItem } from "./basket";
import { fmtDate, fmtFee, fmtRatio, priceParts } from "./format";
import { tr } from "./i18n";
import { isOverseas, marketOf, MARKET_SHORT } from "./market";
import { aumFundNote, aumText } from "./market-view";
import { mddOf } from "./scoring";
import type { EtfRecord } from "./types";

/** 담긴 항목과 현재 데이터의 ETF(데이터에서 사라졌으면 null) */
export interface BasketRow {
  item: BasketItem;
  etf: EtfRecord | null;
}

/** 증권사 앱 검색용: 한 줄에 코드 하나 */
export const toCodeList = (rows: readonly BasketRow[]): string => rows.map((r) => r.item.code).join("\n");

const numOrDash = (v: number | null | undefined, digits: number): string => (v === null || v === undefined || !Number.isFinite(v) ? "" : v.toFixed(digits));

/**
 * 메모 앱에 붙이는 요약 글. "이름 (코드)" 줄 + 지표 줄(↳) + 메모 줄(↳)이 한 종목이다.
 * 가져오기(parseCodeText)가 이 글을 다시 읽을 수 있도록, 코드를 이름 바로 뒤 괄호에 두고 나머지는 "↳" 로 시작하는 줄에 둔다.
 */
export function toSummaryText(rows: readonly BasketRow[], meta: { asOf: string; asOfUs?: string }): string {
  const dates = meta.asOfUs && meta.asOfUs !== meta.asOf
    ? tr(`국내 ${fmtDate(meta.asOf)} · 해외 ${fmtDate(meta.asOfUs)} 기준`, `Korea ${fmtDate(meta.asOf)} · US ${fmtDate(meta.asOfUs)}`)
    : tr(`${fmtDate(meta.asOf)} 기준`, `as of ${fmtDate(meta.asOf)}`);
  const lines: string[] = [tr(`[ETF 장바구니] ${rows.length}개 · ${dates} 종가(실시간 시세 아님)`, `[ETF Basket] ${rows.length} ETFs · ${dates}, closing prices (not real-time)`)];
  rows.forEach((r, i) => {
    const { item, etf } = r;
    lines.push(`${i + 1}. ${etf?.name ?? item.name} (${item.code})`);
    if (!etf) {
      lines.push(`   ↳ ${tr("현재 데이터에 없음(상장폐지되었거나 수집 기준 밖일 수 있음)", "Not in the current data (may be delisted or outside the collection criteria)")}`);
    } else {
      const p = priceParts(etf);
      const price = p.sub ? `${p.main} (${p.sub})` : p.main;
      lines.push(
        `   ↳ ${MARKET_SHORT[marketOf(etf)]} · ${price} · ${tr("1년", "1Y")} ${fmtRatio(etf.m.ret.y1, 1, true)} · ${tr("3년 연평균", "3Y CAGR")} ${fmtRatio(etf.m.cagr3y, 1, true)} · ${tr("최대낙폭", "Max DD")} ${fmtRatio(mddOf(etf), 0)} · ${tr("총보수", "Fee")} ${fmtFee(etf.fee)} · ${tr("순자산", "AUM")} ${aumText(etf)}`,
      );
    }
    if (item.note) lines.push(`   ↳ ${tr("메모", "Note")}: ${item.note.replace(/\s*\n\s*/g, " ")}`);
  });
  if (rows.some((r) => r.etf && isOverseas(r.etf))) {
    lines.push("", tr("※ 해외(미국) ETF 의 순자산·수익률·괄호 안 금액은 원화 환산값입니다(달러 가격 × 같은 날 원/달러 환율).", "* For US-listed ETFs, net assets, returns and the amount in parentheses are KRW-converted (USD price × same-day USD/KRW rate)."));
  }
  if (rows.some((r) => r.etf?.aumScope === "fund")) lines.push(`† ${aumFundNote().replace(/^†\s*/, "")}`);
  lines.push(tr("※ 과거 데이터이며 미래 수익을 보장하지 않습니다. 매매 전에 증권사 앱에서 현재가를 확인하세요. 투자 판단의 책임은 본인에게 있습니다.", "* Past data does not guarantee future returns. Check the current price in your brokerage app before trading. Investment decisions are your own responsibility."));
  return lines.join("\n");
}

/** CSV 한 칸: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싼다. 스프레드시트가 수식으로 실행하지 않게 = + - @ 로 시작하면 앞에 ' 를 붙인다 */
export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 엑셀이 숫자로 읽어 망가뜨리는 코드(069500 → 69500, 0219E0 → 지수 표기)는 ="069500" 로 써서 텍스트로 열리게 한다(널리 쓰는 방식).
 * 다시 가져올 때는 parseCodeText 가 이 표기를 벗긴다. 영문 티커와 망가지지 않는 코드는 그대로 둔다.
 */
export const excelCode = (code: string): string => (/^0\d+$|^\d+E\d+$/i.test(code) ? `="${code}"` : code);

/**
 * 스프레드시트용 CSV(맨 앞에 BOM 을 붙여 엑셀에서 한글이 깨지지 않게 한다). 열 이름은 언어와 무관하게 영어로 고정해 가져오기·재가공이 쉽다.
 * 수익률·낙폭은 비율(0.123 = 12.3%), 총보수는 % 단위, 순자산은 억원, 가격은 원(해외는 원화 환산) + 현지 가격·통화를 따로.
 */
export function toCsv(rows: readonly BasketRow[], meta: { asOf: string; asOfUs?: string }): string {
  const head = ["code", "name", "market", "exchange", "price_krw", "price_local", "currency", "return_1y", "cagr_3y", "max_drawdown", "expense_ratio_pct", "net_assets_eok_krw", "net_assets_fund_level", "asof", "added", "note"];
  /** 첫 칸(코드)만 엑셀용 텍스트 표기를 그대로 쓰고, 나머지는 모두 csvCell 로(메모 속 = 로 시작하는 글이 수식이 되지 않게) */
  const line = (code: string, rest: Array<string | number | null>): string => [excelCode(code), ...rest.map(csvCell)].join(",");
  const out = [head.join(",")];
  for (const { item, etf } of rows) {
    if (!etf) {
      out.push(line(item.code, [item.name, "", "", "", "", "", "", "", "", "", "", "", "", item.addedAt, item.note]));
      continue;
    }
    const us = isOverseas(etf);
    out.push(
      line(item.code, [
        etf.name,
        marketOf(etf),
        etf.exchange ?? "",
        Math.round(etf.price),
        us && etf.priceNative != null ? numOrDash(etf.priceNative, 2) : Math.round(etf.price),
        us ? "USD" : "KRW",
        numOrDash(etf.m.ret.y1, 4),
        numOrDash(etf.m.cagr3y, 4),
        numOrDash(mddOf(etf), 4),
        numOrDash(etf.fee, 4),
        Math.round(etf.aumEok),
        etf.aumScope === "fund" ? "Y" : "",
        us ? (meta.asOfUs ?? meta.asOf) : meta.asOf,
        item.addedAt,
        item.note,
      ]),
    );
  }
  return `\uFEFF${out.join("\r\n")}\r\n`;
}
