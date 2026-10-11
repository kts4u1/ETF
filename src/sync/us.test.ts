import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { US_MIN_AUM_EOK, US_MIN_AVG_VALUE_WON } from "../core/market";
import type { Taxonomy } from "../core/types";
import { HttpError } from "./naver";
import {
  FX_MAX_CARRY_DAYS,
  assertFailureRate,
  assertFxFresh,
  aumEokFromUsd,
  avgTradedValueWon,
  buildFxTable,
  buildUsIndex,
  buildUsRecord,
  exchangeLabel,
  fetchNasdaqList,
  fxLatest,
  fxRateOn,
  hasFundLevelAum,
  isEtnName,
  parseNasdaqList,
  passesAum,
  passesLiquidity,
  syncUs,
  toKrwSeries,
  trailingDivYield,
  trimChart,
  type FxTable,
  type UsDeps,
} from "./us";
import { DAY, NOW, calDays, fxChart, info, makeDeps, usChart, weekdays } from "./us.fixtures";

// 분류 규칙은 다른 담당 영역이다 — 수집기가 올바른 입력을 넘기는지만 확인하도록 고정값을 돌려준다.
const classifyMock = vi.hoisted(() => vi.fn());
vi.mock("../core/taxonomy-us", () => ({ classifyUs: classifyMock }));
const TAX: Taxonomy = { assetClass: "global-equity", region: "US", theme: null, broad: true, tags: [], leverage: 1, brand: "Test", groupKey: "us:test" };

beforeEach(() => {
  classifyMock.mockReset();
  classifyMock.mockReturnValue(TAX);
});

// ───────── 나스닥 목록 ─────────

describe("parseNasdaqList", () => {
  const row = (symbol: unknown, companyName: unknown = "Some Fund") => ({ symbol, companyName });
  const wrap = (rows: unknown[]) => ({ data: { dataAsOf: "10/9/2026 8:00:00 PM", data: { rows } }, status: { rCode: 200 } });

  it("티커는 영문 대문자 1~5자만, 중복은 하나로, ETN 은 뺀다", () => {
    const r = parseNasdaqList(
      wrap([
        row("SPY", "SPDR S&P 500 ETF Trust"),
        row("SPY", "SPDR S&P 500 ETF Trust"), // 중복
        row("brk", "소문자"),
        row("BRK/B", "슬래시"),
        row("ABCDEF", "여섯 글자"),
        row("A1", "숫자"),
        row("", "빈 값"),
        row(" QQQ ", "공백은 다듬는다"),
        row("VXX", "iPath Series B S&P 500 VIX Short-Term Futures ETN"),
        row("DULL", "Bank Of Montreal MicroSectors Gold -3X Inverse Leveraged ETNs "),
        row("FLOT", "iShares Floating Rate Bond ETF"),
        row("Z", "한 글자도 허용"),
      ]),
      1,
    );
    expect(r.rows.map((x) => x.symbol)).toEqual(["SPY", "QQQ", "FLOT", "Z"]);
    expect(r.total).toBe(12);
    expect(r.badTicker).toBe(5);
    expect(r.etnExcluded).toBe(2);
    // 뺀 ETN 도 이름 색인에 쓰도록 티커·이름을 남긴다
    expect(r.etnRows?.map((x) => x.symbol)).toEqual(["VXX", "DULL"]);
    expect(r.dataAsOf).toBe("10/9/2026 8:00:00 PM");
  });

  it("단어 ETN/ETNs 만 ETN 으로 본다(Note·부분 문자열은 ETF)", () => {
    expect(isEtnName("iPath Bloomberg Commodity Index Total Return ETN")).toBe(true);
    expect(isEtnName("MicroSectors Gold -3X Inverse Leveraged ETNs")).toBe(true);
    expect(isEtnName("ETN")).toBe(true);
    expect(isEtnName("SPDR Bloomberg Floating Rate Note ETF")).toBe(false);
    expect(isEtnName("Netherlands Index ETF")).toBe(false);
    expect(isEtnName("RETNA Fund")).toBe(false);
  });

  it("행이 너무 적거나(잘린 응답) 구조가 다르면 오류", () => {
    expect(() => parseNasdaqList(wrap([row("SPY")]), 1000)).toThrow(/형식이 예상과 다릅니다/);
    expect(() => parseNasdaqList({}, 1)).toThrow(/형식이 예상과 다릅니다/);
    expect(() => parseNasdaqList({ data: { data: { rows: "x" } } }, 1)).toThrow(/형식이 예상과 다릅니다/);
    expect(() => parseNasdaqList(null, 1)).toThrow(/형식이 예상과 다릅니다/);
  });

  it("symbol 필드를 읽지 못하면(필드 이름이 바뀜) 빈 목록을 만들지 않고 오류", () => {
    expect(() => parseNasdaqList(wrap([{ ticker: "SPY" }, { ticker: "QQQ" }, { ticker: "IWM" }]), 1)).toThrow(/symbol/);
  });
});

describe("fetchNasdaqList", () => {
  /** 서로 다른 4글자 티커 n 개를 가진 나스닥 응답 */
  const payload = (n: number) => ({
    data: { dataAsOf: "10/9/2026", data: { rows: Array.from({ length: n }, (_, i) => ({ symbol: String.fromCharCode(65 + (i % 26), 65 + (Math.floor(i / 26) % 26), 65 + (Math.floor(i / 676) % 26), 65), companyName: `Fund ${i}` })) } },
  });
  const retry = { attempts: 3, baseMs: 1 };

  it("브라우저 UA 로 요청하고 응답을 파싱한다", async () => {
    let init: RequestInit | undefined;
    const r = await fetchNasdaqList(async (_u, i) => {
      init = i;
      return Response.json(payload(1200));
    }, retry);
    expect(r.rows).toHaveLength(1200);
    expect((init?.headers as Record<string, string>)["User-Agent"]).toContain("Mozilla/5.0");
  });

  it("일시적 오류(503)는 재시도하고, 403 은 즉시 HttpError", async () => {
    let n = 0;
    const flaky = async () => (++n < 2 ? new Response("", { status: 503 }) : Response.json(payload(1200)));
    await expect(fetchNasdaqList(flaky, retry)).resolves.toMatchObject({ total: 1200 });
    expect(n).toBe(2);

    n = 0;
    await expect(fetchNasdaqList(async () => (n++, new Response("", { status: 403 })), retry)).rejects.toMatchObject({ status: 403 });
    expect(n).toBe(1);
  });

  it("행이 너무 적은 응답(잘림·형식 변경)은 오류", async () => {
    await expect(fetchNasdaqList(async () => Response.json(payload(50)), retry)).rejects.toThrow(/형식이 예상과 다릅니다/);
  });
});

// ───────── 환율 ─────────

describe("환율표", () => {
  const ch = (dates: string[], close: number[]) => ({ dates, close });

  it("buildFxTable: 정상 값은 그대로, 비었으면 오류", () => {
    expect(buildFxTable(ch(["20261001", "20261002"], [1300, 1310]))).toEqual({ dates: ["20261001", "20261002"], rate: [1300, 1310] });
    expect(() => buildFxTable(ch([], []))).toThrow(/비어/);
  });

  it("상식 범위(500~3000원)를 벗어난 값이 하나라도 있으면 날짜와 값을 적어 중단한다(경계 값은 허용)", () => {
    expect(() => buildFxTable(ch(["20261001"], [500]))).not.toThrow();
    expect(() => buildFxTable(ch(["20261001"], [3000]))).not.toThrow();
    expect(() => buildFxTable(ch(["20261001", "20261002"], [1300, 499.99]))).toThrow(/20261002.*499\.99/);
    expect(() => buildFxTable(ch(["20261001"], [3000.01]))).toThrow(/3000\.01/);
    expect(() => buildFxTable(ch(["20261001"], [0.00075]))).toThrow(/상식 범위/); // 원/달러가 아니라 달러/원 으로 뒤집힌 값
    expect(() => buildFxTable(ch(["20261001"], [Number.NaN]))).toThrow(/상식 범위/);
  });

  const fx: FxTable = { dates: ["20261001", "20261002", "20261005"], rate: [1300, 1310, 1320] };

  it("fxRateOn: 그 날 값이 있으면 그 값, 없으면 직전 값을 이어 쓴다(주말·휴장)", () => {
    expect(fxRateOn(fx, "20261002")).toBe(1310);
    expect(fxRateOn(fx, "20261003")).toBe(1310); // 토요일 — 금요일 값 이월
    expect(fxRateOn(fx, "20261004")).toBe(1310);
    expect(fxRateOn(fx, "20261008")).toBe(1320);
  });

  it("fxRateOn: 6일까지는 이월하고 7일째부터는 null(낡은 환율로 가격을 만들지 않는다), 환율표보다 이른 날짜도 null", () => {
    expect(FX_MAX_CARRY_DAYS).toBe(7);
    expect(fxRateOn(fx, "20261011")).toBe(1320); // 마지막 값(10/5)에서 6일
    expect(fxRateOn(fx, "20261012")).toBeNull(); // 7일
    expect(fxRateOn(fx, "20261101")).toBeNull();
    expect(fxRateOn(fx, "20260930")).toBeNull();
  });

  it("fxLatest: 마지막 날짜와 값", () => {
    expect(fxLatest(fx)).toEqual({ rate: 1320, date: "20261005" });
  });

  it("assertFxFresh: 최신 환율이 현재보다 7일 이상 뒤처지면 중단", () => {
    const now = Date.UTC(2026, 9, 12, 12) / 1000;
    expect(() => assertFxFresh("20261006", now)).not.toThrow(); // 6일 전
    expect(() => assertFxFresh("20261005", now)).toThrow(/7일/);
    expect(() => assertFxFresh("20260901", now)).toThrow(/20260901/);
  });
});

describe("toKrwSeries: 달러 수정종가 × 같은 날짜 환율", () => {
  const usd = { dates: ["20261001", "20261002", "20261005"], adjClose: [50, 50, 50], volume: [100, 200, 300] };

  it("달러 가격이 그대로여도 환율이 1000 → 1100 이면 원화 가격은 +10%이고 거래량은 그대로", () => {
    const fx: FxTable = { dates: ["20261001", "20261002", "20261005"], rate: [1000, 1000, 1100] };
    const krw = toKrwSeries(usd, fx);
    expect(krw.close).toEqual([50_000, 50_000, 55_000]);
    expect((krw.close[2] as number) / (krw.close[1] as number) - 1).toBeCloseTo(0.1, 12);
    expect(krw.volume).toEqual([100, 200, 300]);
    expect(krw.dates).toEqual(usd.dates);
    expect(usd.adjClose).toEqual([50, 50, 50]); // 입력은 바뀌지 않는다
  });

  it("환율이 없는 날(주말 이월은 허용, 7일 이상 이월은 불허)의 행은 버린다", () => {
    const fx: FxTable = { dates: ["20261001"], rate: [1000] };
    const krw = toKrwSeries({ dates: ["20260920", "20261001", "20261005", "20261008", "20261009"], adjClose: [1, 2, 3, 4, 5], volume: [1, 1, 1, 1, 1] }, fx);
    // 9/20: 환율표보다 이른 날짜, 10/8: 7일 이월 → 버림
    expect(krw.dates).toEqual(["20261001", "20261005"]);
    expect(krw.close).toEqual([2000, 3000]);
  });
});

// ───────── 선별 기준 ─────────

describe("선별 기준 경계값", () => {
  /** 9/1~9/30 매일 1000원인 환율 */
  const flatFx: FxTable = { dates: calDays("20260901", 30), rate: calDays("20260901", 30).map(() => 1000) };
  /** 9/1 부터 n일치: 종가 100달러 → 하루 거래대금 = 100 × 거래량 × 1000원 */
  const flat = (n: number, vol: number) => ({ dates: calDays("20260901", n), close: calDays("20260901", n).map(() => 100), volume: calDays("20260901", n).map(() => vol) });

  it("평균 거래대금이 기준(10억원)과 같으면 통과, 1원이라도 모자라면 탈락", () => {
    expect(US_MIN_AVG_VALUE_WON).toBe(1e9);
    expect(avgTradedValueWon(flat(20, 10_000), flatFx)).toBe(1e9);
    expect(passesLiquidity(avgTradedValueWon(flat(20, 10_000), flatFx))).toBe(true);
    expect(passesLiquidity(avgTradedValueWon(flat(20, 9_999), flatFx))).toBe(false);
    expect(passesLiquidity(1e9 - 1)).toBe(false);
  });

  it("20거래일이 안 되면 null 이고 탈락(유동성을 증명할 수 없다)", () => {
    expect(avgTradedValueWon(flat(19, 1e9), flatFx)).toBeNull();
    expect(passesLiquidity(null)).toBe(false);
  });

  it("최근 20거래일만 평균한다(그 이전의 큰 거래량은 영향 없음)", () => {
    const c = flat(25, 10_000);
    for (let i = 0; i < 5; i++) c.volume[i] = 99_999_999;
    expect(avgTradedValueWon(c, flatFx)).toBe(1e9);
  });

  it("거래대금은 원시 종가 × 거래량 × 그날 환율이고, 환율을 구할 수 없는 날은 0 으로 세지 않고 건너뛴다", () => {
    // 8/27~9/25 30일. 환율: 8/27 한 번(1000원)과 9/10 이후 매일(2000원). 9/3~9/9 는 8/27 에서 7일 이상 이월 → 환율 없음
    const c = { dates: calDays("20260827", 30), close: calDays("20260827", 30).map(() => 100), volume: calDays("20260827", 30).map(() => 10_000) };
    const fx: FxTable = { dates: ["20260827", ...calDays("20260910", 16)], rate: [1000, ...calDays("20260910", 16).map(() => 2000)] };
    // 최근 20개 = 2000원인 날 16개 + 1000원인 날 4개(9/2, 9/1, 8/31, 8/30). 하루 거래대금 = 100 × 10,000 × 환율
    expect(avgTradedValueWon(c, fx)).toBe((16 * 2e9 + 4 * 1e9) / 20);
  });

  it("환율이 있는 날이 20일이 안 되면 null", () => {
    const fx: FxTable = { dates: ["20260901"], rate: [1000] }; // 9/1~9/7 만 환율 있음
    expect(avgTradedValueWon(flat(25, 10_000), fx)).toBeNull();
  });

  it("순자산 5,000억원 경계: 같으면 통과, 모자라면 탈락, 모르면 탈락", () => {
    expect(US_MIN_AUM_EOK).toBe(5000);
    expect(passesAum(5000)).toBe(true);
    expect(passesAum(4999.99)).toBe(false);
    expect(passesAum(null)).toBe(false);
  });

  it("달러 순자산 × 환율 ÷ 1억 = 억원 (예: 10억 달러 × 1,000원 = 10,000억원)", () => {
    expect(aumEokFromUsd(1e9, 1000)).toBe(10_000);
    expect(aumEokFromUsd(809_216_114_688, 1340)).toBeCloseTo(10_843_495.94, 1); // SPY: 약 1,084만 억원(1,084조원)
    // 경계: 5,000억원 = 3.846억 달러(환율 1,300원)
    expect(passesAum(aumEokFromUsd(384_615_385, 1300))).toBe(true);
    expect(passesAum(aumEokFromUsd(384_615_000, 1300))).toBe(false);
  });
});

describe("assertFailureRate: 종목별 실패가 허용 수(후보의 0.3% 와 2개 중 큰 쪽)를 넘으면 중단", () => {
  it("작은 후보에서는 2개까지 통과, 넘으면 중단", () => {
    expect(() => assertFailureRate("1차", 2, 20)).not.toThrow();
    expect(() => assertFailureRate("1차", 3, 20)).toThrow(/20개 중 3개/);
    expect(() => assertFailureRate("1차", 0, 0)).not.toThrow();
    expect(() => assertFailureRate("1차", 2, 5)).not.toThrow();
    expect(() => assertFailureRate("1차", 3, 5)).toThrow();
  });
  it("큰 후보에서는 0.3% 까지: 실제 규모(2,704개)에서 8개는 통과, 9개는 중단 — 429 로 36개가 실패한 첫 시도는 다시 시도한다", () => {
    expect(() => assertFailureRate("2차", 8, 2704)).not.toThrow();
    expect(() => assertFailureRate("2차", 9, 2704)).toThrow(/2704개 중 9개/);
    expect(() => assertFailureRate("2차", 36, 2704)).toThrow(/다시 실행/);
  });
});

// ───────── 레코드 생성 ─────────

describe("exchangeLabel", () => {
  it("야후 거래소 이름을 화면 표기로, 모르는 이름은 원문 그대로", () => {
    expect(exchangeLabel("NYSEArca")).toBe("NYSE Arca");
    for (const n of ["NasdaqGM", "NasdaqGS", "NasdaqCM"]) expect(exchangeLabel(n)).toBe("Nasdaq");
    expect(exchangeLabel("Cboe US")).toBe("Cboe BZX");
    expect(exchangeLabel("NYSE")).toBe("NYSE");
    expect(exchangeLabel("NYSE American")).toBe("NYSE American");
    expect(exchangeLabel("OTC Markets")).toBe("OTC Markets");
    expect(exchangeLabel(null)).toBeNull();
  });
});

describe("trailingDivYield: 최근 12개월 분배금 합 ÷ 최근 종가 × 100", () => {
  const dates = (first: string) => [first, "20261009"];

  it("12개월 안의 분배금만 더한다(정확히 12개월 전 날짜는 제외 — 월 분배 ETF 가 13번 잡히지 않게)", () => {
    const divs = [
      { date: "20251009", amount: 5 }, // 정확히 12개월 전: 제외
      { date: "20260115", amount: 0.4 },
      { date: "20260415", amount: 0.4 },
      { date: "20260715", amount: 0.4 },
      { date: "20260915", amount: 0.4 },
    ];
    expect(trailingDivYield({ dates: dates("20240102"), dividends: divs }, 100, "20261009")).toBe(1.6);
    expect(trailingDivYield({ dates: dates("20240102"), dividends: divs }, 80, "20261009")).toBe(2); // 종가로 나눈다
  });

  it("1년 이상 시세가 있는데 분배가 없으면 0, 시세가 1년에 못 미치면 null", () => {
    expect(trailingDivYield({ dates: dates("20240102"), dividends: [] }, 100, "20261009")).toBe(0);
    expect(trailingDivYield({ dates: dates("20251009"), dividends: [] }, 100, "20261009")).toBe(0); // 정확히 1년
    expect(trailingDivYield({ dates: dates("20251010"), dividends: [] }, 100, "20261009")).toBeNull();
    expect(trailingDivYield({ dates: [], dividends: [] }, 100, "20261009")).toBeNull();
  });

  it("소수 둘째 자리로 반올림", () => {
    expect(trailingDivYield({ dates: dates("20240102"), dividends: [{ date: "20260301", amount: 1 }] }, 30, "20261009")).toBe(3.33);
  });
});

describe("trimChart: 마지막 2000행만", () => {
  it("행이 많으면 뒤에서 자르고 분배금은 그대로, 적으면 그대로", () => {
    const c = usChart("X", NOW / 1000 - 3000 * DAY, NOW / 1000, { dividends: [{ date: "20200101", amount: 1 }] });
    expect(c.dates.length).toBeGreaterThan(2000);
    const t = trimChart(c);
    expect(t.dates).toHaveLength(2000);
    expect(t.close).toHaveLength(2000);
    expect(t.adjClose).toHaveLength(2000);
    expect(t.volume).toHaveLength(2000);
    expect(t.dates.at(-1)).toBe(c.dates.at(-1));
    expect(t.dividends).toEqual(c.dividends);
    expect(trimChart(c, 5000)).toBe(c);
  });
});

describe("펀드 전체 순자산(뱅가드)", () => {
  it("뱅가드 계열만 펀드 단위 순자산으로 표시한다", () => {
    expect(hasFundLevelAum("Vanguard")).toBe(true);
    expect(hasFundLevelAum("vanguard group")).toBe(true);
    expect(hasFundLevelAum("State Street Investment Management")).toBe(false);
    expect(hasFundLevelAum("Invesco")).toBe(false);
    expect(hasFundLevelAum(null)).toBe(false);
  });
  it("레코드: 뱅가드는 aumScope=fund, 그 밖에는 필드가 없다", () => {
    const nowSec = NOW / 1000;
    const from = nowSec - 600 * DAY;
    const chart = usChart("VTI", from, nowSec, { px: () => 100 });
    const fx: FxTable = { dates: weekdays(from - 40 * DAY, nowSec), rate: [] };
    fx.rate = fx.dates.map(() => 1300);
    const v = buildUsRecord({ symbol: "VTI", listName: "x", info: info({ totalAssets: 2e9, family: "Vanguard" }), chart, fx })!;
    const o = buildUsRecord({ symbol: "VTI", listName: "x", info: info({ totalAssets: 2e9, family: "Invesco" }), chart, fx })!;
    expect(v.etf.aumScope).toBe("fund");
    expect("aumScope" in o.etf).toBe(false);
  });
});

describe("buildUsRecord: 단위와 원화 환산", () => {
  const nowSec = NOW / 1000;
  const from = nowSec - 600 * DAY;

  it("레코드의 단위: price=원화(원시 종가 × 그날 환율), priceNative=USD, aumEok=억원(최신 환율), fee=%(×100), divYield=%", () => {
    const chart = usChart("SPY", from, nowSec, { px: () => 100, dividends: [{ date: "20260615", amount: 1.5 }, { date: "20260915", amount: 1.5 }] });
    // 마지막 거래일(10/9)의 환율 1300, 환율표의 최신 값(10/10)은 1250
    const fx: FxTable = { dates: [...weekdays(from - 40 * DAY, nowSec), "20261010"], rate: [] };
    fx.rate = fx.dates.map((d) => (d === "20261010" ? 1250 : 1300));
    const built = buildUsRecord({ symbol: "SPY", listName: "목록 이름", info: info({ longName: "State Street SPDR S&P 500 ETF Trust", totalAssets: 2e9, expenseRatio: 0.000945, category: "Large Blend", family: "State Street" }), chart, fx })!;
    const e = built.etf;
    expect(e.code).toBe("SPY");
    expect(e.name).toBe("State Street SPDR S&P 500 ETF Trust");
    expect(e.market).toBe("US");
    expect(e.exchange).toBe("NYSE Arca");
    expect(e.priceNative).toBe(100);
    expect(e.price).toBe(130_000); // 100달러 × 10/9 의 환율 1300
    expect(e.aumEok).toBe(25_000); // 20억 달러 × 최신 환율 1250 ÷ 1억
    expect(e.fee).toBe(0.0945); // 0.000945(소수) → 0.0945(%)
    expect(e.divYield).toBe(3); // (1.5+1.5) ÷ 100 × 100
    expect(e.changeRate).toBe(0); // 두 종가가 같음
    expect(e.navGap).toBeNull();
    expect(e.issuer).toBe("State Street");
    expect(e.category).toBe("Large Blend");
    expect(e.description).toBe("");
    expect(e.tax).toBe(TAX);
    expect(e.m.asOf).toBe("20261009");
    expect(built.series.dates.at(-1)).toBe("20261009");
  });

  it("분류기에는 티커·이름·카테고리·운용사·법적 형태를 넘긴다", () => {
    const chart = usChart("SPY", from, nowSec);
    const fx: FxTable = { dates: weekdays(from - 40 * DAY, nowSec), rate: weekdays(from - 40 * DAY, nowSec).map(() => 1300) };
    buildUsRecord({ symbol: "SPY", listName: "목록", info: info({ longName: null, category: null, family: null, legalType: "Grantor Trust" }), chart, fx });
    expect(classifyMock).toHaveBeenCalledWith({ symbol: "SPY", name: "목록", category: null, family: null, legalType: "Grantor Trust" }); // 이름은 야후에 없으면 목록 이름
  });

  it("등락률은 달러 원시 종가의 최근 두 값으로, 보수·카테고리가 없으면 null", () => {
    const chart = usChart("AAA", from, nowSec, { px: () => 100 });
    chart.close[chart.close.length - 1] = 102.5; // 직전 100 → 2.5%
    chart.adjClose[chart.adjClose.length - 1] = 102.5;
    const fx: FxTable = { dates: weekdays(from - 40 * DAY, nowSec), rate: weekdays(from - 40 * DAY, nowSec).map(() => 1300) };
    const e = buildUsRecord({ symbol: "AAA", listName: "A", info: info({ expenseRatio: null, category: null }), chart, fx })!.etf;
    expect(e.changeRate).toBe(2.5);
    expect(e.fee).toBeNull();
    expect(e.category).toBeNull();
  });

  it("달러 가격이 그대로여도 환율이 1000 → 1100 으로 오르면 1년 수익률이 +10% 로 나온다(지표를 원화 시계열로 계산)", () => {
    const chart = usChart("FLAT", from, nowSec, { px: () => 50 });
    const dates = weekdays(from - 40 * DAY, nowSec);
    const fx: FxTable = { dates, rate: dates.map((d) => (d < "20251101" ? 1000 : 1100)) };
    const e = buildUsRecord({ symbol: "FLAT", listName: "F", info: info(), chart, fx })!.etf;
    expect(e.m.ret.y1).toBeCloseTo(0.1, 4);
    expect(e.m.ret.m1).toBe(0); // 최근 한 달은 환율도 가격도 그대로
    expect(e.price).toBe(55_000);
    expect(e.priceNative).toBe(50);
    // 달러 기준이면 변화가 없는 상품이므로 낙폭도 환율 변동분만 반영된다
    expect(e.m.vol1y).not.toBeNull();
  });

  it("거래량은 원화 변환과 무관하게 그대로, 평균 거래대금(avgValue20)은 원화", () => {
    const chart = usChart("VOL", from, nowSec, { px: () => 100, vol: 1000 });
    const dates = weekdays(from - 40 * DAY, nowSec);
    const fx: FxTable = { dates, rate: dates.map(() => 1000) };
    const built = buildUsRecord({ symbol: "VOL", listName: "V", info: info(), chart, fx })!;
    expect(built.series.volume.every((v) => v === 1000)).toBe(true);
    expect(built.etf.m.avgValue20).toBe(100 * 1000 * 1000); // 달러 100 × 1000주 × 1000원
  });

  it("시세가 2행 미만이면 null", () => {
    const chart = trimChart(usChart("NEW", nowSec - 3 * DAY, nowSec), 1);
    expect(chart.dates).toHaveLength(1);
    const fx: FxTable = { dates: weekdays(nowSec - 30 * DAY, nowSec), rate: weekdays(nowSec - 30 * DAY, nowSec).map(() => 1300) };
    expect(buildUsRecord({ symbol: "NEW", listName: "N", info: info(), chart, fx })).toBeNull();
  });
});

// ───────── syncUs 통합(네트워크 계층 주입) ─────────

describe("syncUs", () => {
  let dir = "";
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sync-us-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = (deps: UsDeps, extra: Parameters<typeof syncUs>[0] = {}) => syncUs({ cacheDir: dir, nowMs: NOW, ...extra }, deps);

  it("3단계 선별을 거쳐 원화 환산 레코드와 시계열을 만든다", async () => {
    const symbols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III"];
    const { deps } = makeDeps(symbols, {
      AAA: { info: { totalAssets: 10e9 } }, // 130,000억원
      BBB: { shape: { vol: 100 } }, // 1차 탈락: 거래대금 1.3e7원
      CCC: { info: { totalAssets: 100e6 } }, // 2차 탈락: 1,300억원
      DDD: { chartNotFound: true }, // 야후에 없음
      EEE: { info: { longName: "Some Volatility ETN" } }, // 2차 탈락: ETN
      FFF: { info: { totalAssets: null } }, // 2차 탈락: 순자산 미상
      GGG: { shape: { lastNDays: 14 } }, // 1차 탈락: 20거래일 미만
      HHH: { info: { totalAssets: 5e9 } }, // 65,000억원
      III: { info: "notfound" }, // 펀드 정보 없음
    });
    const logs: string[] = [];
    const r = await run(deps, { log: (m) => logs.push(m) });

    expect(r.etfs.map((e) => e.code)).toEqual(["AAA", "HHH"]); // 순자산(원화) 내림차순
    expect(r.etfs.map((e) => e.aumEok)).toEqual([130_000, 65_000]);
    expect([...r.series.keys()].sort()).toEqual(["AAA", "HHH"]);
    expect(r.failed).toEqual([]);
    expect(r.asOfUs).toBe("20261009");
    expect(r.fx).toEqual({ rate: 1300, date: "20261010" });
    expect(r.stats).toEqual({
      listRows: 9,
      badTicker: 0,
      etnExcluded: 0,
      candidates: 9,
      quick: { notFound: 1, tooShort: 1, lowValue: 1, passed: 6, limitedTo: null },
      info: { notFound: 1, etn: 1, noAum: 1, lowAum: 1, passed: 2 },
      final: 2,
    });
    // 시계열은 원화(1300 × 달러 수정종가)이고, 최대 2000거래일
    const s = r.series.get("AAA")!;
    expect(s.dates).toHaveLength(2000);
    const aaa = r.etfs[0]!;
    expect(s.close.at(-1)).toBeCloseTo(aaa.priceNative! * 1300, 0); // 달러 수정종가 × 환율 1300
    expect(aaa.market).toBe("US");
    expect(aaa.price).toBe(Math.round(aaa.priceNative! * 1300));
    expect(logs.some((l) => l.includes("1차 필터"))).toBe(true);
    // 수집 기준을 못 넘은 종목은 사유와 함께 색인용으로 남는다(실패한 종목은 failed 에만 있고 여기에는 없다)
    const reasonOf = Object.fromEntries(r.notCollected.map((x) => [x.symbol, x.reason]));
    expect(reasonOf).toEqual({ BBB: "low-trading", CCC: "small-aum", DDD: "no-data", EEE: "etn", FFF: "no-aum", GGG: "short", III: "no-data" });
    // 수집된 종목과 색인은 서로 겹치지 않고 합치면 후보 전체다
    expect(r.etfs.length + r.notCollected.length).toBe(9);
    expect(logs.some((l) => l.includes("2차 필터"))).toBe(true);
    expect(logs.at(-1)).toContain("미국 ETF 2개");
  });

  it("캐시: .cache/yahoo 와 같은 구조(list·fx·quick·info·price)로 저장하고, 같은 날 다시 실행하면 네트워크를 쓰지 않는다", async () => {
    const symbols = ["AAA", "BBB"];
    const first = makeDeps(symbols, { BBB: { shape: { vol: 1 } } });
    await run(first.deps);
    for (const f of ["list.json", "fx.json", "quick/AAA.json", "quick/BBB.json", "info/AAA.json", "price/AAA.json"]) {
      const j = JSON.parse(await readFile(join(dir, f), "utf8")) as { fetchedOn: string };
      expect(j.fetchedOn).toMatch(/^\d{8}$/);
    }
    expect(first.n.chart).toContain("KRW=X");

    const second = makeDeps(symbols, {});
    const r = await run(second.deps);
    expect(second.n.list).toBe(0);
    expect(second.n.chart).toEqual([]);
    expect(second.n.info).toEqual([]);
    expect(r.etfs.map((e) => e.code)).toEqual(["AAA"]);

    const forced = makeDeps(symbols, {});
    await run(forced.deps, { force: true });
    expect(forced.n.list).toBe(1);
    expect(forced.n.chart).toContain("AAA");
  });

  it("limit: 1차 통과 종목 중 거래대금 상위 N개만 다음 단계로", async () => {
    const symbols = ["LOW", "MID", "TOP", "OK1"];
    const { deps, n } = makeDeps(symbols, { LOW: { shape: { vol: 20_000 } }, MID: { shape: { vol: 50_000 } }, TOP: { shape: { vol: 900_000 } }, OK1: { shape: { vol: 100_000 } } });
    const r = await run(deps, { limit: 2 });
    expect(n.info.sort()).toEqual(["OK1", "TOP"]);
    expect(r.stats.quick.passed).toBe(4);
    expect(r.stats.quick.limitedTo).toBe(2);
    expect(r.etfs.map((e) => e.code).sort()).toEqual(["OK1", "TOP"]);
  });

  it("야후 통화가 USD 가 아니면 환산할 수 없으므로 실패로 센다", async () => {
    const symbols = Array.from({ length: 20 }, (_, i) => `S${String.fromCharCode(65 + i)}`);
    const { deps } = makeDeps(symbols, { SA: { shape: { currency: "EUR" } } });
    const r = await run(deps);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toMatch(/^SA .*USD/);
    expect(r.etfs).toHaveLength(19);
  });

  describe("실패 정책", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `T${String.fromCharCode(65 + i)}`);

    it("목록 수집 실패는 즉시 중단하고 시세는 건드리지 않는다", async () => {
      const { deps, n } = makeDeps(twenty, {}, { fetchNasdaqList: async () => Promise.reject(new HttpError(403, "nasdaq")) });
      await expect(run(deps)).rejects.toThrow(/나스닥 ETF 목록/);
      expect(n.chart).toEqual([]);
    });

    it("환율 수집 실패(오류·상식 범위 밖·낡은 환율)는 즉시 중단한다", async () => {
      const base = makeDeps(twenty, {}).deps;
      const failing: UsDeps = { ...base, fetchChart: async (s, a, b, o) => (s === "KRW=X" ? Promise.reject(new HttpError(500, "fx")) : base.fetchChart(s, a, b, o)) };
      await expect(run(failing)).rejects.toThrow(/환율/);

      const absurd: UsDeps = { ...base, fetchChart: async (s, a, b, o) => (s === "KRW=X" ? fxChart(a, b, 13.4) : base.fetchChart(s, a, b, o)) };
      await expect(run(absurd)).rejects.toThrow(/상식 범위/);

      const stale: UsDeps = { ...base, fetchChart: async (s, a, b, o) => (s === "KRW=X" ? fxChart(a, b - 20 * DAY) : base.fetchChart(s, a, b, o)) };
      await expect(run(stale)).rejects.toThrow(/환율.*앞서/);
    });

    it("범위를 벗어난 환율은 캐시에 남기지 않는다", async () => {
      const base = makeDeps(twenty, {}).deps;
      const absurd: UsDeps = { ...base, fetchChart: async (s, a, b, o) => (s === "KRW=X" ? fxChart(a, b, 13.4) : base.fetchChart(s, a, b, o)) };
      await expect(run(absurd)).rejects.toThrow();
      await expect(readFile(join(dir, "fx.json"), "utf8")).rejects.toThrow();
    });

    it("야후 세션 실패는 시세 수집 전에 중단한다", async () => {
      const { deps, n } = makeDeps(twenty, {}, { openSession: async () => Promise.reject(new Error("쿠키 없음")) });
      await expect(run(deps)).rejects.toThrow(/세션/);
      expect(n.chart.filter((s) => s !== "KRW=X")).toEqual([]);
    });

    it("1차: 실패가 허용 수 이내면 failed 에 모으고 계속, 넘으면 중단(없는 종목 404 는 실패가 아님)", async () => {
      const ok = makeDeps(twenty, { TA: { chartError: "quick" }, TB: { chartError: "quick" } });
      const r = await run(ok.deps);
      expect(r.failed.map((f) => f.split(" ")[0])).toEqual(["TA", "TB"]);
      expect(r.retryable).toEqual(["TA", "TB"]); // 일시 오류로 못 받은 종목: 같은 날 다시 실행하면 채울 수 있다
      expect(r.failed[0]).toContain("1차");
      expect(r.etfs).toHaveLength(18);

      await rm(dir, { recursive: true, force: true });
      dir = await mkdtemp(join(tmpdir(), "sync-us-"));
      const bad = makeDeps(twenty, { TA: { chartError: "quick" }, TB: { chartError: "quick" }, TC: { chartError: "quick" } });
      await expect(run(bad.deps)).rejects.toThrow(/1차\(시세\).*20개 중 3개/);

      await rm(dir, { recursive: true, force: true });
      dir = await mkdtemp(join(tmpdir(), "sync-us-"));
      const gone = makeDeps(twenty, Object.fromEntries(twenty.slice(0, 12).map((s) => [s, { chartNotFound: true }])));
      const r2 = await run(gone.deps);
      expect(r2.failed).toEqual([]);
      expect(r2.stats.quick.notFound).toBe(12);
      expect(r2.etfs).toHaveLength(8);
    });

    it("2차: 펀드 정보 실패가 허용 수를 넘으면 중단", async () => {
      const ok = makeDeps(twenty, { TA: { info: "error" }, TB: { info: "error" } });
      const r = await run(ok.deps);
      expect(r.failed).toHaveLength(2);
      expect(r.retryable).toEqual(["TA", "TB"]);
      expect(r.failed[0]).toContain("펀드 정보");

      await rm(dir, { recursive: true, force: true });
      dir = await mkdtemp(join(tmpdir(), "sync-us-"));
      const bad = makeDeps(twenty, { TA: { info: "error" }, TB: { info: "error" }, TC: { info: "error" } });
      await expect(run(bad.deps)).rejects.toThrow(/2차\(펀드 정보\)/);
    });

    it("3차: 장기 시세 실패가 허용 수를 넘으면 중단", async () => {
      const ok = makeDeps(twenty, { TA: { chartError: "price" }, TB: { chartError: "price" } });
      const r = await run(ok.deps);
      expect(r.failed).toHaveLength(2);
      expect(r.retryable).toEqual(["TA", "TB"]);
      expect(r.failed[0]).toContain("시세");
      expect(r.etfs).toHaveLength(18);

      await rm(dir, { recursive: true, force: true });
      dir = await mkdtemp(join(tmpdir(), "sync-us-"));
      const bad = makeDeps(twenty, { TA: { chartError: "price" }, TB: { chartError: "price" }, TC: { chartError: "price" } });
      await expect(run(bad.deps)).rejects.toThrow(/3차\(일별 시세\)/);
    });

    it("선별 결과가 0개면 중단", async () => {
      const { deps } = makeDeps(["AAA", "BBB"], { AAA: { shape: { vol: 1 } }, BBB: { shape: { vol: 1 } } });
      await expect(run(deps)).rejects.toThrow(/0개/);
    });
  });
});

describe("buildUsIndex: 수집하지 않은 종목의 검색 색인", () => {
  it("티커 순으로 정렬하고 같은 티커는 한 번만 담는다", () => {
    const idx = buildUsIndex(
      [
        { symbol: "ZZZ", name: "Z fund", reason: "small-aum" },
        { symbol: "AAA", name: "A fund", reason: "short" },
        { symbol: "AAA", name: "A fund again", reason: "etn" },
        { symbol: "MMM", name: "M fund", reason: "low-trading" },
      ],
      "20261009",
    );
    expect(idx).toEqual({
      version: 1,
      asOf: "20261009",
      etfs: [
        ["AAA", "A fund", "short"],
        ["MMM", "M fund", "low-trading"],
        ["ZZZ", "Z fund", "small-aum"],
      ],
    });
  });
});
