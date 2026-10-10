/**
 * 야후 파이낸스(비공식 API) 클라이언트(Node 전용). 미국 상장 ETF의 일별 시세·분배금·환율(KRW=X)·펀드 정보를 가져온다.
 * naver.ts 와 같은 원칙이다: 공식 API가 아니라 형식이 바뀔 수 있으므로 응답 형식을 검증해서, 바뀌면 조용히 잘못된
 * 데이터를 만들지 않고 명확한 오류로 멈춘다. 파서는 네트워크 없이 테스트할 수 있게 순수 함수로 분리했다.
 */
import { HttpError, withRetry } from "./naver";

/** 브라우저 UA. 야후는 라이브러리 기본 UA 를 막는 일이 있다. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** 테스트에서 주입할 수 있는 fetch. 전역 fetch 가 그대로 대입된다. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * 야후에 없는 종목(HTTP 404 또는 본문 오류 코드 "Not Found"). 호출자가 실패가 아니라 "정보 없음"으로 다룬다.
 * HttpError 의 하위 클래스(404)로 두는 이유: withRetry 가 4xx 를 즉시 실패로 보기 때문이다. 별도 Error 로 만들면
 * 재시도 대상이 되어 없는 종목마다 지수 백오프(약 13초)를 기다린다.
 */
export class NotFoundError extends HttpError {
  constructor(readonly symbol: string) {
    super(404, `yahoo:${symbol}`);
    this.message = `야후 파이낸스에 ${symbol} 종목이 없습니다(404).`;
    this.name = "NotFoundError";
  }
}

export interface ChartData {
  symbol: string;
  /** 거래 통화(meta.currency). 응답에 없으면 null */
  currency: string | null;
  /** 거래소 이름(meta.fullExchangeName 우선, 예: "NYSEArca") */
  exchangeName: string | null;
  /** 거래소 시간대의 UTC 오프셋(초). 날짜 변환에 쓴 값 */
  gmtoffset: number;
  /** YYYYMMDD(거래소 현지 날짜), 오름차순. 종가·수정종가가 없는 행은 이미 제거됨 */
  dates: string[];
  /** 원시 종가(분할만 보정, 배당은 보정하지 않음) */
  close: number[];
  /** 수정종가(분할·배당 보정) — 총수익 계산용 */
  adjClose: number[];
  volume: number[];
  /** 분배금(배당). date 는 락일(YYYYMMDD) */
  dividends: { date: string; amount: number }[];
}

export interface FundInfo {
  symbol: string | null;
  /** "ETF" | "EQUITY"(신탁 등) 등 */
  quoteType: string | null;
  longName: string | null;
  /** price.exchangeName (예: "NYSEArca", "NasdaqGM", "Cboe US") */
  exchangeName: string | null;
  currency: string | null;
  /** 순자산(달러). 없으면 null */
  totalAssets: number | null;
  /** 총보수 — 야후 원문 그대로 소수(0.000945 = 0.0945%). % 로 바꾸는 것은 호출자 몫 */
  expenseRatio: number | null;
  /** 모닝스타 카테고리 */
  category: string | null;
  /** 운용사 그룹 */
  family: string | null;
  legalType: string | null;
}

// ───────── 순수 파서 ─────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
/** 비정상 응답은 본문을 읽지 않고 버린다(연결을 놓아 주기 위해). */
async function httpError(res: Response, url: string): Promise<HttpError> {
  await res.body?.cancel().catch(() => {});
  return new HttpError(res.status, url);
}
const bad = (what: string, why: string) => new Error(`야후 ${what} 응답 형식이 예상과 다릅니다(${why}). 엔드포인트가 바뀌었을 수 있습니다.`);

/** UTC 초 + 거래소 오프셋(초) → 거래소 현지 날짜 YYYYMMDD */
export function ymdFromUnix(unixSec: number, gmtoffset: number): string {
  return new Date((unixSec + gmtoffset) * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

function emptyChart(symbol: string, meta: Record<string, unknown> = {}): ChartData {
  return {
    symbol,
    currency: str(meta.currency),
    exchangeName: str(meta.fullExchangeName) ?? str(meta.exchangeName),
    gmtoffset: finite(meta.gmtoffset) ?? 0,
    dates: [],
    close: [],
    adjClose: [],
    volume: [],
    dividends: [],
  };
}

/**
 * chart v8 응답 → ChartData.
 * - 종가나 수정종가가 null 인 행은 제거한다(휴장·미완성 봉). 거래량이 null 이면 0 으로 둔다.
 * - 날짜는 타임스탬프 + meta.gmtoffset 으로 계산한 거래소 현지 날짜다(UTC 날짜로 바꾸면 거래일이 하루 밀린다).
 * - 같은 날짜가 두 번 나오면(마지막 봉이 장중 갱신분으로 한 번 더 오는 경우) 나중 값을 쓴다.
 * - 404/오류 코드 "Not Found" 는 NotFoundError, 요청 기간에 데이터가 없다는 응답은 빈 시계열.
 * @param requireAdjClose false 면 수정종가가 없을 때 종가를 쓴다(환율처럼 배당이 없는 자산용)
 */
export function parseChart(json: unknown, opts: { symbol?: string; requireAdjClose?: boolean } = {}): ChartData {
  const sym = opts.symbol ?? "?";
  const chart = isObj(json) && isObj(json.chart) ? json.chart : null;
  if (!chart) throw bad("차트", "chart 객체가 없음");
  if (isObj(chart.error)) {
    if (chart.error.code === "Not Found") throw new NotFoundError(sym);
    if (/Data doesn't exist/i.test(String(chart.error.description ?? ""))) return emptyChart(sym);
    throw new Error(`야후 차트 응답이 오류입니다(${String(chart.error.code)}: ${String(chart.error.description)}).`);
  }
  const result = Array.isArray(chart.result) ? chart.result[0] : undefined;
  if (!isObj(result) || !isObj(result.meta)) throw bad("차트", "result[0].meta 가 없음");
  const meta = result.meta;
  const gmtoffset = finite(meta.gmtoffset);
  if (gmtoffset === null) throw bad("차트", "meta.gmtoffset 이 숫자가 아님");
  const indicators = isObj(result.indicators) ? result.indicators : null;
  const quote = indicators && Array.isArray(indicators.quote) ? indicators.quote[0] : undefined;
  if (!isObj(quote)) throw bad("차트", "indicators.quote[0] 이 없음");

  const symbol = str(meta.symbol) ?? sym;
  const ts = result.timestamp;
  // 요청 기간에 거래일이 없으면 timestamp 와 가격 배열이 통째로 빠진다 — 형식 오류가 아니라 빈 시계열
  if (ts === undefined && !Array.isArray(quote.close)) return emptyChart(symbol, meta);
  if (!Array.isArray(ts)) throw bad("차트", "timestamp 가 배열이 아님");
  const n = ts.length;
  const closeArr = quote.close;
  const volArr = quote.volume;
  if (!Array.isArray(closeArr) || closeArr.length !== n) throw bad("차트", "close 길이가 timestamp 와 다름");
  if (!Array.isArray(volArr) || volArr.length !== n) throw bad("차트", "volume 길이가 timestamp 와 다름");
  let adjArr: unknown[] = closeArr;
  const adjBlock = indicators && Array.isArray(indicators.adjclose) ? indicators.adjclose[0] : undefined;
  if (isObj(adjBlock) && Array.isArray(adjBlock.adjclose)) {
    if (adjBlock.adjclose.length !== n) throw bad("차트", "adjclose 길이가 timestamp 와 다름");
    adjArr = adjBlock.adjclose;
  } else if (opts.requireAdjClose !== false) {
    throw bad("차트", "수정종가(adjclose)가 없음");
  }

  const out = emptyChart(symbol, meta);
  out.gmtoffset = gmtoffset;
  let prevTs = -Infinity;
  for (let i = 0; i < n; i++) {
    const t = finite(ts[i]);
    if (t === null) throw bad("차트", `timestamp[${i}] 가 숫자가 아님`);
    if (t < prevTs) throw bad("차트", "timestamp 가 오름차순이 아님");
    prevTs = t;
    const c = finite(closeArr[i]);
    // 수정종가를 요구하지 않는 자산(환율)은 수정종가만 비어 있어도 종가가 있으면 그 행을 살린다
    const a = c !== null && opts.requireAdjClose === false ? (finite(adjArr[i]) ?? c) : finite(adjArr[i]);
    if (c === null || a === null || c <= 0 || a <= 0) continue;
    const v = finite(volArr[i]);
    const d = ymdFromUnix(t, gmtoffset);
    const last = out.dates.length - 1;
    if (last >= 0 && out.dates[last] === d) {
      out.close[last] = c;
      out.adjClose[last] = a;
      out.volume[last] = v !== null && v > 0 ? v : 0;
      continue;
    }
    out.dates.push(d);
    out.close.push(c);
    out.adjClose.push(a);
    out.volume.push(v !== null && v > 0 ? v : 0);
  }

  const events = result.events;
  if (events !== undefined) {
    if (!isObj(events)) throw bad("차트", "events 가 객체가 아님");
    const divs = events.dividends;
    if (divs !== undefined) {
      if (!isObj(divs)) throw bad("차트", "events.dividends 가 객체가 아님");
      for (const [key, v] of Object.entries(divs)) {
        if (!isObj(v)) throw bad("차트", `dividends[${key}] 가 객체가 아님`);
        const amount = finite(v.amount);
        const when = finite(v.date) ?? Number(key);
        if (amount === null || amount <= 0 || !Number.isFinite(when)) continue;
        out.dividends.push({ date: ymdFromUnix(when, gmtoffset), amount });
      }
      out.dividends.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
    }
  }
  return out;
}

/**
 * quoteSummary(fundProfile·summaryDetail·price) 응답 → FundInfo.
 * 신탁 등 일부 종목은 fundProfile·totalAssets 가 없다 — 그 값들은 null 로 돌려주고 판단(제외)은 호출자가 한다.
 * 형식 오류와 구별하기 위해 price 모듈은 반드시 있어야 한다.
 */
export function parseFundInfo(json: unknown, symbol = "?"): FundInfo {
  const qs = isObj(json) && isObj(json.quoteSummary) ? json.quoteSummary : null;
  if (!qs) throw bad("펀드 정보", "quoteSummary 객체가 없음");
  if (isObj(qs.error)) {
    if (qs.error.code === "Not Found") throw new NotFoundError(symbol);
    throw new Error(`야후 펀드 정보 응답이 오류입니다(${String(qs.error.code)}: ${String(qs.error.description)}).`);
  }
  const r = Array.isArray(qs.result) ? qs.result[0] : undefined;
  if (!isObj(r)) throw bad("펀드 정보", "result[0] 이 없음");
  if (!isObj(r.price)) throw bad("펀드 정보", "price 모듈이 없음");
  const price = r.price;
  const fp = isObj(r.fundProfile) ? r.fundProfile : {};
  const fees = isObj(fp.feesExpensesInvestment) ? fp.feesExpensesInvestment : {};
  const sd = isObj(r.summaryDetail) ? r.summaryDetail : {};
  const raw = (o: unknown) => (isObj(o) ? finite(o.raw) : null);
  // 순보수(netExpenseRatio, 응답에 따라 netExpRatio)를 우선하고, 없으면 연차보고서 기준 보수를 쓴다. 음수는 값이 아니다.
  const fee = raw(fees.netExpenseRatio) ?? raw(fees.netExpRatio) ?? raw(fees.annualReportExpenseRatio);
  return {
    symbol: str(price.symbol),
    quoteType: str(price.quoteType),
    longName: str(price.longName) ?? str(price.shortName),
    exchangeName: str(price.exchangeName),
    currency: str(price.currency),
    totalAssets: raw(sd.totalAssets),
    expenseRatio: fee !== null && fee >= 0 ? fee : null,
    category: str(fp.categoryName),
    family: str(fp.family),
    legalType: str(fp.legalType),
  };
}

// ───────── HTTP 클라이언트 ─────────

export interface YahooClientOptions {
  fetch?: FetchLike;
  /** 재시도 횟수·기본 대기(ms). 테스트에서 대기를 줄일 때 쓴다 */
  retry?: { attempts?: number; baseMs?: number };
  timeoutMs?: number;
}

interface Session {
  cookie: string;
  crumb: string;
}

/** 쿠키에서 "이름=값" 만 남긴다(만료·도메인 같은 속성 제거) */
function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter((c) => c.includes("="))
    .join("; ");
}

/** 심볼을 경로에 넣는다. "KRW=X" 의 '=' 는 그대로 둔다. */
const pathSym = (symbol: string) => encodeURIComponent(symbol).replace(/%3D/gi, "=");

export class YahooClient {
  private readonly fetchFn: FetchLike;
  private readonly attempts: number;
  private readonly baseMs: number;
  private readonly timeoutMs: number;
  private current: Session | null = null;
  private opening: Promise<Session> | null = null;

  constructor(opts: YahooClientOptions = {}) {
    this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
    this.attempts = opts.retry?.attempts ?? 5;
    this.baseMs = opts.retry?.baseMs ?? 800;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private async http(url: string, headers: Record<string, string> = {}): Promise<Response> {
    return this.fetchFn(url, { headers: { "User-Agent": UA, ...headers }, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  /** 일시적 오류(429·5xx·네트워크)는 재시도하고, 그 밖의 비정상 상태 코드는 HttpError 로 즉시 실패한다. */
  private async getRetry<T>(url: string, headers: Record<string, string>, read: (res: Response) => Promise<T>): Promise<T> {
    return withRetry(
      async () => {
        const res = await this.http(url, headers);
        return read(res);
      },
      this.attempts,
      this.baseMs,
    );
  }

  /** 쿠키+crumb 세션. 동시에 여러 호출이 와도 한 번만 만든다. */
  async openSession(): Promise<void> {
    await this.session();
  }

  private session(): Promise<Session> {
    if (this.current) return Promise.resolve(this.current);
    this.opening ??= this.createSession()
      .then((s) => (this.current = s))
      .finally(() => {
        this.opening = null;
      });
    return this.opening;
  }

  private async createSession(): Promise<Session> {
    // ① fc.yahoo.com 은 404 가 정상이고 Set-Cookie 로 쿠키를 준다.
    const cookie = await this.getRetry("https://fc.yahoo.com", {}, async (res) => {
      if (res.status >= 500 || res.status === 429) throw await httpError(res, "https://fc.yahoo.com");
      await res.body?.cancel().catch(() => {});
      return cookieHeader(res.headers.getSetCookie());
    });
    if (!cookie) throw new Error("야후 세션 쿠키를 받지 못했습니다(fc.yahoo.com 이 Set-Cookie 를 주지 않음). 세션 방식이 바뀌었을 수 있습니다.");
    // ② 그 쿠키로 crumb 을 받는다.
    const url = "https://query1.finance.yahoo.com/v1/test/getcrumb";
    const crumb = await this.getRetry(url, { Cookie: cookie }, async (res) => {
      if (!res.ok) throw await httpError(res, url);
      return (await res.text()).trim();
    });
    if (!/^\S{3,64}$/.test(crumb) || crumb.startsWith("<")) throw new Error(`야후 crumb 응답이 예상과 다릅니다: "${crumb.slice(0, 60)}"`);
    return { cookie, crumb };
  }

  /**
   * 일별 시세와 분배금. 기간은 UTC 초 단위 [fromUnix, toUnix].
   * range=max 는 월 단위로 뭉개져 오므로 쓰지 않고 period1/period2 + interval=1d 를 쓴다. 세션이 필요 없다.
   */
  async fetchChart(symbol: string, fromUnix: number, toUnix: number, opts: { requireAdjClose?: boolean } = {}): Promise<ChartData> {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${pathSym(symbol)}` +
      `?period1=${Math.floor(fromUnix)}&period2=${Math.floor(toUnix)}&interval=1d&events=div`;
    const json = await this.getRetry(url, {}, async (res) => {
      if (res.status === 404) {
        await res.body?.cancel().catch(() => {});
        throw new NotFoundError(symbol);
      }
      // 기간에 데이터가 없으면 400 + 본문 설명으로 온다 — 파서가 빈 시계열로 처리하게 본문을 넘긴다
      if (res.status === 400) {
        const body: unknown = await res.json().catch(() => null);
        if (isObj(body) && isObj(body.chart) && isObj(body.chart.error) && /Data doesn't exist/i.test(String(body.chart.error.description ?? ""))) return body;
      }
      if (!res.ok) throw await httpError(res, url);
      return (await res.json()) as unknown;
    });
    return parseChart(json, { symbol, requireAdjClose: opts.requireAdjClose });
  }

  /** 순자산·보수·카테고리·운용사. 쿠키+crumb 가 필요하고, 401 이면 세션을 새로 만들어 한 번 다시 시도한다. */
  async fetchFundInfo(symbol: string): Promise<FundInfo> {
    for (let pass = 0; ; pass++) {
      const s = await this.session();
      const url =
        `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${pathSym(symbol)}` +
        `?modules=fundProfile,summaryDetail,price&crumb=${encodeURIComponent(s.crumb)}`;
      try {
        const json = await this.getRetry(url, { Cookie: s.cookie }, async (res) => {
          if (res.status === 404) {
            await res.body?.cancel().catch(() => {});
            throw new NotFoundError(symbol);
          }
          if (!res.ok) throw await httpError(res, url);
          return (await res.json()) as unknown;
        });
        return parseFundInfo(json, symbol);
      } catch (e) {
        if (e instanceof HttpError && e.status === 401 && pass === 0) {
          // 다른 호출이 이미 새 세션으로 바꿨으면 그대로 두고, 아니면 이 세션을 버린다
          if (this.current === s) this.current = null;
          continue;
        }
        throw e;
      }
    }
  }
}

let shared: YahooClient | null = null;
const sharedClient = () => (shared ??= new YahooClient());

/** 모듈 공용 클라이언트(전역 fetch)로 일별 시세를 받는다. 주입한 client 가 있으면 그것을 쓴다. */
export function fetchChart(symbol: string, fromUnix: number, toUnix: number, client: YahooClient = sharedClient()): Promise<ChartData> {
  return client.fetchChart(symbol, fromUnix, toUnix);
}

export function fetchFundInfo(symbol: string, client: YahooClient = sharedClient()): Promise<FundInfo> {
  return client.fetchFundInfo(symbol);
}
