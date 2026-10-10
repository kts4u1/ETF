import { describe, expect, it } from "vitest";
import { HttpError } from "./naver";
import { NotFoundError, YahooClient, fetchChart, fetchFundInfo, parseChart, parseFundInfo, ymdFromUnix, type FetchLike } from "./yahoo";

const utc = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h, min) / 1000;

interface ChartArgs {
  ts: number[];
  close: (number | null)[];
  adj?: (number | null)[] | null;
  vol?: (number | null)[];
  gmtoffset?: number | null;
  events?: unknown;
}

/** 야후 chart v8 응답과 같은 모양의 작은 JSON. adj 를 null 로 주면 adjclose 블록 자체를 뺀다. */
function chartJson(a: ChartArgs) {
  const indicators: Record<string, unknown> = { quote: [{ close: a.close, volume: a.vol ?? a.close.map(() => 1000) }] };
  if (a.adj !== null) indicators.adjclose = [{ adjclose: a.adj ?? a.close }];
  const meta: Record<string, unknown> = { currency: "USD", symbol: "SPY", exchangeName: "PCX", fullExchangeName: "NYSEArca" };
  if (a.gmtoffset !== null) meta.gmtoffset = a.gmtoffset ?? -14400;
  return { chart: { result: [{ meta, timestamp: a.ts, ...(a.events === undefined ? {} : { events: a.events }), indicators }], error: null } };
}

describe("ymdFromUnix: 타임스탬프 + gmtoffset 으로 거래소 현지 날짜", () => {
  it("UTC 날짜와 현지 날짜가 다른 경계를 현지 기준으로 계산한다", () => {
    // 도쿄(+9h): UTC 10/9 23:30 은 현지 10/10 08:30
    expect(ymdFromUnix(utc(2026, 10, 9, 23, 30), 32_400)).toBe("20261010");
    // 뉴욕(-4h): UTC 10/10 02:00 은 현지 10/9 22:00
    expect(ymdFromUnix(utc(2026, 10, 10, 2, 0), -14_400)).toBe("20261009");
    // 미국 정규장 시작(UTC 13:30, -4h = 09:30)은 같은 날
    expect(ymdFromUnix(utc(2026, 10, 9, 13, 30), -14_400)).toBe("20261009");
  });
});

describe("parseChart", () => {
  const ts = [utc(2026, 10, 7, 13, 30), utc(2026, 10, 8, 13, 30), utc(2026, 10, 9, 13, 30)];

  it("정상 응답: 날짜·종가·수정종가·거래량·분배금을 읽는다", () => {
    const json = chartJson({
      ts,
      close: [777.22, 773.93, 778.57],
      adj: [775.5, 772.2, 778.57],
      vol: [40_431_100, 22_596_500, 18_000_000],
      events: { dividends: { [ts[0] as number]: { amount: 1.889, date: ts[0] } } },
    });
    const c = parseChart(json, { symbol: "SPY" });
    expect(c.symbol).toBe("SPY");
    expect(c.currency).toBe("USD");
    expect(c.exchangeName).toBe("NYSEArca"); // fullExchangeName 을 쓴다(exchangeName 은 "PCX")
    expect(c.gmtoffset).toBe(-14_400);
    expect(c.dates).toEqual(["20261007", "20261008", "20261009"]);
    expect(c.close).toEqual([777.22, 773.93, 778.57]);
    expect(c.adjClose).toEqual([775.5, 772.2, 778.57]);
    expect(c.volume).toEqual([40_431_100, 22_596_500, 18_000_000]);
    expect(c.dividends).toEqual([{ date: "20261007", amount: 1.889 }]);
  });

  it("종가·수정종가가 null 이거나 0 이하인 행은 버리고, 거래량 null 은 0 으로 둔다", () => {
    const t = [1, 2, 3, 4, 5].map((i) => utc(2026, 10, i + 4, 13, 30)); // 10/5 ~ 10/9
    const c = parseChart(chartJson({ ts: t, close: [10, null, 12, 13, 0], adj: [10, 11, null, 13, 0], vol: [100, 100, 100, null, 100] }));
    expect(c.dates).toEqual(["20261005", "20261008"]);
    expect(c.close).toEqual([10, 13]);
    expect(c.volume).toEqual([100, 0]);
  });

  it("같은 날짜의 봉이 두 번 오면(장중 갱신) 나중 값을 쓴다", () => {
    const t = [utc(2026, 10, 8, 13, 30), utc(2026, 10, 9, 13, 30), utc(2026, 10, 9, 19, 59)];
    const c = parseChart(chartJson({ ts: t, close: [10, 11, 11.5] }));
    expect(c.dates).toEqual(["20261008", "20261009"]);
    expect(c.close).toEqual([10, 11.5]);
  });

  it("gmtoffset 으로 날짜를 계산한다(환율 KRW=X: UTC 00:00 + 1h 는 같은 날, 도쿄 거래소는 하루 앞)", () => {
    const fx = parseChart(chartJson({ ts: [utc(2026, 10, 8), utc(2026, 10, 9)], close: [1339, 1343], gmtoffset: 3600 }), { requireAdjClose: false, symbol: "KRW=X" });
    expect(fx.dates).toEqual(["20261008", "20261009"]);
    const tokyo = parseChart(chartJson({ ts: [utc(2026, 10, 8, 23, 30)], close: [100], gmtoffset: 32_400 }));
    expect(tokyo.dates).toEqual(["20261009"]); // UTC 날짜(10/8)가 아니라 현지 날짜
  });

  it("수정종가가 없는 응답: 기본은 오류, requireAdjClose=false 면 종가로 대체(환율용)", () => {
    const json = chartJson({ ts, close: [1, 2, 3], adj: null });
    expect(() => parseChart(json)).toThrow(/수정종가/);
    const c = parseChart(json, { requireAdjClose: false });
    expect(c.adjClose).toEqual([1, 2, 3]);
  });

  it("requireAdjClose=false 이면 수정종가만 비어 있는 행도 종가로 살린다", () => {
    const c = parseChart(chartJson({ ts, close: [1, 2, 3], adj: [1, null, 3] }), { requireAdjClose: false });
    expect(c.dates).toHaveLength(3);
    expect(c.adjClose).toEqual([1, 2, 3]);
  });

  it("분배금: 금액이 0 이하이거나 숫자가 아닌 항목은 버리고 날짜순으로 정렬한다", () => {
    const e = {
      dividends: {
        b: { amount: 0.5, date: utc(2026, 9, 18, 13, 30) },
        a: { amount: 0.4, date: utc(2026, 6, 20, 13, 30) },
        z: { amount: 0, date: utc(2026, 3, 20, 13, 30) },
        n: { amount: "x", date: utc(2026, 1, 20, 13, 30) },
      },
    };
    const c = parseChart(chartJson({ ts, close: [1, 2, 3], events: e }));
    expect(c.dividends).toEqual([
      { date: "20260620", amount: 0.4 },
      { date: "20260918", amount: 0.5 },
    ]);
  });

  it("요청 기간에 거래일이 없어 timestamp 와 가격 배열이 통째로 빠지면 빈 시계열", () => {
    const json = { chart: { result: [{ meta: { currency: "USD", symbol: "NEW", gmtoffset: -14_400 }, indicators: { quote: [{}], adjclose: [{}] } }], error: null } };
    const c = parseChart(json, { symbol: "NEW" });
    expect(c.dates).toEqual([]);
    expect(c.currency).toBe("USD");
  });

  it('본문 오류 "Data doesn\'t exist"(기간에 데이터 없음)는 빈 시계열', () => {
    const json = { chart: { result: null, error: { code: "Bad Request", description: "Data doesn't exist for startDate = 1, endDate = 2" } } };
    expect(parseChart(json, { symbol: "X" }).dates).toEqual([]);
  });

  it('404 응답 본문(code "Not Found")은 NotFoundError(HttpError 404)', () => {
    const json = { chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } };
    let err: unknown;
    try {
      parseChart(json, { symbol: "ZZZZQ" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as NotFoundError).symbol).toBe("ZZZZQ");
    expect((err as NotFoundError).status).toBe(404);
    expect((err as Error).message).toMatch(/ZZZZQ/);
  });

  it("그 밖의 오류 코드는 일반 오류로 멈춘다", () => {
    const json = { chart: { result: null, error: { code: "Too Many Requests", description: "slow down" } } };
    expect(() => parseChart(json)).toThrow(/Too Many Requests/);
  });

  describe("형식이 예상과 다르면 명확한 오류(조용히 틀린 데이터를 만들지 않는다)", () => {
    const good = () => chartJson({ ts, close: [1, 2, 3] });
    it("JSON 이 아닌 값·chart 객체 없음", () => {
      expect(() => parseChart(null)).toThrow(/형식이 예상과 다릅니다/);
      expect(() => parseChart("<html>")).toThrow(/chart 객체/);
      expect(() => parseChart({})).toThrow(/chart 객체/);
    });
    it("result 가 비었거나 meta 가 없음", () => {
      expect(() => parseChart({ chart: { result: [], error: null } })).toThrow(/meta/);
      expect(() => parseChart({ chart: { result: [{ timestamp: [] }], error: null } })).toThrow(/meta/);
    });
    it("gmtoffset 이 숫자가 아님(날짜를 계산할 수 없다)", () => {
      expect(() => parseChart(chartJson({ ts, close: [1, 2, 3], gmtoffset: null }))).toThrow(/gmtoffset/);
    });
    it("배열 길이가 timestamp 와 다름", () => {
      expect(() => parseChart(chartJson({ ts, close: [1, 2] }))).toThrow(/close 길이/);
      expect(() => parseChart(chartJson({ ts, close: [1, 2, 3], vol: [1] }))).toThrow(/volume 길이/);
      expect(() => parseChart(chartJson({ ts, close: [1, 2, 3], adj: [1, 2] }))).toThrow(/adjclose 길이/);
    });
    it("timestamp 가 배열이 아니거나 숫자가 아니거나 오름차순이 아님", () => {
      const j = good() as { chart: { result: { timestamp: unknown }[] } };
      j.chart.result[0]!.timestamp = "x";
      expect(() => parseChart(j)).toThrow(/timestamp/);
      expect(() => parseChart(chartJson({ ts: [ts[0] as number, NaN, ts[2] as number], close: [1, 2, 3] }))).toThrow(/timestamp\[1\]/);
      expect(() => parseChart(chartJson({ ts: [ts[2] as number, ts[1] as number, ts[0] as number], close: [1, 2, 3] }))).toThrow(/오름차순/);
    });
    it("indicators.quote 가 없음", () => {
      expect(() => parseChart({ chart: { result: [{ meta: { gmtoffset: 0 }, timestamp: [1], indicators: {} }], error: null } })).toThrow(/quote/);
    });
    it("events 가 객체가 아님", () => {
      expect(() => parseChart(chartJson({ ts, close: [1, 2, 3], events: [] }))).toThrow(/events/);
      expect(() => parseChart(chartJson({ ts, close: [1, 2, 3], events: { dividends: { a: 5 } } }))).toThrow(/dividends/);
    });
  });
});

describe("parseFundInfo", () => {
  const spy = {
    quoteSummary: {
      error: null,
      result: [
        {
          price: { symbol: "SPY", quoteType: "ETF", longName: "State Street SPDR S&P 500 ETF Trust", exchangeName: "NYSEArca", currency: "USD" },
          summaryDetail: { totalAssets: { raw: 809_216_114_688, fmt: "809.22B" } },
          fundProfile: {
            categoryName: "Large Blend",
            family: "State Street Investment Management",
            legalType: "Exchange Traded Fund",
            feesExpensesInvestment: { annualReportExpenseRatio: { raw: 0.000945, fmt: "0.09%" }, netExpRatio: {} },
          },
        },
      ],
    },
  };
  const withFees = (fees: unknown) => ({
    quoteSummary: { error: null, result: [{ ...spy.quoteSummary.result[0], fundProfile: { ...spy.quoteSummary.result[0]!.fundProfile, feesExpensesInvestment: fees } }] },
  });

  it("정상 응답: 순자산·보수(소수 그대로)·카테고리·운용사·거래소", () => {
    expect(parseFundInfo(spy, "SPY")).toEqual({
      symbol: "SPY",
      quoteType: "ETF",
      longName: "State Street SPDR S&P 500 ETF Trust",
      exchangeName: "NYSEArca",
      currency: "USD",
      totalAssets: 809_216_114_688,
      expenseRatio: 0.000945, // 소수. %(0.0945)로 바꾸는 것은 호출자 몫이다
      category: "Large Blend",
      family: "State Street Investment Management",
      legalType: "Exchange Traded Fund",
    });
  });

  it("보수는 netExpenseRatio 를 우선하고 없으면 연차보고서 기준 보수를 쓴다", () => {
    expect(parseFundInfo(withFees({ netExpenseRatio: { raw: 0.0003 }, annualReportExpenseRatio: { raw: 0.0009 } })).expenseRatio).toBe(0.0003);
    expect(parseFundInfo(withFees({ netExpenseRatio: {}, annualReportExpenseRatio: { raw: 0.0009 } })).expenseRatio).toBe(0.0009);
    expect(parseFundInfo(withFees({})).expenseRatio).toBeNull();
    expect(parseFundInfo(withFees({ annualReportExpenseRatio: { raw: -0.1 } })).expenseRatio).toBeNull(); // 음수는 값이 아니다
  });

  it("신탁처럼 fundProfile·totalAssets 가 없는 종목도 오류가 아니라 null 로 돌려준다(제외 판단은 호출자)", () => {
    const trust = { quoteSummary: { error: null, result: [{ price: { symbol: "PSLV", quoteType: "EQUITY", shortName: "Sprott Physical Silver", exchangeName: "NYSEArca" } }] } };
    const i = parseFundInfo(trust, "PSLV");
    expect(i.quoteType).toBe("EQUITY");
    expect(i.longName).toBe("Sprott Physical Silver");
    expect(i.totalAssets).toBeNull();
    expect(i.expenseRatio).toBeNull();
    expect(i.category).toBeNull();
    expect(i.family).toBeNull();
  });

  it("없는 종목은 NotFoundError, 그 밖의 오류 코드는 일반 오류", () => {
    expect(() => parseFundInfo({ quoteSummary: { result: null, error: { code: "Not Found", description: "Quote not found" } } }, "ZZZZQ")).toThrow(NotFoundError);
    expect(() => parseFundInfo({ quoteSummary: { result: null, error: { code: "Unauthorized", description: "Invalid Crumb" } } })).toThrow(/Unauthorized/);
  });

  it("형식이 다르면 명확한 오류: quoteSummary·result·price 모듈 누락", () => {
    expect(() => parseFundInfo({})).toThrow(/quoteSummary/);
    expect(() => parseFundInfo({ quoteSummary: { result: [], error: null } })).toThrow(/result/);
    expect(() => parseFundInfo({ quoteSummary: { result: [{ summaryDetail: {} }], error: null } })).toThrow(/price/);
  });
});

// ───────── 클라이언트: 주입한 fetch 로 세션·재시도 동작을 확인 ─────────

interface Call {
  url: string;
  cookie: string | undefined;
}

/** 야후 서버 흉내: 쿠키(fc.yahoo.com) → crumb → quoteSummary/chart. crumb 은 세션마다 다르다. */
function fakeYahoo(opts: { invalidCrumbs?: number; quoteStatuses?: number[]; chartBody?: () => unknown } = {}) {
  const calls: Call[] = [];
  let sessions = 0;
  let invalid = opts.invalidCrumbs ?? 0;
  const quoteStatuses = [...(opts.quoteStatuses ?? [])];
  let currentCrumb = "";
  const fetchFn: FetchLike = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, cookie: headers.Cookie });
    if (url.startsWith("https://fc.yahoo.com")) {
      sessions++;
      const h = new Headers();
      h.append("set-cookie", `A3=d=session${sessions}; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Domain=.yahoo.com`);
      h.append("set-cookie", `B=x${sessions}&b=3; Path=/`);
      return new Response("", { status: 404, headers: h });
    }
    if (url.includes("/v1/test/getcrumb")) {
      if (!headers.Cookie?.includes(`A3=d=session${sessions}`)) return new Response("Unauthorized", { status: 401 });
      currentCrumb = `crumb${sessions}`;
      return new Response(currentCrumb, { status: 200 });
    }
    if (url.includes("/quoteSummary/")) {
      const forced = quoteStatuses.shift();
      if (forced !== undefined && forced !== 200) return new Response("{}", { status: forced });
      if (invalid > 0) {
        invalid--;
        return new Response('{"finance":{"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}', { status: 401 });
      }
      if (!url.includes(`crumb=${currentCrumb}`)) return new Response("{}", { status: 401 });
      return Response.json({ quoteSummary: { error: null, result: [{ price: { symbol: "SPY", quoteType: "ETF" }, summaryDetail: { totalAssets: { raw: 5 } } }] } });
    }
    if (url.includes("/v8/finance/chart/")) {
      if (opts.chartBody) return opts.chartBody() as Response;
      return Response.json(chartJson({ ts: [utc(2026, 10, 9, 13, 30)], close: [10] }));
    }
    return new Response("", { status: 500 });
  };
  return { fetchFn, calls, sessions: () => sessions };
}

const fast = { attempts: 3, baseMs: 1 };

describe("YahooClient: 세션(쿠키+crumb)", () => {
  it("쿠키를 받아 crumb 을 요청하고, 펀드 정보 요청에 쿠키와 crumb 을 싣는다(쿠키는 이름=값만)", async () => {
    const y = fakeYahoo();
    const info = await new YahooClient({ fetch: y.fetchFn, retry: fast }).fetchFundInfo("SPY");
    expect(info.totalAssets).toBe(5);
    const crumbCall = y.calls.find((c) => c.url.includes("getcrumb"));
    expect(crumbCall?.cookie).toBe("A3=d=session1; B=x1&b=3");
    const q = y.calls.find((c) => c.url.includes("/quoteSummary/SPY"));
    expect(q?.url).toContain("crumb=crumb1");
    expect(q?.url).toContain("modules=fundProfile,summaryDetail,price");
    expect(q?.cookie).toBe("A3=d=session1; B=x1&b=3");
  });

  it("동시에 여러 종목을 물어도 세션은 한 번만 만든다", async () => {
    const y = fakeYahoo();
    const c = new YahooClient({ fetch: y.fetchFn, retry: fast });
    await Promise.all(["A", "B", "C", "D", "E", "F"].map((s) => c.fetchFundInfo(s)));
    expect(y.sessions()).toBe(1);
  });

  it("401(Invalid Crumb)이면 세션을 새로 만들고 다시 시도한다", async () => {
    const y = fakeYahoo({ invalidCrumbs: 1 });
    const info = await new YahooClient({ fetch: y.fetchFn, retry: fast }).fetchFundInfo("SPY");
    expect(info.symbol).toBe("SPY");
    expect(y.sessions()).toBe(2);
    expect(y.calls.filter((c) => c.url.includes("/quoteSummary/")).at(-1)?.url).toContain("crumb=crumb2");
  });

  it("동시에 여러 호출이 401 을 받아도 새 세션은 한 번만 만든다", async () => {
    const y = fakeYahoo({ invalidCrumbs: 4 });
    const c = new YahooClient({ fetch: y.fetchFn, retry: fast });
    await c.openSession();
    const r = await Promise.all(["A", "B", "C", "D"].map((s) => c.fetchFundInfo(s)));
    expect(r).toHaveLength(4);
    expect(y.sessions()).toBe(2);
  });

  it("세션을 새로 만들어도 401 이면 무한 반복하지 않고 HttpError 401 로 끝낸다", async () => {
    const y = fakeYahoo({ invalidCrumbs: 99 });
    await expect(new YahooClient({ fetch: y.fetchFn, retry: fast }).fetchFundInfo("SPY")).rejects.toMatchObject({ status: 401 });
    expect(y.sessions()).toBe(2);
  });

  it("쿠키를 주지 않으면 명확한 오류", async () => {
    const f: FetchLike = async () => new Response("", { status: 404 });
    await expect(new YahooClient({ fetch: f, retry: fast }).openSession()).rejects.toThrow(/쿠키/);
  });

  it("crumb 응답이 HTML 이면 오류", async () => {
    const f: FetchLike = async (url) => {
      if (url.startsWith("https://fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=x; Path=/" } });
      return new Response("<html>blocked</html>", { status: 200 });
    };
    await expect(new YahooClient({ fetch: f, retry: fast }).openSession()).rejects.toThrow(/crumb/);
  });
});

describe("YahooClient: 재시도와 404", () => {
  it("없는 종목(404)은 NotFoundError 이고 재시도하지 않는다", async () => {
    let n = 0;
    const f: FetchLike = async () => {
      n++;
      return Response.json({ chart: { result: null, error: { code: "Not Found" } } }, { status: 404 });
    };
    const t0 = Date.now();
    await expect(new YahooClient({ fetch: f, retry: { attempts: 5, baseMs: 500 } }).fetchChart("ZZZZQ", 1, 2)).rejects.toBeInstanceOf(NotFoundError);
    expect(n).toBe(1);
    expect(Date.now() - t0).toBeLessThan(400); // 재시도했다면 백오프로 0.5초 이상 걸린다
  });

  it("펀드 정보의 404 도 NotFoundError 이고 재시도하지 않는다", async () => {
    const y = fakeYahoo({ quoteStatuses: [404] });
    await expect(new YahooClient({ fetch: y.fetchFn, retry: { attempts: 5, baseMs: 500 } }).fetchFundInfo("ZZZZQ")).rejects.toBeInstanceOf(NotFoundError);
    expect(y.calls.filter((c) => c.url.includes("/quoteSummary/"))).toHaveLength(1);
  });

  it("429·5xx 는 재시도해서 성공한다", async () => {
    let n = 0;
    const f: FetchLike = async () => {
      n++;
      if (n === 1) return new Response("", { status: 429 });
      if (n === 2) return new Response("", { status: 503 });
      return Response.json(chartJson({ ts: [utc(2026, 10, 9, 13, 30)], close: [10] }));
    };
    const c = await new YahooClient({ fetch: f, retry: fast }).fetchChart("SPY", 1, 2);
    expect(c.close).toEqual([10]);
    expect(n).toBe(3);
  });

  it("그 밖의 4xx(403)는 즉시 HttpError", async () => {
    let n = 0;
    const f: FetchLike = async () => {
      n++;
      return new Response("", { status: 403 });
    };
    await expect(new YahooClient({ fetch: f, retry: fast }).fetchChart("SPY", 1, 2)).rejects.toMatchObject({ status: 403 });
    expect(n).toBe(1);
  });

  it("기간에 데이터가 없을 때의 400 은 오류가 아니라 빈 시계열", async () => {
    const f: FetchLike = async () => Response.json({ chart: { result: null, error: { code: "Bad Request", description: "Data doesn't exist for startDate = 1, endDate = 2" } } }, { status: 400 });
    const c = await new YahooClient({ fetch: f, retry: fast }).fetchChart("NEW", 1, 2);
    expect(c.dates).toEqual([]);
  });

  it("차트 요청: period1/period2 + interval=1d + 분배금 이벤트, range=max 는 쓰지 않고 세션도 만들지 않는다", async () => {
    const y = fakeYahoo();
    await new YahooClient({ fetch: y.fetchFn, retry: fast }).fetchChart("KRW=X", 1_700_000_000.9, 1_800_000_000, { requireAdjClose: false });
    expect(y.calls).toHaveLength(1);
    const u = y.calls[0]!.url;
    expect(u).toContain("/v8/finance/chart/KRW=X?");
    expect(u).toContain("period1=1700000000&period2=1800000000");
    expect(u).toContain("interval=1d");
    expect(u).toContain("events=div");
    expect(u).not.toContain("range=");
    expect(y.sessions()).toBe(0);
  });
});

describe("모듈 함수 fetchChart / fetchFundInfo: 주입한 클라이언트를 쓴다", () => {
  it("시세와 펀드 정보를 그 클라이언트의 fetch 로 받는다", async () => {
    const y = fakeYahoo();
    const client = new YahooClient({ fetch: y.fetchFn, retry: fast });
    expect((await fetchChart("SPY", 1, 2, client)).close).toEqual([10]);
    expect((await fetchFundInfo("SPY", client)).totalAssets).toBe(5);
    expect(y.calls.length).toBeGreaterThan(0);
  });
});
