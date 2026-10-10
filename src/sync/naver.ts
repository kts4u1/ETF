/**
 * 네이버 금융에서 ETF 목록·상세·일별 시세를 가져오는 클라이언트(Node 전용).
 * 공식 API가 아니라 비공개 엔드포인트라 형식이 바뀔 수 있다. 응답 형식을 검증해서
 * 바뀌면 조용히 잘못된 데이터를 만들지 않고 명확한 오류로 멈춘다.
 */
import type { HoldingRow } from "../core/holdings";
import type { PriceSeries } from "../core/types";
import type { NaverTab } from "../core/taxonomy";

const UA = "Mozilla/5.0 (compatible; etf-picker/0.1; personal research)";

export interface ListItem {
  code: string;
  name: string;
  tab: NaverTab;
  price: number;
  changeRate: number | null;
  nav: number | null;
  /** 순자산총액 억원 */
  aumEok: number;
}

export interface Detail {
  issuer: string | null;
  fee: number | null;
  divYield: number | null;
  description: string;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status}: ${url}`);
  }
}

async function fetchBuffer(url: string, timeoutMs = 30_000): Promise<ArrayBuffer> {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new HttpError(res.status, url);
  return res.arrayBuffer();
}

/** 일시적 오류(5xx, 429, 네트워크)만 지수 백오프로 재시도한다. 4xx 는 즉시 실패. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 500): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retriable = !(e instanceof HttpError) || e.status >= 500 || e.status === 429;
      if (!retriable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i + Math.random() * 200));
    }
  }
  throw last;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function fetchEtfList(): Promise<ListItem[]> {
  const url = "https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc";
  const buf = await withRetry(() => fetchBuffer(url));
  // 이 엔드포인트는 EUC-KR 이다.
  const json = JSON.parse(new TextDecoder("euc-kr").decode(buf)) as {
    resultCode?: string;
    result?: { etfItemList?: Record<string, unknown>[] };
  };
  const rows = json.result?.etfItemList;
  if (json.resultCode !== "success" || !Array.isArray(rows) || rows.length < 100) {
    throw new Error("ETF 목록 응답 형식이 예상과 다릅니다(엔드포인트가 바뀌었을 수 있음).");
  }
  const out: ListItem[] = [];
  for (const r of rows) {
    const code = String(r.itemcode ?? "");
    const name = String(r.itemname ?? "");
    const tab = Number(r.etfTabCode);
    const price = num(r.nowVal);
    if (!/^[0-9A-Z]{6}$/.test(code) || !name || !(tab >= 1 && tab <= 7) || price === null) continue;
    out.push({
      code,
      name,
      tab: tab as NaverTab,
      price,
      changeRate: num(r.changeRate),
      nav: num(r.nav),
      aumEok: num(r.marketSum) ?? 0,
    });
  }
  return out;
}

export async function fetchDetail(code: string): Promise<Detail> {
  const url = `https://m.stock.naver.com/api/stock/${code}/integration`;
  const buf = await withRetry(() => fetchBuffer(url));
  const j = JSON.parse(new TextDecoder("utf-8").decode(buf)) as {
    description?: unknown;
    etfKeyIndicator?: { issuerName?: unknown; totalFee?: unknown; dividendYieldTtm?: unknown };
  };
  const k = j.etfKeyIndicator ?? {};
  const issuer = typeof k.issuerName === "string" ? k.issuerName.replace(/\(ETF\)$/, "").trim() : null;
  return {
    issuer: issuer || null,
    fee: num(k.totalFee),
    divYield: num(k.dividendYieldTtm),
    description: cleanDescription(typeof j.description === "string" ? j.description : ""),
  };
}

/**
 * 운용사 설명 정리: 원천 데이터에 섞인 줄바꿈 태그(<br>)를 공백으로 바꾸고, 공백을 정리한 뒤
 * 400자 이내로, 가능하면 문장 경계에서 자른다. 일반 태그를 모두 지우지 않는 이유는
 * "<코스피 200 미국채 혼합지수>"처럼 꺾쇠가 지수명의 일부인 경우가 있기 때문이다. 멱등(여러 번 적용해도 같은 결과).
 */
export function cleanDescription(text: string, max = 400): string {
  const t = text.replace(/<br\s*\/?>/gi, " ").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf("다."), cut.lastIndexOf(". "));
  return lastStop > max * 0.5 ? cut.slice(0, lastStop + (cut[lastStop] === "다" ? 2 : 1)) : cut.trimEnd() + "…";
}

/** 구성종목(PDF). 신규 상장 등으로 아직 공시가 없으면 빈 배열. */
export async function fetchHoldings(code: string): Promise<HoldingRow[]> {
  const url = `https://stock.naver.com/api/domestic/detail/${code}/ETFComponent`;
  let buf: ArrayBuffer;
  try {
    buf = await withRetry(() => fetchBuffer(url));
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return [];
    throw e;
  }
  return parseHoldings(JSON.parse(new TextDecoder("utf-8").decode(buf)));
}

export function parseHoldings(json: unknown): HoldingRow[] {
  if (!Array.isArray(json)) throw new Error("구성종목 응답 형식이 예상과 다릅니다(엔드포인트가 바뀌었을 수 있음).");
  const out: HoldingRow[] = [];
  for (const r of json as Record<string, unknown>[]) {
    const weight = Number(r.weight);
    const name = typeof r.componentName === "string" ? r.componentName.trim() : "";
    const id = String(r.componentIsinCode ?? r.componentItemCode ?? "");
    if (!id || !name || !Number.isFinite(weight)) continue;
    const item = r.componentItemCode;
    out.push({ id, code: typeof item === "string" && /^[0-9A-Z]{6}$/.test(item) ? item : null, name, weight });
  }
  return out;
}

/** 일별 시세(수정주가 기준). count 거래일치. */
export async function fetchPrices(code: string, count: number): Promise<PriceSeries> {
  const url = `https://fchart.stock.naver.com/sise.nhn?symbol=${code}&timeframe=day&count=${count}&requestType=0`;
  const buf = await withRetry(() => fetchBuffer(url, 60_000));
  return parsePriceXml(new TextDecoder("euc-kr").decode(buf));
}

export function parsePriceXml(xml: string): PriceSeries {
  const dates: string[] = [];
  const close: number[] = [];
  const volume: number[] = [];
  // data="날짜|시가|고가|저가|종가|거래량"
  const re = /<item data="(\d{8})\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)"/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    dates.push(m[1]!);
    close.push(Number(m[5]));
    volume.push(Number(m[6]));
  }
  return { dates, close, volume };
}
