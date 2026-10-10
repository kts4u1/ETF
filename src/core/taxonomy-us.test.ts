import { describe, expect, it } from "vitest";
import { classify } from "./taxonomy";
import { classifyUs, extractUsBrand, isKnownUsCategory, singleStockUnderlying, type UsEtfInfo } from "./taxonomy-us";
import sample from "./taxonomy-us.sample.json";
import type { AssetClass, Region, StructureTag } from "./types";

/**
 * 해외(미국) 상장 ETF 분류기 테스트. 이름·모닝스타 카테고리는 실제 야후 응답(875개 표본)과 나스닥 목록에서 가져왔다.
 * 표는 "이 이름과 카테고리를 넣으면 이 분류가 나온다"를 고정해, 규칙을 건드리면 어떤 종목이 바뀌는지 바로 드러나게 한다.
 */

type Row = [
  symbol: string,
  name: string,
  category: string | null,
  assetClass: AssetClass,
  region: Region,
  theme: string | null,
  broad: boolean,
  tags: StructureTag[],
  leverage: number,
];

const info = (symbol: string, name: string, category: string | null = null): UsEtfInfo => ({ symbol, name, category, family: null, legalType: null });
const sorted = (t: readonly StructureTag[]) => [...t].sort();

/* eslint-disable */
const TABLE: Row[] = [
  // 미국 대표 지수·규모·스타일
  ["SPY", "State Street SPDR S&P 500 ETF Trust", "Large Blend", "global-equity", "US", "S&P500", true, [], 1],
  ["VOO", "Vanguard S&P 500 ETF", "Large Blend", "global-equity", "US", "S&P500", true, [], 1],
  ["IVV", "iShares Core S&P 500 ETF", "Large Blend", "global-equity", "US", "S&P500", true, [], 1],
  ["SPLG", "State Street SPDR Portfolio S&P 500 ETF", "Large Blend", "global-equity", "US", "S&P500", true, [], 1],
  ["QQQ", "Invesco QQQ Trust", "Large Growth", "global-equity", "US", "나스닥100", true, [], 1],
  ["QQQM", "Invesco NASDAQ 100 ETF", "Large Growth", "global-equity", "US", "나스닥100", true, [], 1],
  ["IWM", "iShares Russell 2000 ETF", "Small Blend", "global-equity", "US", "미국 소형주", true, [], 1],
  ["VTWO", "Vanguard Russell 2000 ETF", "Small Blend", "global-equity", "US", "미국 소형주", true, [], 1],
  ["DIA", "State Street SPDR Dow Jones Industrial Average ETF Trust", "Large Value", "global-equity", "US", "다우존스", true, [], 1],
  ["VTI", "Vanguard Morningstar Total Stock Market ETF", "Large Blend", "global-equity", "US", "미국 전체시장", true, [], 1],
  ["IJH", "iShares Core S&P Mid-Cap ETF", "Mid-Cap Blend", "global-equity", "US", "미국 중형주", true, [], 1],
  ["SCHD", "Schwab U.S. Dividend Equity ETF", "Large Value", "global-equity", "US", "배당·가치", false, ["dividend"], 1],
  ["VIG", "Vanguard Dividend Appreciation Index Fund ETF Shares", "Large Blend", "global-equity", "US", "배당·가치", false, ["dividend"], 1],
  ["HDV", "iShares Core High Dividend ETF", "Large Value", "global-equity", "US", "배당·가치", false, ["dividend"], 1],
  ["SPYD", "State Street SPDR Portfolio S&P 500 High Dividend ETF", "Large Value", "global-equity", "US", "배당·가치", false, ["dividend"], 1],
  ["QUAL", "iShares MSCI USA Quality Factor ETF", "Large Blend", "global-equity", "US", "스마트베타", false, [], 1],
  ["RSP", "Invesco S&P 500 Equal Weight ETF", "Large Blend", "global-equity", "US", "스마트베타", false, [], 1],
  ["VUG", "Vanguard Morningstar Growth ETF", "Large Growth", "global-equity", "US", "스마트베타", false, [], 1],
  ["PGX", "Invesco Preferred ETF", "Preferred Stock", "global-equity", "US", "배당·가치", false, [], 1],
  ["DAK", "Dakota Active Equity ETF", "Large Blend", "global-equity", "US", null, false, ["active"], 1],
  // 해외 지수·국가
  ["EFA", "iShares MSCI EAFE ETF", "Foreign Large Blend", "global-equity", "GLOBAL", "선진국(미국 제외)", true, [], 1],
  ["MFSI", "MFS Active International ETF", "Foreign Large Blend", "global-equity", "GLOBAL", "선진국(미국 제외)", true, ["active"], 1],
  ["EEM", "iShares MSCI Emerging Markets ETF", "Diversified Emerging Mkts", "global-equity", "GLOBAL", "신흥국", true, [], 1],
  ["VWO", "Vanguard FTSE Emerging Markets Index Fund ETF Shares", "Diversified Emerging Mkts", "global-equity", "GLOBAL", "신흥국", true, [], 1],
  ["ACWI", "iShares MSCI ACWI ETF", "Global Large-Stock Blend", "global-equity", "GLOBAL", "선진국(MSCI World)", true, [], 1],
  ["VT", "Vanguard Total World Stock ETF", "Global Large-Stock Blend", "global-equity", "GLOBAL", "선진국(MSCI World)", true, [], 1],
  ["EWJ", "iShares MSCI Japan ETF", "Japan Stock", "global-equity", "JP", "일본 대표", true, [], 1],
  ["EWY", "iShares MSCI South Korea ETF", "Focused Region", "global-equity", "KR", "한국 대표", true, [], 1],
  ["FXI", "iShares China Large-Cap ETF", "Greater China Region", "global-equity", "CN", "차이나 대표", true, [], 1],
  ["KWEB", "KraneShares CSI China Internet ETF", "Greater China Region", "global-equity", "CN", "AI·빅테크", false, [], 1],
  ["INDA", "iShares MSCI India ETF", "India Equity", "global-equity", "IN", "인도 대표", true, [], 1],
  ["VGK", "Vanguard FTSE Europe ETF", "Europe Stock", "global-equity", "EU", "유럽 대표", true, [], 1],
  ["EWZ", "iShares MSCI Brazil ETF", "Focused Region", "global-equity", "GLOBAL", "브라질 대표", true, [], 1],
  ["VNM", "VanEck Vietnam ETF", "Focused Region", "global-equity", "VN", "베트남 대표", true, [], 1],
  ["EWT", "iShares MSCI Taiwan ETF", "Greater China Region", "global-equity", "GLOBAL", "대만 대표", true, [], 1],
  // 채권
  ["AGG", "iShares Core U.S. Aggregate Bond ETF", "Intermediate Core Bond", "bond", "US", "종합채권", false, [], 1],
  ["BND", "Vanguard Total Bond Market Index Fund ETF Shares", "Intermediate Core Bond", "bond", "US", "종합채권", false, [], 1],
  ["TLT", "iShares 20+ Year Treasury Bond ETF", "Long Government", "bond", "US", "미국채", false, [], 1],
  ["IEF", "iShares 7-10 Year Treasury Bond ETF", "Long Government", "bond", "US", "미국채", false, [], 1],
  ["SHY", "iShares 1-3 Year Treasury Bond ETF", "Short Government", "bond", "US", "미국채", false, [], 1],
  ["IBTI", "iShares iBonds Dec 2028 Term Treasury ETF", "Target Maturity", "bond", "US", "미국채", false, [], 1],
  ["LQD", "iShares iBoxx $ Investment Grade Corporate Bond ETF", "Corporate Bond", "bond", "US", "회사채", false, [], 1],
  ["VCSH", "Vanguard Short-Term Corporate Bond Index Fund ETF Shares", "Short-Term Bond", "bond", "US", "회사채", false, [], 1],
  ["HYG", "iShares iBoxx $ High Yield Corporate Bond ETF", "High Yield Bond", "bond", "US", "하이일드", false, [], 1],
  ["TIP", "iShares TIPS Bond ETF", "Inflation-Protected Bond", "bond", "US", "물가연동채", false, [], 1],
  ["MUB", "iShares National Muni Bond ETF", "Muni National Interm", "bond", "US", "미국 지방채", false, [], 1],
  ["EMB", "iShares J.P. Morgan USD Emerging Markets Bond ETF", "Emerging Markets Bond", "bond", "GLOBAL", "신흥국채", false, [], 1],
  ["BWX", "State Street SPDR Bloomberg International Treasury Bond ETF", "Global Bond", "bond", "GLOBAL", "글로벌채", false, [], 1],
  ["MBB", "iShares MBS ETF", "Government Mortgage-Backed Bond", "bond", "US", "MBS·유동화채", false, [], 1],
  ["SRLN", "State Street Blackstone Senior Loan ETF", "Bank Loan", "bond", "US", "뱅크론", false, [], 1],
  // 현금성(초단기 국채·T-bill)
  ["BIL", "State Street SPDR Bloomberg 1-3 Month T-Bill ETF", "Ultrashort Bond", "cash", "US", "파킹·초단기", false, [], 1],
  ["SGOV", "iShares 0-3 Month Treasury Bond ETF", "Ultrashort Bond", "cash", "US", "파킹·초단기", false, [], 1],
  ["SHV", "iShares 0–1 Year Treasury Bond ETF", "Ultrashort Bond", "cash", "US", "파킹·초단기", false, [], 1],
  ["OBIL", "F/m US Treasury 12 Month Bill ETF", "Short Government", "cash", "US", "파킹·초단기", false, [], 1],
  // 원자재(현물은 futures 태그 없음, 선물 기반은 있음)
  ["GLD", "SPDR Gold Shares", "Commodities Focused", "commodity", "NA", "금", false, [], 1],
  ["GLDM", "SPDR Gold MiniShares Trust", "Commodities Focused", "commodity", "NA", "금", false, [], 1],
  ["SLV", "iShares Silver Trust", "Commodities Focused", "commodity", "NA", "은", false, [], 1],
  ["GLTR", "abrdn Physical Precious Metals Basket Shares ETF", "Commodities Focused", "commodity", "NA", "귀금속", false, [], 1],
  ["USO", "United States Oil Fund, LP", "Commodities Focused", "commodity", "NA", "원유", false, ["futures"], 1],
  ["UNG", "United States Natural Gas Fund, LP", "Commodities Focused", "commodity", "NA", "천연가스", false, ["futures"], 1],
  ["DBC", "Invesco DB Commodity Index Tracking Fund", "Commodities Broad Basket", "commodity", "NA", "원자재 종합", false, ["futures"], 1],
  ["CPER", "United States Copper Index Fund, LP", "Commodities Focused", "commodity", "NA", "구리", false, ["futures"], 1],
  ["DBA", "Invesco DB Agriculture Fund", "Commodities Focused", "commodity", "NA", "농산물", false, ["futures"], 1],
  // 가상자산(현물은 crypto, 기업 주식은 주식 + 가상자산 관련주)
  ["IBIT", "iShares Bitcoin Trust ETF", "Digital Assets", "crypto", "NA", "비트코인", false, [], 1],
  ["FBTC", "Fidelity Wise Origin Bitcoin Fund", "Digital Assets", "crypto", "NA", "비트코인", false, [], 1],
  ["GBTC", "Grayscale Bitcoin Trust ETF", "Digital Assets", "crypto", "NA", "비트코인", false, [], 1],
  ["ETHA", "iShares Ethereum Trust ETF", "Digital Assets", "crypto", "NA", "이더리움", false, [], 1],
  ["BITO", "ProShares Bitcoin ETF", "Digital Assets", "crypto", "NA", "비트코인", false, ["futures"], 1],
  ["BLOK", "Amplify Blockchain Technology ETF", "Equity Digital Assets", "global-equity", "US", "가상자산 관련주", false, [], 1],
  // 통화
  ["FXE", "Invesco CurrencyShares Euro Currency Trust", "Single Currency", "fx", "NA", "유로", false, [], 1],
  ["FXY", "Invesco CurrencyShares Japanese Yen Trust", "Single Currency", "fx", "NA", "엔화", false, [], 1],
  ["UUP", "Invesco DB US Dollar Index Bullish Fund", "Trading--Miscellaneous", "fx", "NA", "달러", false, ["futures"], 1],
  // 리츠·인프라
  ["VNQ", "Vanguard Real Estate Index Fund ETF Shares", "Real Estate", "real-asset", "US", "리츠", false, [], 1],
  ["XLRE", "State Street Real Estate Select Sector SPDR ETF", "Real Estate", "real-asset", "US", "리츠", false, [], 1],
  ["PAVE", "Global X U.S. Infrastructure Development ETF", "Infrastructure", "real-asset", "US", "인프라", false, [], 1],
  ["BILD", "Nomura Global Listed Infrastructure ETF", "Infrastructure", "real-asset", "GLOBAL", "인프라", false, [], 1],
  // 섹터·테마
  ["XLK", "State Street Technology Select Sector SPDR ETF", "Technology", "global-equity", "US", "AI·빅테크", false, [], 1],
  ["XLF", "State Street Financial Select Sector SPDR ETF", "Financial", "global-equity", "US", "금융", false, [], 1],
  ["XLE", "State Street Energy Select Sector SPDR ETF", "Equity Energy", "global-equity", "US", "원전·에너지", false, [], 1],
  ["XLV", "State Street Health Care Select Sector SPDR ETF", "Health", "global-equity", "US", "바이오·헬스케어", false, [], 1],
  ["XLU", "State Street Utilities Select Sector SPDR ETF", "Utilities", "global-equity", "US", "유틸리티", false, [], 1],
  ["XLY", "State Street Consumer Discretionary Select Sector SPDR ETF", "Consumer Cyclical", "global-equity", "US", "소비·미디어", false, [], 1],
  ["XLP", "State Street Consumer Staples Select Sector SPDR ETF", "Consumer Defensive", "global-equity", "US", "소비·미디어", false, [], 1],
  ["XLB", "State Street Materials Select Sector SPDR ETF", "Natural Resources", "global-equity", "US", "건설·산업재", false, [], 1],
  ["SMH", "VanEck Semiconductor ETF", "Technology", "global-equity", "US", "반도체", false, [], 1],
  ["SOXX", "iShares Semiconductor ETF", "Technology", "global-equity", "US", "반도체", false, [], 1],
  ["ARKK", "ARK Innovation ETF", "Mid-Cap Growth", "global-equity", "US", "혁신·신기술", false, [], 1],
  ["GDX", "VanEck Gold Miners ETF", "Equity Precious Metals", "global-equity", "GLOBAL", "금속·광업", false, [], 1],
  ["URA", "Global X Uranium ETF", "Natural Resources", "global-equity", "GLOBAL", "원전·에너지", false, [], 1],
  ["ICLN", "iShares Global Clean Energy ETF", "Miscellaneous Sector", "global-equity", "GLOBAL", "원전·에너지", false, [], 1],
  ["ITA", "iShares U.S. Aerospace & Defense ETF", "Industrials", "global-equity", "US", "방산·우주", false, [], 1],
  ["IBB", "iShares Biotechnology ETF", "Health", "global-equity", "US", "바이오·헬스케어", false, [], 1],
  // 레버리지·인버스(배수는 이름의 표기, ProShares 식 이름, 카테고리 순으로 정한다)
  ["TQQQ", "ProShares UltraPro QQQ", "Trading--Leveraged Equity", "global-equity", "US", "나스닥100", true, ["leveraged"], 3],
  ["SQQQ", "ProShares UltraPro Short QQQ", "Trading--Inverse Equity", "global-equity", "US", "나스닥100", true, ["inverse"], -3],
  ["UPRO", "ProShares UltraPro S&P500", "Trading--Leveraged Equity", "global-equity", "US", "S&P500", true, ["leveraged"], 3],
  ["SPXL", "Direxion Daily S&P 500 Bull 3X Shares", "Trading--Leveraged Equity", "global-equity", "US", "S&P500", true, ["leveraged"], 3],
  ["SSO", "ProShares Ultra S&P500", "Trading--Leveraged Equity", "global-equity", "US", "S&P500", true, ["leveraged"], 2],
  ["SPXU", "ProShares UltraPro Short S&P500", "Trading--Inverse Equity", "global-equity", "US", "S&P500", true, ["inverse"], -3],
  ["SDS", "ProShares UltraShort S&P500", "Trading--Inverse Equity", "global-equity", "US", "S&P500", true, ["inverse"], -2],
  ["SOXL", "Direxion Daily Semiconductor Bull 3X Shares", "Trading--Leveraged Equity", "global-equity", "US", "반도체", false, ["leveraged"], 3],
  ["TMF", "Direxion Daily 20+ Year Treasury Bull 3X Shares", "Trading--Leveraged Debt", "bond", "US", "미국채", false, ["leveraged"], 3],
  ["TBF", "ProShares Short 20+ Year Treasury", "Trading--Inverse Debt", "bond", "US", "미국채", false, ["inverse"], -1],
  ["DUG", "ProShares UltraShort Energy ETF", "Trading--Inverse Equity", "global-equity", "US", "원전·에너지", false, ["inverse"], -2],
  ["EFO", "ProShares Ultra MSCI EAFE", "Trading--Leveraged Equity", "global-equity", "GLOBAL", "선진국(미국 제외)", true, ["leveraged"], 2],
  // 단일 종목(레버리지·옵션인컴·주간분배)은 집중 투자 태그가 붙고, 기초 종목의 업종이 테마가 된다
  ["AAOX", "Tradr 2X Long AAOI Daily ETF", "Trading--Leveraged Equity", "global-equity", "US", "반도체", false, ["leveraged", "concentrated"], 2],
  ["NVDL", "GraniteShares 2x Long NVDA Daily ETF", "Trading--Leveraged Equity", "global-equity", "US", "반도체", false, ["leveraged", "concentrated"], 2],
  ["NVDQ", "T-Rex 2X Inverse NVIDIA Daily Target ETF", "Trading--Inverse Equity", "global-equity", "US", "반도체", false, ["inverse", "concentrated"], -2],
  ["PLTU", "Direxion Daily PLTR Bull 2X Shares", "Trading--Leveraged Equity", "global-equity", "US", "AI·빅테크", false, ["leveraged", "concentrated"], 2],
  ["TSLL", "Direxion Daily TSLA Bull 2X Shares", "Trading--Leveraged Equity", "global-equity", "US", "전기차·자동차", false, ["leveraged", "concentrated"], 2],
  ["SKHA", "Tradr 2X Long SK hynix Daily ETF", "Trading--Leveraged Equity", "global-equity", "KR", "반도체", false, ["leveraged", "concentrated"], 2],
  ["APLY", "YieldMax AAPL Option Income Strategy ETF", "Derivative Income", "global-equity", "US", "AI·빅테크", false, ["covered-call", "concentrated"], 1],
  ["AMDW", "Roundhill AMD WeeklyPay ETF", "Trading--Miscellaneous", "global-equity", "US", "반도체", false, ["concentrated"], 1],
  // 변동성(VIX) 선물
  ["UVXY", "ProShares Ultra VIX Short-Term Futures ETF", "Trading--Miscellaneous", "global-equity", "US", null, false, ["leveraged", "volatility", "futures"], 1.5],
  ["SVXY", "ProShares Short VIX Short-Term Futures ETF", "Trading--Miscellaneous", "global-equity", "US", null, false, ["inverse", "volatility", "futures"], -0.5],
  ["VXX", "iPath Series B S&P 500 VIX Short-Term Futures ETN", "Trading--Miscellaneous", "global-equity", "US", null, false, ["volatility", "futures"], 1],
  // 커버드콜(Derivative Income 카테고리와 이름 규칙)
  ["JEPI", "JPMorgan Equity Premium Income ETF", "Derivative Income", "global-equity", "US", null, false, ["covered-call"], 1],
  ["JEPQ", "JPMorgan Nasdaq Equity Premium Income ETF", "Derivative Income", "global-equity", "US", "나스닥100", true, ["covered-call"], 1],
  ["QYLD", "Global X NASDAQ 100 Covered Call ETF", "Derivative Income", "global-equity", "US", "나스닥100", true, ["covered-call"], 1],
  ["XYLD", "Global X S&P 500 Covered Call ETF", "Derivative Income", "global-equity", "US", "S&P500", true, ["covered-call"], 1],
  ["DIVO", "Amplify CWP Enhanced Dividend Income ETF", "Derivative Income", "global-equity", "US", "배당·가치", false, ["covered-call", "dividend"], 1],
  // 버퍼·목표수익(Defined Outcome)
  ["PAPR", "Innovator U.S. Equity Power Buffer ETF - April", "Defined Outcome", "global-equity", "US", "S&P500", true, ["defined-outcome"], 1],
  ["PJUL", "Innovator U.S. Equity Power Buffer ETF - July", "Defined Outcome", "global-equity", "US", "S&P500", true, ["defined-outcome"], 1],
  ["NJUL", "Innovator Nasdaq-100 Power Buffer ETF - July", "Defined Outcome", "global-equity", "US", "나스닥100", true, ["defined-outcome"], 1],
  ["CPSJ", "Calamos S&P 500 Structured Alt Protection ETF - July", "Defined Outcome", "global-equity", "US", "S&P500", true, ["defined-outcome"], 1],
  // 혼합자산·대체전략
  ["AOR", "iShares Core 60/40 Balanced Allocation ETF", "Global Moderate Allocation", "multi", "GLOBAL", "주식+채권 혼합", false, [], 1],
  ["ITDD", "Ishares Lifepath Target Date 2040 ETF", "Target-Date 2040", "multi", "GLOBAL", "TDF(생애주기)", false, [], 1],
  ["RSSB", "Return Stacked Global Stocks & Bonds ETF", "Multi-Asset Overlay", "multi", "GLOBAL", "자산배분", false, [], 1],
  ["AHLT", "American Beacon AHL Trend ETF", "Systematic Trend", "multi", "GLOBAL", "대체전략", false, [], 1],
];
/* eslint-enable */

describe("classifyUs: 대표 티커 표", () => {
  it("표본이 충분하다(80종 이상)", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(80);
    expect(new Set(TABLE.map((r) => r[0])).size).toBe(TABLE.length);
  });
  it.each(TABLE)("%s — %s", (symbol, name, category, assetClass, region, theme, broad, tags, leverage) => {
    const t = classifyUs(info(symbol, name, category));
    expect({ assetClass: t.assetClass, region: t.region, theme: t.theme, broad: t.broad, tags: sorted(t.tags), leverage: t.leverage }).toEqual({
      assetClass,
      region,
      theme,
      broad,
      tags: sorted(tags),
      leverage,
    });
  });
});

describe("classifyUs: 구조 태그 규칙", () => {
  const tagsOf = (name: string, category: string | null = null) => sorted(classifyUs(info("TEST", name, category)).tags);
  const levOf = (name: string, category: string | null = null) => classifyUs(info("TEST", name, category)).leverage;

  it("hedged 태그는 절대 붙이지 않는다(해외 ETF 의 Hedged 는 달러 기준 환헤지라 원화 투자자에게는 환헤지가 아니다)", () => {
    const names = [
      ["Xtrackers MSCI Japan Hedged Equity ETF", "Japan Stock"],
      ["WisdomTree Europe Hedged Equity Fund", "Europe Stock"],
      ["Xtrackers MSCI All World ex US Hedged Equity ETF", "Foreign Large Blend"],
      ["iShares Currency Hedged MSCI Eurozone ETF", "Europe Stock"],
      ["iShares Global Government Bond USD Hedged Active ETF", "Global Bond-USD Hedged"],
      ["WisdomTree India Hedged Equity Fund ETF", "India Equity"],
    ] as const;
    for (const [n, c] of names) expect(tagsOf(n, c), n).not.toContain("hedged");
    // 이름의 Hedged 는 서로 다른 상품이므로 groupKey 에는 남는다.
    const a = classifyUs(info("DBJP", "Xtrackers MSCI Japan Hedged Equity ETF", "Japan Stock")).groupKey;
    const b = classifyUs(info("DXJ", "Xtrackers MSCI Japan Equity ETF", "Japan Stock")).groupKey;
    expect(a).not.toBe(b);
  });

  it("레버리지 배수: 이름의 표기(2X, 3x, 1.5X, 1.25x) > ProShares 식 이름 > 카테고리", () => {
    expect(levOf("Tradr 2X Long AAOI Daily ETF", "Trading--Leveraged Equity")).toBe(2);
    expect(levOf("Corgi ALAB 2x Daily ETF", "Trading--Leveraged Equity")).toBe(2);
    expect(levOf("Direxion Daily Semiconductor Bull 3X Shares", "Trading--Leveraged Equity")).toBe(3);
    expect(levOf("GraniteShares 1.25x Long TSLA Daily ETF")).toBe(1.25);
    expect(levOf("Tradr 1.5X Short NVDA Daily ETF")).toBe(-1.5);
    expect(levOf("Teucrium 2x Daily Wheat ETF", "Trading--Leveraged Commodities")).toBe(2);
    expect(levOf("ProShares Ultra Bloomberg Natural Gas", "Trading--Leveraged Commodities")).toBe(2);
    // 이름에 배수 표기가 없으면 카테고리의 기본값(레버리지 2배)
    expect(levOf("TDAQ Lift ETF", "Trading--Leveraged Equity")).toBe(2);
  });

  it("인버스: Inverse·Short·Bear·-nx 와 음수 배수", () => {
    expect(levOf("T-REX 2X Inverse CRWV Daily Target ETF", "Trading--Inverse Equity")).toBe(-2);
    expect(levOf("Tradr 2X Short AMZN Daily ETF", "Trading--Inverse Equity")).toBe(-2);
    expect(levOf("Direxion Daily META Bear 1X ETF", "Trading--Inverse Equity")).toBe(-1);
    expect(levOf("Direxion Daily S&P 500 Bear 3X Shares", "Trading--Inverse Equity")).toBe(-3);
    expect(levOf("MicroSectors U.S. Big Oil -3x Inverse Leveraged ETNs", "Trading--Inverse Equity")).toBe(-3);
    expect(levOf("ProShares Short MSCI Emerging Markets", "Trading--Inverse Equity")).toBe(-1);
    expect(tagsOf("ProShares UltraShort Energy ETF", "Trading--Inverse Equity")).toEqual(["inverse"]);
  });

  it("Short-Term·Short Duration·Long/Short·Ultra-Short 같은 채권·전략 이름은 인버스가 아니다", () => {
    const notInverse: [string, string | null][] = [
      ["Vanguard Short-Term Corporate Bond Index Fund ETF Shares", "Short-Term Bond"],
      ["Eaton Vance Short Duration Income ETF", "Short-Term Bond"],
      ["Leatherback Long/Short Alternative Yield ETF", "Long-Short Equity"],
      ["ProShares Long Online/Short Stores ETF", "Long-Short Equity"],
      ["BNY Mellon Ultra Short Income ETF", "Ultrashort Bond"],
      ["Angel Oak UltraShort Income ETF", null],
      ["Allspring Ultra Short Municipal ETF", "Muni National Short"],
      ["Vanguard Ultra-Short Treasury ETF", null],
    ];
    for (const [n, c] of notInverse) {
      expect(levOf(n, c), n).toBe(1);
      expect(tagsOf(n, c), n).not.toContain("inverse");
    }
  });

  it("실제 수집에서 처음 보인 카테고리: 시장중립·차익거래는 대체전략(혼합자산), 프라임 머니마켓은 현금성", () => {
    for (const [sym, name, cat] of [
      ["XBOX", "Roundhill Box Spread ETF", "Equity Market Neutral"],
      ["CBOX", "Calamos Tax-Aware Collateral ETF", "Relative Value Arbitrage"],
    ] as const) {
      const t = classifyUs(info(sym, name, cat));
      expect(t.assetClass, sym).toBe("multi");
      expect(t.theme, sym).toBe("대체전략");
      expect(isKnownUsCategory(cat), cat).toBe(true);
    }
    const mm = classifyUs(info("PMMF", "iShares Prime Money Market ETF", "Prime Money Market"));
    expect(mm.assetClass).toBe("cash");
    expect(isKnownUsCategory("Prime Money Market")).toBe(true);
  });

  it("독립 검토에서 찾은 오분류 회귀: 저변동성 지수·YieldMax Ultra·Short 채권·금리헷지 회사채", () => {
    const lglv = classifyUs(info("LGLV", "State Street SPDR US Large Cap Low Volatility Index ETF", "Large Blend"));
    expect(lglv.tags).not.toContain("volatility");
    expect(lglv.tags).not.toContain("futures");
    // 진짜 VIX 상품은 그대로 변동성 태그
    expect(classifyUs(info("SVOL", "Simplify Volatility Premium ETF", "Derivative Income")).tags).toContain("volatility");
    expect(classifyUs(info("UVXY", "ProShares Ultra VIX Short-Term Futures ETF", "Trading--Miscellaneous")).tags).toContain("volatility");

    const ulty = classifyUs(info("ULTY", "YieldMax Ultra Option Income Strategy ETF", "Derivative Income"));
    expect(ulty.leverage).toBe(1);
    expect(ulty.tags).not.toContain("leveraged");
    expect(classifyUs(info("BITU", "Proshares Ultra Bitcoin ETF", "Trading--Leveraged Commodities")).leverage).toBe(2);
    expect(classifyUs(info("UWM", "ProShares Ultra Russell2000", "Trading--Leveraged Equity")).leverage).toBe(2);

    const shyd = classifyUs(info("SHYD", "VanEck Short High Yield Muni ETF", "High Yield Muni"));
    expect(shyd.leverage).toBe(1);
    expect(shyd.tags).not.toContain("inverse");
    // 진짜 인버스 하이일드는 카테고리로 여전히 인버스
    const sjb = classifyUs(info("SJB", "ProShares Short High Yield", "Trading--Inverse Equity"));
    expect(sjb.leverage).toBe(-1);

    const lqdh = classifyUs(info("LQDH", "iShares Interest Rate Hedged Corporate Bond ETF", "Ultrashort Bond"));
    expect(lqdh.assetClass).toBe("bond");
    expect(classifyUs(info("BIL", "SPDR Bloomberg 1-3 Month T-Bill ETF", "Ultrashort Bond")).assetClass).toBe("cash");
  });

  it("꼬리위험(Tail Risk) 상품은 카테고리가 인버스여도 -1배가 아니다", () => {
    const t = classifyUs(info("TAIL", "Cambria Tail Risk ETF", "Trading--Inverse Equity"));
    expect(t.leverage).toBe(1);
    expect(t.tags).toEqual([]);
  });

  it("배수 표기가 아닌 숫자-x 는 배수로 읽지 않는다(21Shares, 10x Genomics)", () => {
    expect(levOf("21Shares Hyperliquid Staking ETF")).toBe(1);
    expect(levOf("10x Genomics Innovators ETF")).toBe(1);
  });

  it("커버드콜: Derivative Income 카테고리와 이름(Covered Call·BuyWrite·Premium Income·Option Income·YieldMax)", () => {
    expect(tagsOf("First Trust Nasdaq BuyWrite Income ETF")).toContain("covered-call");
    expect(tagsOf("Roundhill Bitcoin Covered Call Strategy ETF", "Digital Assets")).toContain("covered-call");
    expect(tagsOf("YieldMax NVDA Option Income Strategy ETF")).toContain("covered-call");
    expect(tagsOf("Kurv High Income ETF", "Derivative Income")).toContain("covered-call");
    // 버퍼 상품은 이름에 Premium Income 이 있어도 커버드콜이 아니라 버퍼·목표수익이다.
    expect(tagsOf("Innovator Premium Income 20 Barrier ETF - April", "Defined Outcome")).toEqual(["defined-outcome"]);
    expect(tagsOf("JPMorgan U.S. Quality Factor ETF", "Large Blend")).not.toContain("covered-call");
  });

  it("버퍼·목표수익: Defined Outcome 카테고리와 Buffer/Accelerated/Floor 이름", () => {
    expect(tagsOf("FT Vest U.S. Equity Max Buffer ETF - July", "Defined Outcome")).toEqual(["defined-outcome"]);
    expect(tagsOf("Innovator Nasdaq-100 Managed Floor ETF", "Equity Hedged")).toEqual(["defined-outcome"]);
    expect(tagsOf("MC Trio Equity Buffered ETF", "Equity Hedged")).toEqual(["defined-outcome"]);
    expect(tagsOf("iShares Large Cap Accelerated Outcome ETF", "Defined Outcome")).toEqual(["defined-outcome"]);
    expect(tagsOf("iShares Large Cap Max Buffer Mar ETF")).toEqual(["defined-outcome"]);
  });

  it("선물 기반은 futures: 현물 금·은·백금 신탁은 없고, 선물 펀드와 VIX 는 있다", () => {
    expect(tagsOf("SPDR Gold Shares", "Commodities Focused")).toEqual([]);
    expect(tagsOf("Sprott Physical Silver Trust")).toEqual([]);
    expect(tagsOf("abrdn Physical Platinum Shares ETF")).toEqual([]);
    expect(tagsOf("Invesco DB Gold Fund", "Commodities Focused")).toEqual(["futures"]);
    expect(tagsOf("United States Gasoline Fund, LP", "Commodities Focused")).toEqual(["futures"]);
    expect(tagsOf("ProShares VIX Mid-Term Futures ETF")).toEqual(["futures", "volatility"]);
    expect(tagsOf("Simplify DBi CTA Managed Future", "Systematic Trend")).toEqual(["futures"]);
  });

  it("집중 투자: 단일 종목, Top 1~5, Concentrated 는 붙고 섹터·지수·Magnificent 7 은 아니다", () => {
    expect(tagsOf("Direxion Daily Energy Top 5 Bull 2X ETF", "Trading--Leveraged Equity")).toEqual(["concentrated", "leveraged"]);
    expect(tagsOf("Dana Concentrated Dividend ETF", "Large Value")).toContain("concentrated");
    expect(tagsOf("BP p.l.c. ADRhedged", "Equity Energy")).toContain("concentrated");
    expect(tagsOf("Direxion Daily Semiconductor Bull 3X Shares", "Trading--Leveraged Equity")).not.toContain("concentrated");
    expect(tagsOf("Direxion Daily Gold Miners Index Bull 2X Shares", "Trading--Leveraged Equity")).not.toContain("concentrated");
    expect(tagsOf("ProShares UltraPro QQQ", "Trading--Leveraged Equity")).not.toContain("concentrated");
    expect(tagsOf("Roundhill Magnificent Seven Covered Call ETF", "Derivative Income")).not.toContain("concentrated");
    expect(tagsOf("Global X S&P 500 U.S. Market Leaders TOP 50 ETF", "Large Blend")).not.toContain("concentrated");
  });

  it("배당·액티브·합성·TR 태그", () => {
    expect(tagsOf("Schwab U.S. Dividend Equity ETF", "Large Value")).toContain("dividend");
    // 채권 펀드의 'Income'·'High Yield' 는 배당 태그가 아니다
    expect(tagsOf("iShares iBoxx $ High Yield Corporate Bond ETF", "High Yield Bond")).toEqual([]);
    expect(tagsOf("Dimensional Short-Duration Fixed Income ETF", "Short-Term Bond")).toEqual([]);
    expect(tagsOf("MFS Active International ETF", "Foreign Large Blend")).toContain("active");
    // ActiveBeta 는 지수 이름이지 액티브 운용이 아니다
    expect(tagsOf("Goldman Sachs ActiveBeta Japan Equity ETF", "Japan Stock")).not.toContain("active");
    expect(tagsOf("ETRACS IFED Invest with the Fed TR Index ETN")).toContain("total-return");
    expect(tagsOf("T. Rowe Price Total Return ETF", "Intermediate Core-Plus Bond")).not.toContain("total-return");
    expect(tagsOf("Example Synthetic Replication ETF")).toContain("synthetic");
  });
});

describe("classifyUs: 자산군·지역·테마 경계", () => {
  const cls = (name: string, category: string | null = null) => classifyUs(info("TEST", name, category));

  it("가상자산 현물은 crypto(지역 NA), 가상자산 관련 기업 주식은 주식 + '가상자산 관련주'", () => {
    expect(cls("iShares Bitcoin Trust ETF", "Digital Assets").assetClass).toBe("crypto");
    expect(cls("Bitwise Bitcoin Standard Corporations ETF", "Equity Digital Assets")).toMatchObject({ assetClass: "global-equity", theme: "가상자산 관련주" });
    expect(cls("CoinShares Bitcoin Mining and Digital Power ETF", "Equity Digital Assets").assetClass).toBe("global-equity");
    // 카테고리가 없어도 기업 주식 이름이면 주식
    expect(cls("Valkyrie Bitcoin Miners ETF")).toMatchObject({ assetClass: "global-equity", theme: "가상자산 관련주" });
    expect(cls("T-Rex 2X Long Bitcoin Daily Target ETF", "Trading--Miscellaneous")).toMatchObject({ assetClass: "crypto", region: "NA", leverage: 2 });
    expect(cls("Tradr 2X Long CRCL Daily ETF", "Trading--Leveraged Equity")).toMatchObject({ assetClass: "global-equity", theme: "가상자산 관련주" });
  });

  it("국가 펀드는 지역과 '○○ 대표' 테마가 함께 정해진다", () => {
    expect(cls("iShares MSCI Canada ETF", "Focused Region")).toMatchObject({ region: "GLOBAL", theme: "캐나다 대표" });
    expect(cls("iShares MSCI United Kingdom ETF", "Focused Region")).toMatchObject({ region: "EU", theme: "영국 대표" });
    expect(cls("iShares MSCI Switzerland ETF", "Focused Region")).toMatchObject({ region: "EU", theme: "스위스 대표" });
    expect(cls("WisdomTree India Hedged Equity Fund ETF", "India Equity")).toMatchObject({ region: "IN", theme: "인도 대표" });
    // Nifty 50 지수를 추종하는 경우만 국내 어휘 '인도 Nifty50'
    expect(cls("iShares India 50 ETF", "India Equity")).toMatchObject({ region: "IN", theme: "인도 Nifty50" });
  });

  it("ex-China·ex-US 는 그 나라 펀드가 아니다", () => {
    expect(cls("Putnam Emerging Markets Ex-China ETF", "Diversified Emerging Mkts")).toMatchObject({ region: "GLOBAL", theme: "신흥국" });
    expect(cls("JPMorgan BetaBuilders Developed Asia Pacific ex-Japan ETF", "Pacific/Asia ex-Japan Stk").region).toBe("GLOBAL");
    expect(cls("ProShares S&P 500 ex-Technology ETF", "Large Blend")).toMatchObject({ region: "US", theme: "스마트베타", broad: false });
  });

  it("해외 지수 펀드에 미국 규모 테마(소형주·대형주)를 붙이지 않는다", () => {
    expect(cls("iShares China Large-Cap ETF", "Greater China Region").theme).toBe("차이나 대표");
    expect(cls("Schwab International Small-Cap Equity ETF", "Foreign Small/Mid Blend")).toMatchObject({ region: "GLOBAL", theme: "선진국(미국 제외)" });
    expect(cls("Bancreek International Large Cap ETF", "Foreign Large Growth").theme).toBe("선진국(미국 제외)");
  });

  it("Dow Jones Industrial Average 의 Industrial 이 산업재로 오분류되지 않는다", () => {
    expect(cls("State Street SPDR Dow Jones Industrial Average ETF Trust", "Large Value").theme).toBe("다우존스");
  });

  it("'Big Data Refiners'의 Refiners 는 정유가 아니고, 'AI-Enhanced'의 AI 는 AI 테마가 아니라 운용 방식이다", () => {
    expect(cls("ProShares Big Data Refiners ETF", "Technology").theme).toBe("AI·빅테크");
    expect(cls("QRAFT AI-Enhanced U.S. Large Cap Momentum ETF", "Large Growth").theme).toBe("스마트베타");
    expect(cls("Pictet AI Enhanced US Equity ETF", "Large Blend").theme).toBe(null);
  });

  it("'Brentview'의 Brent 는 원유가 아니다", () => {
    expect(cls("AAM Brentview Dividend Growth ETF", null)).toMatchObject({ assetClass: "global-equity", theme: "배당·가치" });
  });

  it("Select Sector SPDR 은 미국, 'Global' 이 들어간 섹터 펀드는 글로벌", () => {
    expect(cls("State Street Materials Select Sector SPDR ETF", "Natural Resources").region).toBe("US");
    expect(cls("iShares Global Energy ETF", "Equity Energy").region).toBe("GLOBAL");
    expect(cls("iShares Global Industrials ETF", "Industrials").region).toBe("GLOBAL");
  });

  it("채권: 글로벌 국채는 글로벌채, 미국 국채는 미국채, 코어 채권은 카테고리가 이름보다 우선", () => {
    expect(cls("iShares Global Government Bond USD Hedged Active ETF", "Global Bond-USD Hedged")).toMatchObject({ theme: "글로벌채", region: "GLOBAL" });
    expect(cls("Fidelity Investment Grade Bond ETF", "Intermediate Core Bond").theme).toBe("종합채권");
    expect(cls("Dimensional Short-Duration Fixed Income ETF", "Short-Term Bond").theme).toBe("단기채");
    expect(cls("Simplify MBS ETF", "Intermediate Government").theme).toBe("MBS·유동화채");
  });

  it("T-bill 은 현금성이지만 1~3년 국채는 채권", () => {
    expect(cls("Corgi 3-12 Month T-Bill ETF").assetClass).toBe("cash");
    expect(cls("US Treasury 6 Month Bill ETF").assetClass).toBe("cash");
    expect(cls("iShares 1-3 Year Treasury Bond ETF", "Short Government").assetClass).toBe("bond");
  });
});

describe("classifyUs: 카테고리가 null 일 때 이름만으로 합리적으로 동작", () => {
  // [이름, 자산군, 지역, 테마, 태그, 배수]
  const FALLBACK: [string, AssetClass, Region, string | null, StructureTag[], number][] = [
    ["ProShares UltraPro QQQ", "global-equity", "US", "나스닥100", ["leveraged"], 3],
    ["ProShares UltraPro Short S&P500", "global-equity", "US", "S&P500", ["inverse"], -3],
    ["Direxion Daily 20+ Year Treasury Bull 3X Shares", "bond", "US", "미국채", ["leveraged"], 3],
    ["iShares 20+ Year Treasury Bond ETF", "bond", "US", "미국채", [], 1],
    ["iShares iBoxx $ High Yield Corporate Bond ETF", "bond", "US", "하이일드", [], 1],
    ["iShares TIPS Bond ETF", "bond", "US", "물가연동채", [], 1],
    ["Franklin Pennsylvania Municipal Income ETF", "bond", "US", "미국 지방채", [], 1],
    ["iShares 0-3 Month Treasury Bond ETF", "cash", "US", "파킹·초단기", [], 1],
    ["SPDR Gold Shares", "commodity", "NA", "금", [], 1],
    ["Sprott Physical Silver Trust", "commodity", "NA", "은", [], 1],
    ["United States Oil Fund, LP", "commodity", "NA", "원유", ["futures"], 1],
    ["iShares Bitcoin Trust ETF", "crypto", "NA", "비트코인", [], 1],
    ["21shares Hyperliquid Staking ETF", "crypto", "NA", "하이퍼리퀴드", [], 1],
    ["Invesco CurrencyShares Japanese Yen Trust", "fx", "NA", "엔화", [], 1],
    ["Vanguard Real Estate Index Fund", "real-asset", "US", "리츠", [], 1],
    ["iShares MSCI Japan ETF", "global-equity", "JP", "일본 대표", [], 1],
    ["iShares MSCI Emerging Markets ETF", "global-equity", "GLOBAL", "신흥국", [], 1],
    ["Global X Uranium ETF", "global-equity", "US", "원전·에너지", [], 1],
    ["VanEck Semiconductor ETF", "global-equity", "US", "반도체", [], 1],
    ["Innovator U.S. Equity Power Buffer ETF - April", "global-equity", "US", "S&P500", ["defined-outcome"], 1],
    ["Global X NASDAQ 100 Covered Call ETF", "global-equity", "US", "나스닥100", ["covered-call"], 1],
    ["ProShares Ultra VIX Short-Term Futures ETF", "global-equity", "US", null, ["leveraged", "volatility", "futures"], 1.5],
    ["Tradr 2X Long AAOI Daily ETF", "global-equity", "US", "반도체", ["leveraged", "concentrated"], 2],
    ["iShares Core 60/40 Balanced Allocation ETF", "multi", "US", "주식+채권 혼합", [], 1],
    ["Ishares Lifepath Target Date 2040 ETF", "multi", "US", "TDF(생애주기)", [], 1],
    // 표본의 카테고리 없는 종목들(야후 fundProfile 이 비어 있는 약 1%)
    ["American Century ETF Trust - American Century Large Cap Growth ETF", "global-equity", "US", "스마트베타", [], 1],
    ["Hartford Funds Exchange-Traded Trust - Hartford Strategic Income ETF", "bond", "US", "종합채권", [], 1],
    ["Strategy Shares - Strategy Shares Gold Enhanced Yield ETF", "commodity", "NA", "금", [], 1],
    ["Corgi U.S. Mega-Cap Growth 2x D", "global-equity", "US", "스마트베타", ["leveraged"], 2],
    ["SEI QiM U.S. Equity Factor Allocation Active ETF", "global-equity", "US", "스마트베타", ["active"], 1],
  ];
  it.each(FALLBACK)("%s", (name, assetClass, region, theme, tags, leverage) => {
    const t = classifyUs({ symbol: "TEST", name, category: null, family: null, legalType: null });
    expect({ assetClass: t.assetClass, region: t.region, theme: t.theme, tags: sorted(t.tags), leverage: t.leverage }).toEqual({
      assetClass,
      region,
      theme,
      tags: sorted(tags),
      leverage,
    });
  });

  it("빈 문자열·공백 카테고리는 없는 것과 같다", () => {
    const a = classifyUs(info("TLT", "iShares 20+ Year Treasury Bond ETF", null));
    expect(classifyUs(info("TLT", "iShares 20+ Year Treasury Bond ETF", ""))).toEqual(a);
    expect(classifyUs(info("TLT", "iShares 20+ Year Treasury Bond ETF", "  "))).toEqual(a);
  });

  it("모르는 카테고리는 이름으로 분류하고, 감사 스크립트가 찾을 수 있게 미등록으로 보고한다", () => {
    expect(isKnownUsCategory("Some Brand New Category")).toBe(false);
    expect(isKnownUsCategory("Large Blend")).toBe(true);
    expect(isKnownUsCategory(null)).toBe(false);
    expect(classifyUs(info("GLD", "SPDR Gold Shares", "Some Brand New Category"))).toMatchObject({ assetClass: "commodity", theme: "금" });
  });
});

describe("classifyUs: 국내 분류기와 같은 한글 어휘", () => {
  it("같은 상품 유형은 국내 분류기와 같은 테마 문자열을 쓴다", () => {
    const us = (name: string, category: string | null) => classifyUs(info("TEST", name, category)).theme;
    expect(us("State Street SPDR S&P 500 ETF Trust", "Large Blend")).toBe(classify("TIGER 미국S&P500", 4).theme);
    expect(us("Invesco QQQ Trust", "Large Growth")).toBe(classify("TIGER 미국나스닥100", 4).theme);
    expect(us("VanEck Semiconductor ETF", "Technology")).toBe(classify("TIGER 미국필라델피아반도체나스닥", 4).theme);
    expect(us("SPDR Gold Shares", "Commodities Focused")).toBe(classify("ACE KRX금현물", 5).theme);
    expect(us("State Street SPDR Bloomberg 1-3 Month T-Bill ETF", "Ultrashort Bond")).toBe(classify("KODEX 머니마켓액티브", 7).theme);
    expect(us("iShares 20+ Year Treasury Bond ETF", "Long Government")).toBe(classify("TIGER 미국채10년선물", 6).theme);
    expect(us("iShares iBoxx $ High Yield Corporate Bond ETF", "High Yield Bond")).toBe(classify("TIGER 미국하이일드", 6).theme);
    expect(us("iShares TIPS Bond ETF", "Inflation-Protected Bond")).toBe(classify("KODEX 미국물가채", 6).theme);
    expect(us("iShares Core U.S. Aggregate Bond ETF", "Intermediate Core Bond")).toBe(classify("KODEX 종합채권(AA-이상)액티브", 6).theme);
    expect(us("iShares MSCI Japan ETF", "Japan Stock")).toBe(classify("TIGER 일본니케이225", 4).theme);
    expect(us("iShares MSCI Emerging Markets ETF", "Diversified Emerging Mkts")).toBe(classify("TIGER 신흥국MSCI", 4).theme);
    expect(us("VanEck Vietnam ETF", "Focused Region")).toBe(classify("TIGER 베트남VN30", 4).theme);
    expect(us("State Street SPDR Dow Jones Industrial Average ETF Trust", "Large Value")).toBe(classify("TIGER 미국다우존스30", 4).theme);
    expect(us("Vanguard Real Estate Index Fund ETF Shares", "Real Estate")).toBe(classify("TIGER 미국MSCI리츠(합성 H)", 4).theme);
    expect(us("Invesco CurrencyShares Japanese Yen Trust", "Single Currency")).toBe(classify("TIGER 일본엔선물", 7).theme);
    expect(us("iShares Lifepath Target Date 2040 ETF", "Target-Date 2040")).toBe(classify("KODEX TDF2050액티브", 7).theme);
  });

  it("표본 875개의 테마는 국내 어휘 또는 문서화된 신규 어휘 안에서만 나온다", () => {
    const SHARED = new Set([
      "반도체", "2차전지", "AI·빅테크", "로봇", "바이오·헬스케어", "방산·우주", "조선·해운", "원전·에너지", "전기차·자동차", "금융", "소비·미디어",
      "건설·산업재", "배당·가치", "스마트베타", "S&P500", "나스닥100", "나스닥 종합", "다우존스", "선진국(MSCI World)", "신흥국", "인도 Nifty50",
      "차이나 대표", "일본 대표", "베트남 대표", "귀금속", "은", "금", "원유", "팔라듐", "희토류", "구리", "농산물", "천연가스", "탄소배출권",
      "원자재 종합", "미국채", "회사채", "하이일드", "물가연동채", "종합채권", "단기채", "채권", "파킹·초단기", "TDF(생애주기)", "주식+채권 혼합",
      "자산배분", "인프라", "리츠", "달러", "엔화", "유로", "위안", "통화",
    ]);
    const NEW_VOCAB = new Set([
      "유틸리티", "금속·광업", "농업·식량", "혁신·신기술", "가상자산 관련주", "미국 소형주", "미국 중형주", "미국 대형주", "미국 전체시장",
      "선진국(미국 제외)", "인도 대표", "한국 대표", "대만 대표", "유럽 대표", "아시아(일본 제외)", "중남미 대표", "미국 지방채", "신흥국채", "글로벌채",
      "MBS·유동화채", "뱅크론", "전환사채", "백금", "산업금속", "스위스프랑", "파운드", "캐나다달러", "호주달러", "대체전략", "가상자산 종합",
      "비트코인", "이더리움", "솔라나", "XRP", "도지코인", "라이트코인", "카르다노", "수이", "아발란체", "체인링크", "폴카닷", "하이퍼리퀴드", "헤데라",
    ]);
    const unknown = new Set<string>();
    const used = new Set<string>();
    for (const r of sample) {
      const t = classifyUs({ symbol: r.s, name: r.name, category: r.cat, family: r.fam, legalType: r.legal });
      if (t.theme === null) continue;
      used.add(t.theme);
      // 국가 펀드("○○ 대표")는 나라마다 하나씩 생기므로 접미사로 판단한다.
      if (!SHARED.has(t.theme) && !NEW_VOCAB.has(t.theme) && !/ 대표$/.test(t.theme)) unknown.add(t.theme);
    }
    expect([...unknown]).toEqual([]);
    // 국내와 공유하는 핵심 어휘를 실제로 쓰고 있다(분류기가 전부 새 말만 쓰는 회귀를 막는다).
    for (const k of ["S&P500", "나스닥100", "반도체", "AI·빅테크", "바이오·헬스케어", "원전·에너지", "금융", "소비·미디어", "건설·산업재", "배당·가치", "스마트베타", "회사채", "하이일드", "미국채", "물가연동채", "종합채권", "단기채", "파킹·초단기", "금", "은", "원유", "리츠", "인프라"]) {
      expect(used.has(k), k).toBe(true);
    }
  });
});

describe("makeUsGroupKey / groupKey: 같은 지수는 같은 키, 구조가 다르면 다른 키", () => {
  const ALL = [...TABLE.map((r) => ({ s: r[0], name: r[1], cat: r[2] })), ...sample.map((r) => ({ s: r.s, name: r.name, cat: r.cat }))];
  const key = (symbol: string) => {
    const r = ALL.find((x) => x.s === symbol);
    if (!r) throw new Error(`테스트 데이터에 ${symbol} 이 없습니다`);
    return classifyUs(info(r.s, r.name, r.cat)).groupKey;
  };
  const keyOf = (symbol: string, name: string, category: string | null = null) => classifyUs(info(symbol, name, category)).groupKey;

  it("SPY·VOO·IVV·SPLG 는 같은 키(브랜드·Core·Portfolio·ETF·Trust 를 떼고 S&P 500 표기를 통일)", () => {
    const keys = ["SPY", "VOO", "IVV", "SPLG"].map(key);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("us:s&p500");
    // 표기만 다른 S&P 500
    expect(keyOf("X1", "Vanguard S&P500 ETF", "Large Blend")).toBe("us:s&p500");
    expect(keyOf("X2", "SPDR S&P 500 ETF Trust", "Large Blend")).toBe("us:s&p500");
    expect(keyOf("X3", "iShares S&P 500 Index Fund", "Large Blend")).toBe("us:s&p500");
  });

  it("같은 지수·같은 자산을 가리키는 ETF 끼리는 묶인다", () => {
    const SAME: string[][] = [
      ["QQQ", "QQQM"],
      ["GLD", "IAU", "GLDM"],
      ["IBIT", "FBTC", "GBTC"],
      ["IWM", "VTWO"],
      ["IJH", "MDY"],
      ["SLV", "PSLV"],
      ["UPRO", "SPXL"],
      ["SPXU", "SPXS"],
    ];
    for (const g of SAME) expect(new Set(g.map(key)).size, g.join()).toBe(1);
    // 같은 기초 종목·같은 배수의 단일 종목 상품은 운용사가 달라도 묶인다
    expect(keyOf("AAPB", "GraniteShares 2x Long AAPL Daily ETF")).toBe(keyOf("AAPU", "Direxion Daily AAPL Bull 2X ETF"));
    expect(keyOf("AAPB", "GraniteShares 2x Long AAPL Daily ETF")).toBe("us:aapl|x2");
  });

  it("레버리지 배수·인버스·커버드콜·동일가중·성장 같은 구조 차이는 다른 키", () => {
    const base = key("SPY");
    for (const other of ["UPRO", "SSO", "SPXU", "SDS", "XYLD", "RSP", "IJH", "QQQ", "DIA"]) expect(key(other), other).not.toBe(base);
    expect(keyOf("SPYG", "State Street SPDR Portfolio S&P 500 Growth ETF", "Large Growth")).not.toBe(base);
    expect(key("UPRO")).not.toBe(key("SSO")); // 3배 대 2배
    expect(key("UPRO")).not.toBe(key("SPXU")); // 3배 대 -3배
    expect(key("QQQ")).not.toBe(key("QYLD"));
    expect(key("QQQ")).not.toBe(key("TQQQ"));
    expect(key("QQQ")).not.toBe(key("SQQQ"));
    expect(key("TLT")).not.toBe(key("TMF"));
    expect(key("TMF")).not.toBe(key("TBF"));
  });

  it("현물과 선물, 환헤지 여부, 서로 다른 지수는 다른 키", () => {
    expect(key("IBIT")).not.toBe(key("BITO")); // 현물 대 선물
    expect(key("IBIT")).not.toBe(key("ETHA"));
    expect(key("GLD")).not.toBe(keyOf("DGL", "Invesco DB Gold Fund", "Commodities Focused")); // 신탁 대 선물 펀드
    expect(key("GLD")).not.toBe(key("GLTR"));
    expect(key("EFA")).not.toBe(key("EEM"));
    expect(key("SHY")).not.toBe(keyOf("VGSH", "Vanguard Short-Term Treasury Index Fund ETF Shares", "Short Government"));
    expect(key("SMH")).not.toBe(key("SOXX")); // 서로 다른 반도체 지수
  });

  it("지수 단서가 없는 액티브·전략 상품은 운용사가 다르면 같은 이름이어도 묶지 않는다", () => {
    const cp = [
      keyOf("JCPB", "JPMorgan Core Plus Bond ETF", "Intermediate Core-Plus Bond"),
      keyOf("FIXT", "TCW Core Plus Bond ETF", "Intermediate Core-Plus Bond"),
      keyOf("CRXP", "Columbia Core Plus Bond ETF Shares", "Intermediate Core-Plus Bond"),
      keyOf("CPLB", "NYLI MacKay Core Plus Bond ETF", "Intermediate Core-Plus Bond"),
    ];
    expect(new Set(cp).size).toBe(4);
    // 같은 운용사의 같은 이름(분리 클래스 등)은 묶인다
    expect(keyOf("A1", "Example Core Plus Bond ETF")).toBe(keyOf("A2", "Example Core Plus Bond ETF Shares"));
    expect(keyOf("CAML", "Congress Large Cap Growth ETF", "Large Growth")).not.toBe(keyOf("ACSG", "American Century Large Cap Growth ETF", "Large Growth"));
  });

  it("버퍼·목표수익 상품은 월·상한이 상품마다 다르므로 서로 묶지 않는다", () => {
    const apr = keyOf("PAPR", "Innovator U.S. Equity Power Buffer ETF - April", "Defined Outcome");
    const jul = keyOf("PJUL", "Innovator U.S. Equity Power Buffer ETF - July", "Defined Outcome");
    const ft = keyOf("FAPR", "FT Vest U.S. Equity Buffer ETF - April", "Defined Outcome");
    expect(new Set([apr, jul, ft]).size).toBe(3);
    // 이름이 잘려 월이 사라져도 서로 다른 티커는 다른 키다
    expect(keyOf("ZAPR", "Innovator ETFs Trust Innovator Equity Defined Protection ETF - 1 Yr A", "Defined Outcome")).not.toBe(
      keyOf("ZAUG", "Innovator ETFs Trust Innovator Equity Defined Protection ETF - 1 Yr A", "Defined Outcome"),
    );
  });

  it("키 형식: 'us:' 접두사, 소문자, 공백 없음, 이름이 비면 티커로 대체", () => {
    for (const r of ALL) {
      const k = classifyUs(info(r.s, r.name, r.cat)).groupKey;
      expect(k.startsWith("us:"), r.s).toBe(true);
      expect(k, r.s).toBe(k.toLowerCase());
      expect(/\s/.test(k), r.s).toBe(false);
    }
    expect(classifyUs(info("ZZZ", "ETF")).groupKey).toBe("us:zzz");
    expect(classifyUs(info("ZZZ", "")).groupKey).toBe("us:zzz");
  });

  it("표본 875개에서 묶이는 그룹은 아래 목록뿐이다(새로 묶이면 의도한 것인지 검토)", () => {
    const groups = new Map<string, string[]>();
    for (const r of sample) {
      const t = classifyUs({ symbol: r.s, name: r.name, category: r.cat, family: r.fam, legalType: r.legal });
      groups.set(t.groupKey, [...(groups.get(t.groupKey) ?? []), r.s]);
    }
    const merged = Object.fromEntries([...groups].filter(([, v]) => v.length > 1).map(([k, v]) => [k, v.sort()]));
    expect(merged).toEqual({
      "us:s&p500": ["IVV", "SPY", "SPYM", "VOO"],
      "us:bitcoin": ["FBTC", "GBTC", "IBIT"],
      "us:msciemergingmarkets": ["EEM", "IEMG"],
      "us:gold": ["GLD", "IAU"],
      "us:s&pmidcap400": ["IJH", "MDY"],
      "us:silver": ["PSLV", "SLV"],
      "us:nasdaq100": ["QQQ", "QQQM"],
      "us:s&p500|x-3": ["SPXS", "SPXU"],
    });
  });
});

describe("brand: 이름의 앞부분 접두사", () => {
  it("여러 단어 브랜드를 목록으로 처리하고, 없으면 첫 단어", () => {
    const cases: [string, string][] = [
      ["State Street SPDR S&P 500 ETF Trust", "State Street SPDR"],
      ["State Street Technology Select Sector SPDR ETF", "State Street"],
      ["Global X NASDAQ 100 Covered Call ETF", "Global X"],
      ["First Trust Nasdaq BuyWrite Income ETF", "First Trust"],
      ["FT Vest U.S. Equity Max Buffer ETF - July", "FT Vest"],
      ["T. Rowe Price Technology ETF", "T. Rowe Price"],
      ["Goldman Sachs Access Treasury 0-1 Year ETF", "Goldman Sachs"],
      ["JPMorgan Equity Premium Income ETF", "JPMorgan"],
      ["Jpmorgan 100% U.S. Treasury Securities Money Market ETF", "Jpmorgan"],
      ["Leverage Shares 2X Long ARM Daily ETF", "Leverage Shares"],
      ["Vanguard S&P 500 ETF", "Vanguard"],
      ["iShares Core S&P 500 ETF", "iShares"],
      ["Schwab U.S. Dividend Equity ETF", "Schwab"],
      ["Fidelity Wise Origin Bitcoin Fund", "Fidelity"],
      ["ProShares UltraPro QQQ", "ProShares"],
      ["Direxion Daily Semiconductor Bull 3X Shares", "Direxion"],
      ["WisdomTree Europe Hedged Equity Fund", "WisdomTree"],
      ["VanEck Semiconductor ETF", "VanEck"],
      ["Roundhill Magnificent Seven Covered Call ETF", "Roundhill"],
      ["Invesco QQQ Trust", "Invesco"],
      ["YieldMax(TM) RBLX Option Income Strategy ETF", "YieldMax(TM)"],
      ["Unknownbrand Fancy Strategy ETF", "Unknownbrand"],
      ["Tidal Trust II YieldMax Short NVDA Option Income Strategy ETF", "Tidal Trust II"],
      ["Tidal ETF Trust - Sound Equity Income ETF", "Tidal ETF Trust -"],
      ["J P Morgan Exchange-Traded Fund Trust - Limited Duration Bond ETF", "J P Morgan"],
    ];
    for (const [name, brand] of cases) expect(extractUsBrand(name), name).toBe(brand);
  });

  it("브랜드를 뗀 나머지가 화면에 쓸 수 있는 상품명이다(name.slice(brand.length + 1))", () => {
    const rest = (n: string) => n.slice(extractUsBrand(n).length + 1);
    expect(rest("State Street SPDR S&P 500 ETF Trust")).toBe("S&P 500 ETF Trust");
    expect(rest("Tidal ETF Trust - Sound Equity Income ETF")).toBe("Sound Equity Income ETF");
    expect(rest("Global X Uranium ETF")).toBe("Uranium ETF");
  });

  it("브랜드가 없는 이름(배수로 시작, 한 단어, 앞 공백)은 빈 문자열", () => {
    expect(extractUsBrand("2x Cardano ETF")).toBe("");
    expect(extractUsBrand("Bitcoin")).toBe("");
    expect(extractUsBrand("")).toBe("");
    expect(extractUsBrand("  Leading Space ETF")).toBe("");
  });

  it("불변식: 표본 875개 모두 브랜드가 이름의 접두사이고 뒤에 상품명이 남는다", () => {
    expect(sample.length).toBe(875);
    for (const r of sample) {
      const t = classifyUs({ symbol: r.s, name: r.name, category: r.cat, family: r.fam, legalType: r.legal });
      if (t.brand === "") continue;
      expect(r.name.startsWith(t.brand), `${r.s}: ${r.name}`).toBe(true);
      expect(/\s/.test(r.name.charAt(t.brand.length)), `${r.s}: ${r.name}`).toBe(true);
      expect(r.name.slice(t.brand.length + 1).trim().length, r.s).toBeGreaterThan(0);
    }
    // 브랜드가 비는 이름은 극소수여야 한다
    const empty = sample.filter((r) => classifyUs({ symbol: r.s, name: r.name, category: r.cat, family: r.fam, legalType: r.legal }).brand === "");
    expect(empty.length).toBeLessThanOrEqual(3);
  });
});

describe("표본 875개 전체 불변식", () => {
  const ALLOWED_TAGS: readonly string[] = ["leveraged", "inverse", "covered-call", "synthetic", "active", "total-return", "dividend", "concentrated", "futures", "defined-outcome", "volatility"];
  const results = sample.map((r) => ({ r, t: classifyUs({ symbol: r.s, name: r.name, category: r.cat, family: r.fam, legalType: r.legal }) }));

  it("모든 모닝스타 카테고리를 알고 있다", () => {
    const unknown = [...new Set(sample.map((r) => r.cat).filter((c): c is string => c !== null && !isKnownUsCategory(c)))];
    expect(unknown).toEqual([]);
  });

  it("태그는 허용된 목록뿐이고 hedged 는 없다", () => {
    for (const { r, t } of results) {
      for (const g of t.tags) expect(ALLOWED_TAGS, `${r.s} ${g}`).toContain(g);
      expect(t.tags, r.s).not.toContain("hedged");
      expect(new Set(t.tags).size, r.s).toBe(t.tags.length);
    }
  });

  it("leverage 와 leveraged·inverse 태그가 서로 일치한다", () => {
    for (const { r, t } of results) {
      expect(Number.isFinite(t.leverage), r.s).toBe(true);
      expect(t.tags.includes("leveraged"), `${r.s} ${t.leverage}`).toBe(t.leverage > 1);
      expect(t.tags.includes("inverse"), `${r.s} ${t.leverage}`).toBe(t.leverage < 0);
    }
  });

  it("자산군·지역 계약: kr-equity 없음, 원자재·통화·가상자산은 지역 NA, 그 밖에는 NA 가 아님", () => {
    for (const { r, t } of results) {
      expect(t.assetClass, r.s).not.toBe("kr-equity");
      const noRegion = t.assetClass === "commodity" || t.assetClass === "fx" || t.assetClass === "crypto";
      expect(t.region === "NA", `${r.s} ${t.assetClass}/${t.region}`).toBe(noRegion);
      expect(["US", "CN", "JP", "IN", "VN", "EU", "GLOBAL", "KR", "NA"], r.s).toContain(t.region);
    }
  });

  it("분류 결과의 모양: 테마는 문자열 또는 null, broad 는 테마가 있을 때만 true", () => {
    for (const { r, t } of results) {
      expect(t.theme === null || (typeof t.theme === "string" && t.theme.length > 0), r.s).toBe(true);
      if (t.theme === null) expect(t.broad, r.s).toBe(false);
    }
  });

  it("카테고리 기준 자산군이 상식과 맞는다", () => {
    for (const { r, t } of results) {
      if (r.cat && /Bond|Government|Muni|Inflation-Protected|Bank Loan|Mortgage|Securitized/.test(r.cat) && !r.cat.startsWith("Trading--")) {
        expect(["bond", "cash"], `${r.s} ${r.cat}`).toContain(t.assetClass);
      }
      if (r.cat === "Digital Assets") expect(t.assetClass, r.s).toBe("crypto");
      if (r.cat && /^(?:Large|Mid-Cap|Small) /.test(r.cat)) expect(t.assetClass, r.s).toBe("global-equity");
      if (r.cat === "Ultrashort Bond") expect(t.assetClass, r.s).toBe("cash");
      if (r.cat === "Defined Outcome") expect(t.tags, r.s).toContain("defined-outcome");
      if (r.cat === "Derivative Income") expect(t.tags, r.s).toContain("covered-call");
    }
  });

  it("카테고리를 지워도(이름만으로) 폭넓게 같은 자산군이 나온다", () => {
    let same = 0;
    for (const { r, t } of results) {
      const n = classifyUs({ symbol: r.s, name: r.name, category: null, family: null, legalType: null });
      if (n.assetClass === t.assetClass) same++;
    }
    // 카테고리가 알려 주는 정보(자산배분·대체전략·초단기채 등)를 이름만으로는 알 수 없는 경우를 감안한 하한
    expect(same / sample.length).toBeGreaterThan(0.92);
  });
});

describe("견고성: 이상한 입력에도 계약을 지킨다", () => {
  const weird = ["", " ", "ETF", "A", "!!!", "2x", "-3x", "Trust", "The Fund", "a".repeat(5000), "S&P 500 ".repeat(300), "ÉTF 日本 ETF", "\t\n"];
  it.each(weird.map((n) => [n.slice(0, 20)] as const))("이름 %j", (short) => {
    const name = weird.find((w) => w.slice(0, 20) === short) ?? short;
    const t = classifyUs(info("ZZ", name, null));
    expect(t.groupKey.startsWith("us:")).toBe(true);
    expect(Number.isFinite(t.leverage)).toBe(true);
    expect(t.assetClass).toBeTruthy();
    expect(t.brand === "" || name.startsWith(t.brand)).toBe(true);
  });

  it("ETN 이름도 분류는 된다(수집 단계에서 제외되는 것은 다른 담당)", () => {
    const t = classifyUs(info("JETU", "MAX Airlines 3X Leveraged ETN", "Trading--Leveraged Equity"));
    expect(t).toMatchObject({ assetClass: "global-equity", leverage: 3 });
  });
});

describe("singleStockUnderlying", () => {
  it("개별 종목 상품에서 기초 종목을 뽑고, 섹터·지수·바스켓 상품에서는 null", () => {
    expect(singleStockUnderlying("Tradr 2X Long AAOI Daily ETF")).toBe("AAOI");
    expect(singleStockUnderlying("Direxion Daily ASML Bull 2X ETF")).toBe("ASML");
    expect(singleStockUnderlying("YieldMax AAPL Option Income Strategy ETF")).toBe("AAPL");
    expect(singleStockUnderlying("Roundhill AMD WeeklyPay ETF")).toBe("AMD");
    expect(singleStockUnderlying("T-Rex 2X Long Microsoft Daily Target ETF")).toBe("Microsoft");
    expect(singleStockUnderlying("Kurv Yield Premium Strategy Apple ETF")).toBe("Apple");
    expect(singleStockUnderlying("Direxion Daily Semiconductor Bull 3X Shares")).toBeNull();
    expect(singleStockUnderlying("ProShares UltraPro QQQ")).toBeNull();
    expect(singleStockUnderlying("Direxion Daily Gold Miners Index Bull 2X Shares")).toBeNull();
    expect(singleStockUnderlying("Direxion Daily Magnificent 7 Bear 1X ETF")).toBeNull();
    expect(singleStockUnderlying("Corgi Taiwan 2x Daily ETF")).toBeNull();
    expect(singleStockUnderlying("Roundhill Magnificent Seven Covered Call ETF")).toBeNull();
    expect(singleStockUnderlying("SPDR Gold Shares")).toBeNull();
  });
});
