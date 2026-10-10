import type { AssetClass, Region, StructureTag, Taxonomy } from "./types";

/**
 * 해외(미국) 상장 ETF 분류기.
 *
 * 입력은 미국 상장 ETF 한 종목의 원천 정보(영문 이름과 모닝스타 카테고리 등)이고, 출력은 국내 ETF와 같은
 * `Taxonomy` 입니다. 국내 분류기(taxonomy.ts)와 같은 한글 어휘(테마·채권 종류 등)를 써서 화면 필터가 국내와
 * 해외를 한 목록에서 함께 걸러내도록 합니다. 국내에 없는 말(가상자산·유틸리티 등)만 같은 톤으로 새로 둡니다.
 *
 * 근거의 순서: ① 모닝스타 카테고리(자산군·지역의 1차 근거) → ② 영문 이름 규칙(테마·구조 태그, 카테고리가
 * 없을 때는 자산군까지). 이름만으로도 합리적으로 동작해야 하므로(카테고리 null) 두 근거는 서로의 폴백입니다.
 *
 * "hedged" 태그는 일부러 붙이지 않습니다. 해외 ETF 이름의 "Hedged"는 달러 기준 환헤지라서, 원화 투자자에게는
 * 환헤지가 아니기 때문에 "환헤지 상품" 문구가 사실과 달라집니다(이름의 Hedged 는 groupKey 에는 남아 서로
 * 다른 상품으로 구분됩니다).
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

// ───────── 이름 정리 · 브랜드 ─────────

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 상표 기호·유니코드 하이픈·중복 공백을 정리한다. */
const clean = (s: string) =>
  s
    .replace(/[®™℠]|\((?:R|TM|SM)\)/g, " ")
    .replace(/[‐-―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

/**
 * 나스닥 목록의 이름은 신탁(트러스트) 이름이 앞에 붙기도 한다("Tidal Trust II YieldMax …").
 * 신탁 이름도 이름의 앞부분 접두사이므로 브랜드로 취급해 그 뒤의 상품명이 화면에 깔끔하게 남게 한다.
 * 뒤에 로마 숫자(II, III …)가 붙는 경우를 허용한다.
 */
const WRAPPERS = [
  "Corgi ETF Trust", "Innovator ETFs Trust", "Tidal Trust", "Tidal ETF Trust", "iShares Trust", "iShares Inc.", "iShares Inc",
  "ETF Opportunities Trust", "Investment Managers Series Trust", "EA Series Trust", "AIM ETF Products Trust", "Themes ETF Trust",
  "Calamos ETF Trust", "Harbor ETF Trust", "Roundhill ETF Trust", "Northern Lights Fund Trust", "ETF Series Solutions",
  "Dimensional ETF Trust", "Simplify Exchange Traded Funds", "ProShares Trust", "J.P. Morgan Exchange-Traded Fund Trust",
  "Amplify ETF Trust", "American Century ETF Trust", "AB Active ETFs Inc.", "BondBloxx ETF Trust", "VanEck ETF Trust",
  "The 2023 ETF Series Trust", "PGIM ETF Trust", "PGIM Rock ETF Trust", "Morgan Stanley ETF Trust",
  "T. Rowe Price Exchange-Traded Funds Inc.", "Spinnaker ETF Series", "John Hancock Exchange-Traded Fund Trust",
  "Exchange Traded Concepts Trust", "Virtus ETF Trust", "The RBB Fund Trust", "Exchange Listed Funds Trust", "Pacer Funds Trust",
  "Putnam ETF Trust", "Direxion Shares ETF Trust", "Elevation Series Trust", "Fidelity Covington Trust", "Listed Funds Trust",
  "Goldman Sachs ETF Trust", "NEOS ETF Trust", "MFS Active Exchange Traded Funds Trust", "Invesco Exchange-Traded Fund Trust",
  "Invesco Actively Managed Exchange-Traded Fund Trust", "Precidian ETFs Trust", "Volatility Shares Trust",
  "Federated Hermes ETF Trust", "Janus Detroit Street Trust", "DoubleLine ETF Trust", "The Advisors Inner Circle Fund",
  "The Advisors' Inner Circle Fund", "BlackRock ETF Trust", "Allspring Exchange-Traded Funds Trust", "First Trust Exchange-Traded Fund",
  "Global X Funds", "Kurv ETF Trust", "BNY Mellon ETF Trust", "Trust for Professional Managers", "Managed Portfolio Series",
  "Advisor Managed Portfolios", "Capital Group Equity ETF Trust", "Franklin Templeton ETF Trust", "Cambria ETF Trust",
];
/** 브랜드 바로 뒤에 붙는 상표 기호("YieldMax(TM)")는 브랜드의 일부로 본다. */
const MARK = "(?:\\((?:R|TM|SM)\\)|[®™℠])?";
const WRAPPER_RES = WRAPPERS.map((w) => new RegExp(`^${esc(w)}${MARK}(?: (?:I{1,3}|IV|V|VI|VII|VIII))?(?= |$)`, "i"));

/**
 * 여러 단어이거나 첫 단어만으로는 브랜드가 안 되는 이름 + 자주 나오는 한 단어 브랜드.
 * 목록에 없으면 이름의 첫 단어를 브랜드로 쓴다. 한 단어 브랜드는 groupKey 에서 브랜드를 떼어낼 때 필요하다.
 */
const BRANDS = [
  "State Street SPDR", "State Street", "SPDR", "Global X", "First Trust", "FT Vest", "T. Rowe Price", "J.P. Morgan", "JPMorgan",
  "Goldman Sachs", "American Century", "Capital Group", "John Hancock", "BNY Mellon", "Morgan Stanley", "Franklin Templeton",
  "Janus Henderson", "Cohen & Steers", "Northern Trust", "Leverage Shares", "Volatility Shares", "Alpha Architect",
  "Federated Hermes", "Neuberger Berman", "Baillie Gifford", "Brown Advisory", "Eaton Vance", "Guinness Atkinson", "Matthews Asia",
  "Motley Fool", "Strategy Shares", "Overlay Shares", "Russell Investments", "Bank of Montreal", "Return Stacked", "Unusual Whales",
  "iShares", "Invesco", "Innovator", "ProShares", "Tidal", "Direxion", "Vanguard", "Corgi", "GraniteShares", "WisdomTree", "VanEck",
  "Fidelity", "PGIM", "Franklin", "Pacer", "Roundhill", "Themes", "Defiance", "Amplify", "Harbor", "Simplify", "Calamos", "Xtrackers",
  "Dimensional", "Schwab", "KraneShares", "Tradr", "Virtus", "VictoryShares", "ALPS", "PIMCO", "Columbia", "BondBloxx", "NEOS",
  "Cambria", "Janus", "Nuveen", "Sprott", "Grayscale", "Bitwise", "21Shares", "AdvisorShares", "Hartford", "AllianzIM", "Avantis",
  "TrueShares", "Putnam", "Kurv", "BlackRock", "ETRACS", "Principal", "TCW", "Matthews", "ARK", "abrdn", "SEI", "MFS",
  "DoubleLine", "Tema", "Touchstone", "Precidian", "DFA", "Nomura", "MicroSectors", "Allspring", "Gabelli", "Yorkville", "REX",
  "T-REX", "YieldMax", "USCF", "Teucrium", "iPath", "Canary", "Rex", "Aberdeen", "Innovator ETFs", "AB", "Lazard", "Baron",
  "Thornburg", "Zacks", "Northern", "Nicholas", "Horizon", "Dana", "Congress", "NYLI", "NYLIM", "Natixis", "Thrivent", "Davis",
  "Pictet", "Legg Mason", "Madison", "Man", "CoinShares", "Hennessy", "Cboe", "Vident", "Goldman", "United States", "U.S. Global",
  "J P Morgan", "Wise Origin", "Galaxy", "Invesco Galaxy", "xETFs", "XFUNDS", "Quadratic",
];
const BRAND_RES = [...new Set(BRANDS)]
  .sort((a, b) => b.length - a.length)
  .map((b) => new RegExp(`^${esc(b)}${MARK}(?= |$)`, "i"));

/** 이름 앞쪽의 신탁 이름 또는 브랜드를 찾아 그 길이를 돌려준다(없으면 0). */
function prefixLength(n: string): number {
  for (const r of WRAPPER_RES) {
    const m = r.exec(n);
    if (m) return m[0].length;
  }
  for (const r of BRAND_RES) {
    const m = r.exec(n);
    if (m) return m[0].length;
  }
  return 0;
}

/**
 * 이름의 앞부분 접두사를 브랜드로 돌려준다. 화면은 `name.slice(brand.length + 1)` 로 브랜드를 떼므로
 * 반드시 원래 이름의 접두사(대소문자·공백 그대로)여야 하고, 접두사가 곧 이름 전체이면 안 된다.
 */
export function extractUsBrand(name: string): string {
  const len = prefixLength(name);
  if (len > 0 && len < name.length) {
    // "Tidal ETF Trust - Sound Equity Income ETF" 처럼 신탁 이름 뒤에 " - " 가 오면 하이픈까지 브랜드로 두어 뒷부분이 깔끔히 남게 한다.
    const dash = /^ -(?= )/.exec(name.slice(len));
    return name.slice(0, len + (dash ? dash[0].length : 0));
  }
  const i = name.search(/\s/);
  const first = i > 0 ? name.slice(0, i) : "";
  // "2x Cardano ETF" 의 "2x" 는 브랜드가 아니다.
  return MULT_RE.test(first) ? "" : first;
}

/**
 * 신탁 이름·브랜드를 앞에서부터 최대 3번 떼어낸 본문과, 떼어낸 브랜드(소문자·영숫자만).
 * 분류 규칙은 브랜드 낱말("Innovator", "Global X" …)에 걸리지 않게 이 본문에 건다.
 */
function stripBrands(n: string): { body: string; brand: string } {
  let s = n;
  let brand = "";
  for (let i = 0; i < 3; i++) {
    const len = prefixLength(s);
    if (len === 0 || len >= s.length) break;
    brand += s.slice(0, len).toLowerCase().replace(/[^a-z0-9]/g, "");
    s = s.slice(len).replace(/^[\s\-:]+/, "");
  }
  return { body: s, brand };
}

// ───────── 모닝스타 카테고리 ─────────

type Cls = "equity" | "bond" | "cash" | "commodity" | "multi" | "real-asset" | "fx" | "crypto";

interface CatRule {
  re: RegExp;
  cls: Cls;
  /** 카테고리가 알려주는 지역(이름에 더 구체적인 지역이 있으면 이름이 이긴다) */
  region?: Region;
  /** 이름에서 테마를 못 찾았을 때 쓰는 폴백 테마 */
  theme?: string;
  /** 폴백 테마가 광범위 지수 이름인지 */
  broad?: boolean;
  /** 채권: 카테고리의 테마가 이름보다 우선(종합채권처럼 이름이 오히려 오해를 부르는 경우) */
  catFirst?: boolean;
}

/** 먼저 맞는 규칙이 이긴다. 목록에 없는 카테고리는 isKnownUsCategory 가 false 를 돌려준다(감사 스크립트가 보고). */
const CATEGORY_RULES: CatRule[] = [
  // 가상자산
  { re: /^Digital Assets$/, cls: "crypto" },
  { re: /^Equity Digital Assets$/, cls: "equity", theme: "가상자산 관련주" },
  // 레버리지·인버스: 기초자산에 따라 자산군이 갈린다
  { re: /^Trading--(?:Leveraged|Inverse) Debt$/, cls: "bond", theme: "미국채" },
  { re: /^Trading--(?:Leveraged|Inverse) Commodities$/, cls: "commodity" },
  { re: /^Trading--(?:Leveraged|Inverse) Equity$/, cls: "equity" },
  { re: /^Trading--Miscellaneous$/, cls: "equity" },
  { re: /^Trading--/, cls: "equity" },
  // 원자재·통화
  { re: /^Commodities /, cls: "commodity" },
  { re: /^(?:Single Currency|Multi-?currency)$/i, cls: "fx" },
  // 현금성
  { re: /^Ultrashort Bond$/, cls: "cash", region: "US" },
  { re: /^Money Market/, cls: "cash", region: "US" },
  // 채권
  { re: /^Bank Loan$/, cls: "bond", region: "US", theme: "뱅크론" },
  { re: /^Corporate Bond$/, cls: "bond", region: "US", theme: "회사채" },
  { re: /^High Yield Bond$/, cls: "bond", region: "US", theme: "하이일드" },
  { re: /^High Yield Muni$/, cls: "bond", region: "US", theme: "미국 지방채" },
  { re: /^Muni /, cls: "bond", region: "US", theme: "미국 지방채" },
  { re: /^Inflation-Protected Bond$|^Short-Term Inflation-Protected Bond$/, cls: "bond", region: "US", theme: "물가연동채" },
  { re: /^(?:Long|Intermediate|Short) Government$/, cls: "bond", region: "US", theme: "미국채" },
  { re: /^Intermediate Core Bond$|^Intermediate Core-Plus Bond$|^Long-Term Bond$|^Intermediate-Term Bond$|^Multisector Bond$/, cls: "bond", region: "US", theme: "종합채권", catFirst: true },
  { re: /^Short-Term Bond$/, cls: "bond", region: "US", theme: "단기채" },
  { re: /^Nontraditional Bond$/, cls: "bond", region: "US", theme: "채권" },
  { re: /^Target Maturity$/, cls: "bond", region: "US", theme: "채권" },
  { re: /^Government Mortgage-Backed Bond$|^Securitized Bond/, cls: "bond", region: "US", theme: "MBS·유동화채" },
  { re: /^Emerging Markets Bond$|^Emerging-Markets Local-Currency Bond$/, cls: "bond", region: "GLOBAL", theme: "신흥국채" },
  { re: /^Global Bond/, cls: "bond", region: "GLOBAL", theme: "글로벌채" },
  { re: /^World Bond/, cls: "bond", region: "GLOBAL", theme: "글로벌채" },
  { re: /^Convertibles$/, cls: "bond", region: "US", theme: "전환사채" },
  // 혼합자산·대체전략
  { re: /^Target-Date|^Target Date/, cls: "multi", region: "GLOBAL", theme: "TDF(생애주기)" },
  { re: /^Global (?:Moderately )?(?:Aggressive|Moderate|Conservative) Allocation$|^Global Allocation$/, cls: "multi", region: "GLOBAL", theme: "주식+채권 혼합" },
  { re: /^(?:Aggressive|Moderately Aggressive|Moderate|Moderately Conservative|Conservative) Allocation$/, cls: "multi", region: "US", theme: "주식+채권 혼합" },
  { re: /^Tactical Allocation$|^Miscellaneous Allocation$|^Multi-Asset Overlay$|^Allocation--/, cls: "multi", region: "US", theme: "자산배분" },
  { re: /^(?:Systematic Trend|Macro Trading|Multistrategy|Event Driven|Multialternative|Managed Futures)$/, cls: "multi", region: "GLOBAL", theme: "대체전략" },
  { re: /^(?:Long-Short Equity|Market Neutral|Options Trading)$/, cls: "multi", region: "US", theme: "대체전략" },
  // 리츠·인프라
  { re: /^Real Estate$/, cls: "real-asset", region: "US", theme: "리츠" },
  { re: /^Global Real Estate$/, cls: "real-asset", region: "GLOBAL", theme: "리츠" },
  { re: /^Infrastructure$/, cls: "real-asset", theme: "인프라" },
  // 전략형 주식
  { re: /^Defined Outcome$|^Derivative Income$|^Equity Hedged$/, cls: "equity", region: "US" },
  { re: /^Preferred Stock$/, cls: "equity", region: "US", theme: "배당·가치" },
  // 해외 주식
  { re: /^Diversified Emerging Mkts$/, cls: "equity", region: "GLOBAL", theme: "신흥국" },
  { re: /^Europe Stock$/, cls: "equity", region: "EU", theme: "유럽 대표" },
  { re: /^Japan Stock$/, cls: "equity", region: "JP", theme: "일본 대표" },
  { re: /^Greater China Region$|^China Region$/, cls: "equity", region: "CN", theme: "차이나 대표" },
  { re: /^India Equity$/, cls: "equity", region: "IN", theme: "인도 대표" },
  { re: /^Pacific\/Asia ex-Japan Stk$/, cls: "equity", region: "GLOBAL", theme: "아시아(일본 제외)" },
  { re: /^Diversified Pacific\/Asia$/, cls: "equity", region: "GLOBAL", theme: "아시아(일본 제외)" },
  { re: /^Latin America Stock$/, cls: "equity", region: "GLOBAL", theme: "중남미 대표" },
  { re: /^Foreign /, cls: "equity", region: "GLOBAL", theme: "선진국(미국 제외)" },
  { re: /^(?:Global|World) (?:Large-Stock|Small\/Mid Stock)|^(?:Global|World) Small\/Mid Stock$/, cls: "equity", region: "GLOBAL", theme: "선진국(MSCI World)" },
  { re: /^(?:Miscellaneous Region|Focused Region)$/, cls: "equity", region: "GLOBAL" },
  // 미국 주식(규모·스타일)
  { re: /^Large Blend$/, cls: "equity", region: "US" },
  { re: /^Mid-Cap Blend$/, cls: "equity", region: "US", theme: "미국 중형주" },
  { re: /^Small Blend$/, cls: "equity", region: "US", theme: "미국 소형주" },
  { re: /^(?:Large|Mid-Cap|Small) Value$/, cls: "equity", region: "US", theme: "배당·가치" },
  { re: /^(?:Large|Mid-Cap|Small) Growth$/, cls: "equity", region: "US", theme: "스마트베타" },
  // 섹터
  { re: /^Technology$/, cls: "equity", region: "US", theme: "AI·빅테크" },
  { re: /^Communications$/, cls: "equity", region: "US", theme: "소비·미디어" },
  { re: /^Health$/, cls: "equity", region: "US", theme: "바이오·헬스케어" },
  { re: /^Financial$/, cls: "equity", region: "US", theme: "금융" },
  { re: /^Consumer (?:Cyclical|Defensive)$/, cls: "equity", region: "US", theme: "소비·미디어" },
  { re: /^Industrials$/, cls: "equity", region: "US", theme: "건설·산업재" },
  { re: /^Utilities$/, cls: "equity", region: "US", theme: "유틸리티" },
  { re: /^Equity Energy$|^Energy Limited Partnership$/, cls: "equity", region: "US", theme: "원전·에너지" },
  { re: /^Natural Resources$|^Equity Precious Metals$/, cls: "equity", region: "GLOBAL", theme: "금속·광업" },
  { re: /^Miscellaneous Sector$/, cls: "equity", region: "US" },
];

function categoryRule(cat: string | null): CatRule | null {
  if (!cat) return null;
  return CATEGORY_RULES.find((r) => r.re.test(cat)) ?? null;
}

/** 분류기가 아는 모닝스타 카테고리인지(감사 스크립트가 "카테고리 미매핑"을 찾는 데 쓴다). */
export const isKnownUsCategory = (cat: string | null): boolean => categoryRule(cat) !== null;

// ───────── 구조 태그 ─────────

/** "2X", "-3x", "1.5X", "2xMonthly" 같은 배수 표기. 숫자 앞이 낱말 문자·점이면 제외(예: "21Shares", "10x Genomics"). */
const MULT_RE = /(?<![\w.])(-?)(\d(?:\.\d{1,2})?)\s?[xX](?![a-z])/;
const INVERSE_WORDS = /\b(?:Inverse|Bear|Bearish)\b|\bUltraPro\s+Short\b|\bUltraShort\b(?!\s+(?:Income|Bond|Duration|Municipal|Fixed|Credit|Maturity|Securities|Investment|Opportunit))/i;
/** 채권·전략 이름에 흔한 "Short Term", "Short Duration" 은 인버스가 아니다. */
const SHORT_NOT_INVERSE = "Term|Duration|Maturity|Treasur|Government|Corporate|Muni|Bond|Credit|Income|Investment|TIPS|Dated|Interest";
/** "Short" 단독어. Short-Term·Short Duration·Long/Short 같은 채권·전략 이름은 제외한다. */
const SHORT_WORD = new RegExp(`(?<![/\\w-])(?<!Long )Short(?![\\w-])(?!\\s+(?:${SHORT_NOT_INVERSE}))`);
/** 브랜드 바로 뒤에 오는 "Short ProShares Short S&P500" 식 인버스 */
const STARTS_SHORT = new RegExp(`^Short\\s+(?!(?:${SHORT_NOT_INVERSE}))`);
const VIX_RE = /\bVIX\b|VIX(?=[A-Z])|Volatility Premium|Volatility Index/i;
const TAIL_HEDGE_RE = /Tail Risk|Tail Hedge|Black ?Swan/i;

/**
 * 레버리지 배수(음수는 인버스). 이름의 배수 표기가 1순위, 그다음 ProShares 식 이름(Ultra=2, UltraPro=3, UltraShort=-2,
 * Short=-1), 마지막으로 카테고리(Trading--Leveraged 는 2, Trading--Inverse 는 -1)를 쓴다.
 */
function detectLeverage(n: string, body: string, cat: string | null): number {
  const mm = MULT_RE.exec(body);
  const catLev = cat?.startsWith("Trading--Leveraged") ?? false;
  // 꼬리위험(Tail Risk) 상품은 풋옵션으로 하락에 대비하는 상품이라 -1배 인버스가 아니다.
  const catInv = (cat?.startsWith("Trading--Inverse") ?? false) && !TAIL_HEDGE_RE.test(n);
  const proshares = /^ProShares\b/i.test(n) || /^(?:Ultra|UltraPro|UltraShort)\b/i.test(body);

  // 변동성 선물 상품은 운용 배수가 이름과 다르다(2018년 이후 ProShares Ultra VIX 1.5배, Short VIX -0.5배).
  if (VIX_RE.test(body) && !mm) {
    if (proshares && /\bUltra\b/i.test(body)) return 1.5;
    if (proshares && SHORT_WORD.test(body)) return -0.5;
    return 1;
  }

  let mag: number | null = mm ? Number(mm[2]) : null;
  let sign = mm && mm[1] === "-" ? -1 : 1;
  if (INVERSE_WORDS.test(body) || (mm !== null && SHORT_WORD.test(body)) || STARTS_SHORT.test(body) || (catInv && mag === null)) {
    sign = -1;
  }
  if (mag === null) {
    if (/\bUltraPro\b/i.test(body)) mag = 3;
    else if (/\bUltraShort\b/i.test(body) && sign === -1) mag = 2;
    else if (proshares && /\bUltra\b(?![- ]?Short)/i.test(body)) mag = 2;
    else if (sign === -1) mag = 1;
    else if (catLev) mag = 2;
  }
  if (mag === null || (mag === 1 && sign === 1)) return 1;
  return sign * mag;
}

const COVERED_CALL_RE =
  /Covered[- ]Call|Buy[- ]?Write|Premium Income|Option(?:s)? Income|Options? Strategy|YieldMax|YieldBOOST|Yield Premium|Put[- ]?Write|Call Overwrit|Equity Premium|Premium Yield|Daily Income|Income Target|LightningSpread|Autocallable/i;
/** 이 운용사들의 "Enhanced Income"·"High Income" 상품은 옵션 프리미엄 전략이다. */
const OPTION_INCOME_BRAND = /^(?:Kurv|NEOS)\b/i;
const DEFINED_OUTCOME_RE =
  /Buffer|Accelerat|\bFloor\b|Defined (?:Outcome|Protection|Wealth)|Structured (?:Alt(?:ernative)? )?(?:Protection|Outcome)|Barrier|Dual Directional|Collar/i;
const DIVIDEND_RE = /Dividend|\bDivs?\b|Aristocrat|Achievers|Equity Income/i;
const CONCENTRATED_RE = /Concentrated|ADRhedged|\bTop\s?[1-5]\b(?!\d)/i;

// ───────── 자산군 ─────────

const CRYPTO_COIN = /\b(?:Bitcoin|Ether(?:eum)?|Solana|XRP|Ripple|Dogecoin|Litecoin|Cardano|Avalanche|Chainlink|Polkadot|Sui|Hyperliquid|Hedera|Stellar|Cryptocurrency|Crypto)\b/i;
/** 가상자산 이름이 들어 있어도 기업 주식이면 가상자산 관련주다. */
const CRYPTO_EQUITY = /Miners?|Mining|Equity|Stocks?|Compan(?:y|ies)|Corporations?|Industry|Economy|Blockchain|Standard|Operators|Innovators/i;
const TBILL_RE = /T-?Bills?\b|Treasury Bills?\b|\b[0-3]-[1-3] Months?\b|\b(?:3|6|12) Months?\b|Six Month|Money Market|Ultra[- ]Short|Floating Rate Treasury|Cash Management/i;
const MUNI_RE = /Muni(?:cipal)?s?\b|Tax[- ]Exempt|Tax[- ]Aware|AMT-Free/i;
const BOND_NAME_RE =
  /\bBonds?\b|Treasur(?:y|ies)|\bTIPS\b|Fixed[- ]Income|Muni(?:cipal)?s?\b|Aggregate|Credit\b|High[- ]Yield\b(?!.*(?:Equity|Dividend))|\bDebt\b|\bNotes?\b|Floating[- ]Rate|Mortgage(?! REIT)|\bMBS\b|\bCLO\b|iBonds|BulletShares|Convertible|Income Securities|Strategic Income|Core Plus/i;
const COMMODITY_NAME_RE =
  /\bGold\b|\bSilver\b|\bPlatinum\b|\bPalladium\b|\bOil\b|Crude|Brent|Natural Gas|Gasoline|\bCopper\b|Commodit(?:y|ies)|\bWheat\b|\bCorn\b|\bSugar\b|\bCoffee\b|\bCocoa\b|Agricultur|Bullion|Precious Metals?|Industrial Metals?|Base Metals?|Carbon (?:Allowances|Credit)/i;
const COMMODITY_EQUITY_RE =
  /Miners?|Mining|Equity|Stocks?|Compan(?:y|ies)|Explor|Production|Producers?|Equipment|Services|Midstream|Pipeline|Refin|Royalty|Streaming|Strategic Metals|Enhanced Income|Infrastructure|Select Sector/i;
const FX_NAME_RE = /CurrencyShares|Currency (?:Trust|Strategy)|Dollar Index|US Dollar|\bYen\b|\bYuan\b|Swiss Franc|British Pound|Canadian Dollar|Australian Dollar|Dollar (?:Bullish|Bearish)|\bEuro$/i;
const REAL_ASSET_NAME_RE = /\bREITs?\b|Real Estate|Realty|Property|Infrastructure/i;
const MULTI_NAME_RE = /Allocation|Target Date|LifePath|Balanced|Multi-?Asset|\b60\/40\b|Managed Futures|Risk Parity|All[- ]Weather|Retirement Income|Return Stacked/i;

interface ClassCtx {
  cls: Cls;
  /** 변동성(VIX) 선물 상품 */
  vix: boolean;
  /** 가상자산 관련 기업 주식 */
  cryptoEquity: boolean;
}

function detectClass(cat: string | null, body: string): ClassCtx {
  const rule = categoryRule(cat);
  const vix = VIX_RE.test(body);
  const coin = CRYPTO_COIN.test(body);
  const cryptoEquity = coin && CRYPTO_EQUITY.test(body);
  const out = (cls: Cls): ClassCtx => ({ cls, vix, cryptoEquity: cls === "equity" && (cryptoEquity || rule?.theme === "가상자산 관련주") });

  if (vix) return out("equity");
  if (rule) {
    // 'Commodities Focused' 안에는 광산 주식 펀드도 섞여 있다.
    if (rule.cls === "commodity" && COMMODITY_EQUITY_RE.test(body)) return out("equity");
    // 단기국채(T-Bill) 상품은 현금성이다(모닝스타는 Short Government 로 분류하기도 한다).
    if (cat === "Short Government" && TBILL_RE.test(body)) return out("cash");
    // 'Trading--*'는 가상자산·달러 지수 등 기초자산이 제각각이라 이름으로 가른다.
    if (cat?.startsWith("Trading--") && rule.cls === "equity") {
      if (coin && !cryptoEquity) return out("crypto");
      if (FX_NAME_RE.test(body)) return out("fx");
    }
    return out(rule.cls);
  }

  // 카테고리가 없거나 모르는 값: 이름만으로 자산군을 정한다.
  if (coin && !cryptoEquity) return out("crypto");
  if (cryptoEquity) return out("equity");
  if (FX_NAME_RE.test(body)) return out("fx");
  // "Factor Allocation" 처럼 주식 펀드의 이름에도 Allocation 이 쓰인다.
  if (MULTI_NAME_RE.test(body) && !/Equity|Stock/i.test(body)) return out("multi");
  if (COMMODITY_NAME_RE.test(body) && !COMMODITY_EQUITY_RE.test(body) && !BOND_NAME_RE.test(body)) return out("commodity");
  if (TBILL_RE.test(body) && !MUNI_RE.test(body)) return out("cash");
  if (BOND_NAME_RE.test(body) && !/Equity|Stock/i.test(body)) return out("bond");
  if (REAL_ASSET_NAME_RE.test(body) && !/Equity|Stock/i.test(body)) return out("real-asset");
  return out("equity");
}

// ───────── 테마 · 지역 ─────────

/** 먼저 맞는 규칙이 이긴다. 구체적인 테마를 앞에 둔다(국내 분류기와 같은 어휘). */
const THEMES: { label: string; re: RegExp }[] = [
  { label: "가상자산 관련주", re: /Blockchain|Crypto(?:currency)? (?:Industry|Economy|Equity|Compan)|Bitcoin (?:Min|Standard|Treasury|Corporations)|Digital Assets? Equity/i },
  { label: "반도체", re: /Semiconductor|\bSemis?\b|\bSOX\b|\bChips?\b|Memory|Foundry/i },
  { label: "2차전지", re: /Batter(?:y|ies)|Lithium|Energy Storage/i },
  { label: "방산·우주", re: /Aerospace|Defen[sc]e|\bSpace\b|Satellite|Drone|Modern Warfare|Military|Rocket/i },
  { label: "로봇", re: /Robot|Humanoid|Automation|Intelligent Machines/i },
  { label: "바이오·헬스케어", re: /Health|Biotech|Pharma|Medical|Medicine|Genom|Life Science|Drug|Therapeutic|Obesity|Oncology|Diagnos|Surgical/i },
  { label: "금융", re: /Financial|\bBanks?\b|Banking|Insurance|Brokers?|Capital Markets|Fintech|Payments?|Asset Managers?|\bKBW\b/i },
  { label: "원전·에너지", re: /Uranium|Nuclear|Clean ?(?:Energy|tech)|Renewable|Solar|\bWind\b|Hydrogen|Fuel Cell|\bOil\b|\bGas\b|Natural Gas|Energy|Petroleum|Midstream|Pipeline|\bMLP\b|Coal|(?<!Data )Refin|Drilling|Oilfield|Electrification|Electric(?:ity)?\b|\bGrid\b|Geothermal/i },
  { label: "유틸리티", re: /Utilit(?:y|ies)|\bWater\b/i },
  { label: "전기차·자동차", re: /Electric Vehicle|\bEVs?\b|Autonomous|Self-?Driving|Mobility|Automotive|\bAutos?\b|Smart Transportation/i },
  { label: "조선·해운", re: /Shipping|Maritime|Tanker/i },
  { label: "AI·빅테크", re: /Artificial Intelligence|\bAI\b(?![- ](?:Enhanced|Powered|Managed|Driven))|Machine Learning|Big Data|Cloud|Software|SaaS|Cyber|Internet|Metaverse|Data Center|Quantum|Hyperscale|Magnificent|Mag ?7\b|FANG|Big Tech|Computing|Information Technology|Technology|\bTech\b|Gaming|Video Games?|Digital Economy/i },
  { label: "소비·미디어", re: /Consumer|Retail|Restaurant|Food|Beverage|Apparel|Luxury|Leisure|Entertainment|Media|Travel|Hotel|Casino|E-?Commerce|Streaming|Communication|Telecom|Staples|Discretionary|Cannabis|Sports Betting|Gambling/i },
  { label: "건설·산업재", re: /Industrial|Construction|Home ?Build|Materials|Chemical|Steel|Machinery|Engineering|Transportation|Logistics|Supply Chain|Airlines?|Railroad|Packaging|Building Products|Producer Durables|Infrastructure/i },
  { label: "금속·광업", re: /Gold|Silver|Platinum|Palladium|Copper|Nickel|Metals?\b|Mining|Miners?|Rare Earth|Explorers?/i },
  { label: "농업·식량", re: /Agribusiness|Agricultur|Farm|Food Security|Fertilizer/i },
  { label: "혁신·신기술", re: /Innovati|Disrupt|Next Gen|Frontier|Exponential|Revolution|Breakthrough|Transformational|Megatrend|Supercycle/i },
  { label: "배당·가치", re: /Dividend|\bDivs?\b|Aristocrat|Achievers|Value|Cash Cows?|Equity Income|Shareholder Yield|Preferred/i },
  { label: "스마트베타", re: /Quality|Momentum|Low Vol|Min(?:imum)? Vol|Volatility Wtd|Volatility Weighted|Multi-?factor|Factor|Equal[- ]Weight|Fundamental|AlphaDEX|Growth|Revenue|Buyback|Free Cash Flow|\bFCF\b|ESG|Sustainable|\bSRI\b|Climate|Low Carbon|Paris-Aligned|Dorsey Wright|Smart Beta|Gender/i },
];

/** 시장 대표(분산) 지수: 이름에서 지수를 뽑아 테마로 쓴다. 테마형이 먼저 걸리지 않을 때만 닿는다. */
const BROAD_INDEXES: { label: string; re: RegExp; us?: boolean }[] = [
  { label: "나스닥 종합", re: /Nasdaq Composite/i, us: true },
  { label: "나스닥100", re: /Nasdaq[- ]?100|\bQQQ\b|\bNDX\b|\bN100\b|Nasdaq/i, us: true },
  { label: "S&P500", re: /S&P ?500|\bSP ?500\b|S&P US 500/i, us: true },
  { label: "다우존스", re: /Dow Jones Industrial|Dow ?30|\bDJIA\b/i, us: true },
  { label: "미국 소형주", re: /Small[- ]?Cap|Russell 2000|S&P 600|Micro[- ]?Cap/i, us: true },
  { label: "미국 중형주", re: /Mid[- ]?Cap|Russell Midcap|S&P 400|\bSMID\b/i, us: true },
  { label: "미국 전체시장", re: /Total (?:Stock )?Market|Total U\.?S\.? |Broad Market|Russell 3000|Wilshire 5000|All[- ]?Cap|U\.?S\.? (?:Equity|Stock)(?: Market)? Index/i, us: true },
  { label: "미국 대형주", re: /Large[- ]?Cap|Russell 1000|S&P 100\b|Mega[- ]?Cap|MSCI USA\b/i, us: true },
  { label: "선진국(MSCI World)", re: /MSCI World|World Index|ACWI|All[- ]Country|FTSE All-World|Total World|Kokusai|Global Equity Market/i },
  { label: "선진국(미국 제외)", re: /EAFE|Developed (?:Markets? )?ex|International Developed|Developed International|Developed Markets|Foreign Large|\bIntl\b|\bInternational\b|Pacific/i },
  { label: "신흥국", re: /Emerging|\bEM\b/i },
];

/** 국가 펀드. 라벨은 국내 어휘("차이나 대표", "일본 대표" …)를 따르고 나머지는 "○○ 대표". */
const COUNTRIES: { re: RegExp; label: string; region: Region }[] = [
  { re: /Japan|Nikkei|TOPIX|JPX/i, label: "일본 대표", region: "JP" },
  { re: /China|Chinese|Hang Seng|HSCEI|\bCSI\b|A-Shares|Hong Kong|Shanghai|Shenzhen/i, label: "차이나 대표", region: "CN" },
  { re: /Nifty ?50|India 50/i, label: "인도 Nifty50", region: "IN" },
  { re: /India|Sensex/i, label: "인도 대표", region: "IN" },
  { re: /Vietnam/i, label: "베트남 대표", region: "VN" },
  { re: /Korea|KOSPI/i, label: "한국 대표", region: "KR" },
  { re: /Taiwan/i, label: "대만 대표", region: "GLOBAL" },
  { re: /Europe|Eurozone|Euro ?STOXX|STOXX|\bDAX\b/i, label: "유럽 대표", region: "EU" },
  { re: /Germany/i, label: "독일 대표", region: "EU" },
  { re: /United Kingdom|\bUK\b|Britain|FTSE 100/i, label: "영국 대표", region: "EU" },
  { re: /France/i, label: "프랑스 대표", region: "EU" },
  { re: /Italy/i, label: "이탈리아 대표", region: "EU" },
  { re: /Spain/i, label: "스페인 대표", region: "EU" },
  { re: /Switzerland/i, label: "스위스 대표", region: "EU" },
  { re: /Netherlands/i, label: "네덜란드 대표", region: "EU" },
  { re: /Sweden/i, label: "스웨덴 대표", region: "EU" },
  { re: /Norway/i, label: "노르웨이 대표", region: "EU" },
  { re: /Denmark/i, label: "덴마크 대표", region: "EU" },
  { re: /Finland/i, label: "핀란드 대표", region: "EU" },
  { re: /Belgium/i, label: "벨기에 대표", region: "EU" },
  { re: /Austria/i, label: "오스트리아 대표", region: "EU" },
  { re: /Ireland/i, label: "아일랜드 대표", region: "EU" },
  { re: /Poland/i, label: "폴란드 대표", region: "EU" },
  { re: /Greece/i, label: "그리스 대표", region: "EU" },
  { re: /Canada|Canadian/i, label: "캐나다 대표", region: "GLOBAL" },
  { re: /Brazil/i, label: "브라질 대표", region: "GLOBAL" },
  { re: /Mexico/i, label: "멕시코 대표", region: "GLOBAL" },
  { re: /Australia/i, label: "호주 대표", region: "GLOBAL" },
  { re: /Israel/i, label: "이스라엘 대표", region: "GLOBAL" },
  { re: /Saudi/i, label: "사우디 대표", region: "GLOBAL" },
  { re: /Indonesia/i, label: "인도네시아 대표", region: "GLOBAL" },
  { re: /Thailand/i, label: "태국 대표", region: "GLOBAL" },
  { re: /Malaysia/i, label: "말레이시아 대표", region: "GLOBAL" },
  { re: /Singapore/i, label: "싱가포르 대표", region: "GLOBAL" },
  { re: /Philippines/i, label: "필리핀 대표", region: "GLOBAL" },
  { re: /Turkey/i, label: "튀르키예 대표", region: "GLOBAL" },
  { re: /South Africa/i, label: "남아공 대표", region: "GLOBAL" },
  { re: /Chile/i, label: "칠레 대표", region: "GLOBAL" },
  { re: /Argentina/i, label: "아르헨티나 대표", region: "GLOBAL" },
  { re: /Latin America/i, label: "중남미 대표", region: "GLOBAL" },
];

/** "ex-China", "ex US", "ex-Technology" 같은 제외 표기는 그 나라·업종 펀드라는 뜻이 아니다. */
const stripExclusions = (s: string) => s.replace(/\b(?:ex[- ]|excluding |without )(?:the )?(?:U\.S\.A?\.?|United States|[A-Za-z]+)/gi, " ").replace(/\s+/g, " ");

const GLOBAL_WORDS = /Emerging|Frontier|\bEM\b|Global|World|International|\bIntl\b|Developed|EAFE|ACWI|All[- ]Country|Foreign|Kokusai|Worldwide|Asia|Pacific/i;
const US_WORDS = /\bU\.?S\.?A?\b|United States|America|S&P|Nasdaq|\bDow\b|Russell|Wilshire|Wall Street|Magnificent|Treasur/i;

function detectEquityRegion(body: string, rule: CatRule | null): Region {
  const s = stripExclusions(body);
  // 지역 단어(Global·Emerging·Asia …)가 있으면 국가 이름이 같이 있어도 지역 펀드다("Emerging Markets Asia").
  if (GLOBAL_WORDS.test(s)) return "GLOBAL";
  const c = COUNTRIES.find((x) => x.re.test(s));
  if (c) return c.region;
  if (US_WORDS.test(s)) return "US";
  return rule?.region ?? "US";
}

/** 테마 규칙에 방해되는 운용 전략 문구(커버드콜 & 그로스 등)를 걷어낸다. */
const stripStrategy = (s: string) =>
  s
    .replace(/Covered[- ]Call(?: ?& ?(?:Growth|Income))?|Buy[- ]?Write|Premium Income|Option(?:s)? Income(?: Strategy)?|Yield Premium(?: Strategy)?|YieldBOOST|YieldMax|Income Strategy|Target Income|Enhanced Income|Equity Premium(?: Yield)?|Premium Yield|High Income/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// ───────── 단일 종목 ─────────

/** 기초가 개별 종목인 상품(레버리지·옵션인컴·주간분배)이라는 단서가 되는 이름 */
const SINGLE_CONTEXT = /Daily|\d(?:\.\d+)?[xX](?![a-z])|Option(?:s)? Income|YieldBOOST|WeeklyPay|Yield Premium|Autocallable|\bBull\b|\bBear\b|Income Strategy|Target \d+/i;
/** 단서와 상품 일반어를 걷어내고 남는 낱말에서 기초 종목을 찾는다. */
const SINGLE_WRAP_WORDS = /\b(?:Daily|Target|Long|Short|Bull|Bear|Inverse|Leveraged|Ultra|UltraPro|UltraShort|Shares|ETF|ETFs|Fund|Trust|Strategy|Option|Options|Income|YieldBOOST|YieldMax|WeeklyPay|Covered|Call|Premium|Yield|Autocallable|Distribution|Performance|Enhanced|Max|Synthetic|Autocall|Weekly|Pay|Lift|The|Class|Common|Stock|Reverse|Capped|Bullish|Bearish|\d+(?:\.\d+)?[xX](?![a-z])|\d+)\b/gi;
/** 티커처럼 보이지만 지수·섹터·자산·국가 이름인 낱말(소문자) */
const NOT_STOCK = new Set(
  ("gold silver oil tech cloud banks homes cars auto space chips ether china india japan korea metals real core mega cash bonds euro yen dollar " +
    "water solar wind rate rates cyber smart large small mid dow blue green reit fintech crypto bitcoin solana nasdaq qqq spy spx ndx dia iwm vix sox " +
    "xrp sol eth btc doge ada sui avax link dot hbar ltc biotech health energy semis semiconductor semiconductors financial financials " +
    "treasury treasuries gas natural crude brent copper platinum palladium uranium lithium airlines etf s&p index sector " +
    "russell nifty ai tsy eafe mexico brazil taiwan canada germany israel vietnam europe dow30 mag7 magnificent seven nvidia").split(" "),
);
/** 티커 대신 회사 이름으로 적히는 경우(레버리지·옵션인컴 상품 이름에 자주 나온다) */
const COMPANY_NAMES = new Set([
  "apple", "tesla", "microsoft", "amazon", "nvidia", "google", "alphabet", "meta", "netflix", "palantir", "coinbase", "broadcom",
  "berkshire", "boeing", "uber", "intel", "micron", "robinhood", "microstrategy", "strategy", "shopify", "oracle", "salesforce",
  "walmart", "costco", "visa", "mastercard", "disney", "nike", "starbucks", "eli lilly", "lilly", "novo nordisk", "unitedhealth",
  "exxon", "chevron", "lockheed", "snowflake", "crowdstrike", "roblox", "rivian", "lucid", "reddit", "sk hynix", "samsung",
  "tsmc", "asml", "amd", "advanced micro devices", "qualcomm", "adobe", "ibm", "paypal", "block", "airbnb", "doordash",
]);

/**
 * 기초가 개별 종목인 상품에서 기초 종목(티커나 회사명)을 뽑는다. 확실하지 않으면 null — 섹터·지수 펀드를
 * 단일 종목으로 잘못 보면 "소수 종목 집중" 경고가 거짓이 되므로 보수적으로 판단한다.
 */
export function singleStockUnderlying(body: string): string | null {
  if (!SINGLE_CONTEXT.test(body)) return null;
  const core = body.replace(SINGLE_WRAP_WORDS, " ").replace(/[()-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!core) return null;
  const words = core.split(" ");
  if (words.length > 2) return null;
  if (words.some((w) => NOT_STOCK.has(w.toLowerCase()) || /[&\d%]/.test(w))) return null;
  if (words.length === 1 && /^[A-Za-z]{1,5}$/.test(words[0] ?? "")) return core;
  if (COMPANY_NAMES.has(core.toLowerCase())) return core;
  return null;
}

/** 개별 종목 → 테마. 이름만으로는 알 수 없는 기업의 업종을 알려 주는 작은 표(티커·회사명, 소문자). */
const STOCK_THEME: Record<string, string> = {};
const addStockTheme = (theme: string, keys: string) => {
  for (const k of keys.split(",")) STOCK_THEME[k.trim().toLowerCase()] = theme;
};
addStockTheme("반도체", "nvda,nvidia,amd,advanced micro devices,avgo,broadcom,mu,micron,tsm,tsmc,intc,intel,arm,qcom,qualcomm,mrvl,lrcx,amat,klac,asml,txn,mpwr,alab,wdc,sndk,stx,mchp,nxpi,swks,adi,ter,lite,cohr,aaoi,rmbs,smtc,on,crdo,skha,sk hynix,samsung,gfs");
addStockTheme("전기차·자동차", "tsla,tesla,rivn,rivian,lcid,lucid,nio,gm,f");
addStockTheme("AI·빅테크", "aapl,apple,msft,microsoft,amzn,amazon,googl,goog,google,alphabet,meta,nflx,netflix,pltr,palantir,orcl,oracle,crm,salesforce,snow,snowflake,crwd,crowdstrike,adbe,adobe,ibm,smci,shop,shopify,crwv,nbis,u,net,ddog,now,rddt,reddit,rblx,roblox,app,pypl,paypal,sq,block,abnb,airbnb,dash,doordash,ionq,qbts,rgti,qubt,soun,bbai,iren,cbrs,ai,path,pins,snap,twlo,zs,okta,mdb,hubs,team,wday,intu,panw,uber,lyft");
addStockTheme("가상자산 관련주", "coin,coinbase,mstr,microstrategy,strategy,mara,riot,hut,clsk,cifr,bmnr,hood,robinhood,crcl,glxy,btbt,bitf,wulf,corz,sbet");
addStockTheme("바이오·헬스케어", "lly,eli lilly,lilly,nvo,novo nordisk,unh,unitedhealth,pfe,mrna,jnj,abbv,mrk,vrtx,regn,hims,tem");
addStockTheme("금융", "jpm,bac,wfc,gs,ms,v,visa,ma,mastercard,brk,brkb,berkshire,afrm,upst,sofi,nu,bx,kkr,schw");
addStockTheme("방산·우주", "ba,boeing,lmt,lockheed,rtx,noc,gd,avav,ktos,rklb,lunr,rdw,asts,pl,joby,achr,rcat,onds");
addStockTheme("원전·에너지", "xom,exxon,cvx,chevron,oklo,smr,nne,ceg,vst,tln,uec,uuuu,ccj,leu,fslr,enph,plug,bloom,nrg,sedg,vrt");
addStockTheme("소비·미디어", "wmt,walmart,cost,costco,dis,disney,nke,nike,sbux,starbucks,mcd,ko,pep,lulu,cmg,celh,duol,spot,rost,tgt,gme");
addStockTheme("금속·광업", "nem,newmont,fcx,freeport,aem,wpm,hl,aa,mp,cde,pagm");
addStockTheme("건설·산업재", "cat,de,ge,hon,aptv");

/** 개별 종목 테마 표(감사 스크립트가 표에 없는 기초 종목을 찾는 데 쓴다). */
export const US_STOCK_THEME: Readonly<Record<string, string>> = STOCK_THEME;

// ───────── 테마 결정 ─────────

interface ThemeResult {
  theme: string | null;
  broad: boolean;
}

function detectEquityTheme(
  body: string,
  rule: CatRule | null,
  opts: { single: string | null; definedOutcome: boolean; region: Region },
): ThemeResult {
  if (opts.single) {
    const t = STOCK_THEME[opts.single.toLowerCase()];
    return { theme: t ?? null, broad: false };
  }
  if (rule?.theme === "가상자산 관련주") return { theme: "가상자산 관련주", broad: false };
  // "Dow Jones Industrial Average" 의 Industrial 이 산업재 테마로 걸리지 않게 먼저 지수 이름으로 바꿔 둔다.
  const raw = body.replace(/Dow Jones Industrial Average/gi, "Dow 30");
  // S&P 500 에서 특정 업종을 뺀 상품(ex-Technology)은 대표 지수가 아니라 변형 지수다.
  if (/\bex[- ]?(?:Technology|Tech|Financials?|Energy|Health ?care)\b/i.test(raw)) return { theme: "스마트베타", broad: false };
  const s = stripStrategy(stripExclusions(raw));
  // 버퍼·목표수익 상품은 지수에 옵션을 얹은 것이라 스타일 낱말(Growth-100 등)이 아니라 기초 지수만 본다.
  if (!opts.definedOutcome) {
    for (const t of THEMES) if (t.re.test(s)) return { theme: t.label, broad: false };
  }
  for (const b of BROAD_INDEXES) {
    if (b.us && opts.region !== "US") continue;
    if (b.re.test(s)) return { theme: b.label, broad: true };
  }
  for (const c of COUNTRIES) if (c.re.test(s) && !GLOBAL_WORDS.test(s)) return { theme: c.label, broad: true };
  if (opts.definedOutcome && opts.region === "US" && /\bU\.?S\.? Equity\b|Growth-100|Equity Buffer/i.test(body)) {
    return { theme: /Growth-100/i.test(body) ? "나스닥100" : "S&P500", broad: true };
  }
  if (rule?.theme) return { theme: rule.theme, broad: false };
  return { theme: null, broad: false };
}

// ───────── 채권 · 원자재 · 통화 · 가상자산 · 혼합 테마 ─────────

function detectBondTheme(s: string, rule: CatRule | null): string {
  if (rule?.catFirst && rule.theme) return rule.theme;
  if (/TIPS|Inflation[- ]?(?:Protected|Linked|Indexed)|Real Return|Inflation Expectations|Inflation Hedge/i.test(s)) return "물가연동채";
  if (MUNI_RE.test(s)) return "미국 지방채";
  if (/Emerging|\bEM\b/i.test(s)) return "신흥국채";
  if (/Global|International|World|Foreign|Non-?US|Ex-?US/i.test(s)) return "글로벌채";
  if (/Convertible/i.test(s)) return "전환사채";
  if (/Mortgage|\bMBS\b|CMBS|Securitized|\bCLO\b|Asset[- ]Backed|Structured Credit/i.test(s)) return "MBS·유동화채";
  if (/Floating Rate|Senior Loan|Bank Loan|Leveraged Loan/i.test(s) && !/Treasury/i.test(s)) return "뱅크론";
  if (/High[- ]Yield|\bHY\b|Fallen Angel|\bBB\b|\bB Rated\b/i.test(s)) return "하이일드";
  if (/Treasur(?:y|ies)|T-?Bills?\b|Government|Zero Coupon/i.test(s)) return "미국채";
  if (/Corporate|Investment[- ]Grade|\bIG\b|Credit/i.test(s)) return "회사채";
  if (/Short[- ]?Term|Short[- ]Duration|Low Duration|Limited Duration|Short[- ]Maturity|Ultra[- ]?Short|1-3 Year|0-5 Year|1-5 Year/i.test(s)) return "단기채";
  if (/Aggregate|Total Bond|Core Plus|Core-Plus|Total Return|Multi-?Sector|Core Bond|Broad|Fixed Income|Strategic Income|Intermediate/i.test(s)) return "종합채권";
  return rule?.theme ?? "채권";
}

function detectCommodityTheme(s: string): string {
  if (/Gold (?:and|&) Silver|Precious Metals?|Metals Basket/i.test(s)) return "귀금속";
  if (/\bGold\b|Bullion/i.test(s)) return "금";
  if (/\bSilver\b/i.test(s)) return "은";
  if (/Platinum/i.test(s)) return "백금";
  if (/Palladium/i.test(s)) return "팔라듐";
  if (/Rare Earth/i.test(s)) return "희토류";
  if (/\bCopper\b/i.test(s)) return "구리";
  if (/Natural Gas/i.test(s)) return "천연가스";
  if (/\bOil\b|Crude|Brent|WTI|Gasoline|Heating Oil|Petroleum/i.test(s)) return "원유";
  if (/Agricultur|\bCorn\b|Wheat|Soybean|Sugar|Coffee|Cocoa|Cotton|Livestock|Cattle|Grains?\b|Softs/i.test(s)) return "농산물";
  if (/Industrial Metals?|Base Metals?|Aluminum|\bZinc\b|\bNickel\b|Battery Metals?/i.test(s)) return "산업금속";
  if (/Carbon/i.test(s)) return "탄소배출권";
  return "원자재 종합";
}

function detectFxTheme(s: string): string {
  if (/\bEuro\b/i.test(s)) return "유로";
  if (/\bYen\b|Japanese/i.test(s)) return "엔화";
  if (/Swiss Franc/i.test(s)) return "스위스프랑";
  if (/British Pound|Sterling/i.test(s)) return "파운드";
  if (/Canadian Dollar/i.test(s)) return "캐나다달러";
  if (/Australian Dollar/i.test(s)) return "호주달러";
  if (/Yuan|Renminbi/i.test(s)) return "위안";
  if (/Dollar|\bUSD\b/i.test(s)) return "달러";
  return "통화";
}

function detectCryptoTheme(s: string): string {
  const coins: [RegExp, string][] = [
    [/Bitcoin (?:&|and) Ether|Ether (?:&|and) Bitcoin|CoinDesk 20|Crypto(?:currency)? (?:Index|Basket)|Crypto 20/i, "가상자산 종합"],
    [/Bitcoin/i, "비트코인"],
    [/Ether(?:eum)?\b/i, "이더리움"],
    [/Solana/i, "솔라나"],
    [/XRP|Ripple/i, "XRP"],
    [/Dogecoin/i, "도지코인"],
    [/Litecoin/i, "라이트코인"],
    [/Cardano/i, "카르다노"],
    [/\bSui\b/i, "수이"],
    [/Avalanche/i, "아발란체"],
    [/Chainlink/i, "체인링크"],
    [/Polkadot/i, "폴카닷"],
    [/Hyperliquid/i, "하이퍼리퀴드"],
    [/Hedera/i, "헤데라"],
  ];
  for (const [r, label] of coins) if (r.test(s)) return label;
  return "가상자산 종합";
}

function detectMultiTheme(s: string, rule: CatRule | null): string {
  if (rule?.theme) return rule.theme;
  if (/Target Date|LifePath|Retirement/i.test(s)) return "TDF(생애주기)";
  if (/Managed Futures|Trend|Macro|Long\/Short|Market Neutral|Alternative|Merger/i.test(s)) return "대체전략";
  if (/Balanced|Conservative|Moderate|Aggressive|\b\d{2}\/\d{2}\b/i.test(s)) return "주식+채권 혼합";
  return "자산배분";
}

// ───────── groupKey ─────────

/** 같은 지수를 가리킨다고 믿을 수 있는 이름 단서(지수 제공사·지수 이름). 이게 있어야 브랜드를 떼고 다른 운용사와 묶는다. */
const INDEX_EVIDENCE =
  /S&P|MSCI|Russell|Nasdaq|\bDow\b|FTSE|CRSP|Bloomberg|Barclays|iBoxx|\bICE\b|Morningstar|Solactive|NYSE|Wilshire|KBW|STOXX|Nikkei|\bCSI\b|Hang Seng|Nifty|Alerian|Cboe|\bVIX\b|\bQQQ\b|\bDJIA\b/i;
/** 자산 자체(금·비트코인·국채 …)를 가리키는 단서. 그 자산의 기업 주식(광산 등)에는 적용하지 않는다. */
const ASSET_EVIDENCE =
  /Treasur(?:y|ies)|\bTIPS\b|\bGold\b|\bSilver\b|Platinum|Palladium|Bitcoin|Ether(?:eum)?|Solana|XRP|Crude|Brent|Natural Gas|Copper/i;
const ASSET_EQUITY_WORDS = /Miners?|Mining|Explor|Producers?|Royalt|Streaming|Equity|Stocks?|Compan(?:y|ies)/i;
/** 상품 일반어. 이름의 이 낱말들은 같은 지수 판별에 쓸모가 없어 groupKey 에서 뺀다. */
const GENERIC_WORDS = /\b(?:etfs?|funds?|trust|shares?|core|portfolio|index|series|exchange[- ]traded|class|common|beneficial|interests?|units?|the|inc|lp|physical|minishares|vehicle|etv)\b/gi;
/** 지수 단서가 없는 이름에서는 형식적인 낱말만 뺀다(Core·Portfolio 는 상품 성격을 가르기도 한다). */
const TRIVIAL_WORDS = /\b(?:etfs?|funds?|trust|shares?|the|inc|lp|class|common|beneficial|interests?|units?|etv)\b/gi;
/** 레버리지·인버스 표현. 배수는 groupKey 의 꼬리표(|x3)로 따로 남기므로 이름에서는 뺀다. */
const LEVERAGE_WORDS = /\b(?:daily|target|bull|bear|bullish|bearish|long|short(?![- ]?term)|inverse|leveraged?|ultra|ultrapro|ultrashort)\b|(?<![\w.])-?\d(?:\.\d{1,2})?\s?x(?![a-z])/gi;

/** 같은 지수를 가리키는 서로 다른 표기를 한 표기로 맞춘다. */
function canonicalIndex(s: string): string {
  return s
    .replace(/nasdaq[- ]?100|\bqqq\b|\bn100\b|\bndx\b/g, "nasdaq100")
    .replace(/dow jones industrial average|\bdjia\b|\bdow ?30\b/g, "dow30")
    .replace(/s&p mid-?cap(?: 400)?|s&p 400/g, "s&pmidcap400")
    .replace(/s&p small-?cap(?: 600)?|s&p 600/g, "s&psmallcap600")
    .replace(/\bu\.s\.a?\b|\busa?\b|united states/g, "us");
}

/**
 * 같은 지수를 추종하는 해외 ETF끼리 같은 값이 되는 키. 거짓 묶음은 서로 다른 ETF 를 가려 버리지만 묶이지 않는
 * 것은 무해하므로, 이름에 지수·자산 단서(S&P 500, Gold …)가 있을 때만 브랜드를 떼고 묶는다. 단서가 없으면
 * 브랜드를 남겨 같은 운용사의 같은 이름끼리만 묶인다.
 * 레버리지 배수·인버스·커버드콜·버퍼·선물처럼 구조가 다르면 이름이 같아도 다른 상품이라 꼬리표로 구분한다.
 */
function groupKeyOf(n: string, symbol: string, tags: StructureTag[], leverage: number, single: string | null): string {
  const stripped = stripBrands(n);
  let body = stripped.body;
  // "Tidal ETF Trust - Sound Equity Income ETF" 처럼 신탁 이름이 " - " 앞에 붙은 형태는 뒷부분이 상품명이다.
  const dash = body.indexOf(" - ");
  if (dash > 0 && /(?:Trust|Funds?|Series|Shares)$/i.test(body.slice(0, dash))) body = body.slice(dash + 3);
  const evidence = single !== null || INDEX_EVIDENCE.test(body) || (ASSET_EVIDENCE.test(body) && !ASSET_EQUITY_WORDS.test(body));
  let s = body.toLowerCase();
  if (leverage !== 1) s = s.replace(LEVERAGE_WORDS, " ");
  s = canonicalIndex(s).replace(evidence ? GENERIC_WORDS : TRIVIAL_WORDS, " ");
  // 낱말 경계를 버리기 전에 문장부호를 정리한다. 숫자 사이의 -, . 만 남긴다(1-3 Year, 1.5x).
  s = s.replace(/[^a-z0-9&+%.\-]/g, "").replace(/(?<!\d)[.\-]|[.\-](?!\d)/g, "");
  if (s.length < 2) return `us:${symbol.toLowerCase()}`;
  const suffix: string[] = [];
  if (leverage !== 1) suffix.push(`x${leverage}`);
  for (const t of ["covered-call", "defined-outcome", "futures", "volatility"] as const) if (tags.includes(t)) suffix.push(t);
  return `us:${evidence ? "" : stripped.brand ? `${stripped.brand}:` : ""}${s}${suffix.length ? `|${suffix.join("|")}` : ""}`;
}

// ───────── 메인 ─────────

const PHYSICAL_METAL_NAME = /Gold|Silver|Platinum|Palladium|Precious|Bullion/i;
const FUTURES_WORDS = /Futures?\b|Strategy|DB |Bloomberg|Index|Leveraged|Ultra|\b[23]x\b|Daily|Roll|Contango|Optimum Yield|GSCI|\bLP\b|K-1/i;

export function classifyUs(info: UsEtfInfo): Taxonomy {
  const name = info.name;
  const n = clean(name);
  const body = stripBrands(n).body;
  const cat = info.category?.trim() || null;
  const rule = categoryRule(cat);

  const leverage = detectLeverage(n, body, cat);
  const ctx = detectClass(cat, body);
  const single = ctx.cls === "equity" ? singleStockUnderlying(body) : null;
  const definedOutcome = cat === "Defined Outcome" || DEFINED_OUTCOME_RE.test(n);
  const coveredCall =
    cat !== "Defined Outcome" &&
    (cat === "Derivative Income" || COVERED_CALL_RE.test(n) || (OPTION_INCOME_BRAND.test(n) && /Enhanced Income|High Income/i.test(body)));

  // 자산군 · 지역 · 테마
  let assetClass: AssetClass;
  let region: Region;
  let theme: string | null = null;
  let broad = false;
  switch (ctx.cls) {
    case "crypto":
      assetClass = "crypto";
      region = "NA";
      theme = detectCryptoTheme(body);
      break;
    case "fx":
      assetClass = "fx";
      region = "NA";
      theme = detectFxTheme(body);
      break;
    case "commodity":
      assetClass = "commodity";
      region = "NA";
      theme = detectCommodityTheme(body);
      break;
    case "cash":
      assetClass = "cash";
      region = /Global|International|World|Foreign/i.test(body) ? "GLOBAL" : "US";
      theme = "파킹·초단기";
      break;
    case "bond": {
      assetClass = "bond";
      theme = detectBondTheme(body, rule);
      region =
        theme === "신흥국채" || theme === "글로벌채"
          ? "GLOBAL"
          : /China/i.test(body)
            ? "CN"
            : /Euro/i.test(body)
              ? "EU"
              : rule?.region ?? "US";
      break;
    }
    case "multi":
      assetClass = "multi";
      theme = detectMultiTheme(body, rule);
      region = rule?.region ?? (/Global|International|World/i.test(body) ? "GLOBAL" : "US");
      break;
    case "real-asset":
      assetClass = "real-asset";
      theme = /Infrastructure/i.test(body) && !/REIT|Real Estate/i.test(body) ? "인프라" : rule?.theme ?? "리츠";
      region = /Global|International|World|Ex-?US|Emerging/i.test(body) ? "GLOBAL" : rule?.region ?? "US";
      break;
    default: {
      assetClass = "global-equity";
      region = ctx.vix ? "US" : detectEquityRegion(body, rule);
      if (single) {
        // 한국·대만·유럽 기업의 레버리지 상품은 기초 종목의 나라를 따른다.
        if (/hynix|samsung/i.test(single)) region = "KR";
        else if (/^tsm|tsmc$/i.test(single)) region = "GLOBAL";
        else if (/^asml$/i.test(single)) region = "EU";
      }
      if (ctx.vix) break;
      const t = detectEquityTheme(body, rule, { single, definedOutcome, region });
      theme = t.theme;
      broad = t.broad;
      // 국가 테마가 정해졌는데 지역이 미국으로 남아 있으면 모순이므로 그 나라를 따른다.
      const c = COUNTRIES.find((x) => x.label === theme);
      if (c && region === "US") region = c.region;
      break;
    }
  }

  // 구조 태그 (국내 분류기와 같은 순서로 쌓는다)
  const tags: StructureTag[] = [];
  if (leverage > 1) tags.push("leveraged");
  if (leverage < 0) tags.push("inverse");
  if (coveredCall) tags.push("covered-call");
  if (definedOutcome && cat !== "Derivative Income") tags.push("defined-outcome");
  if (ctx.vix) tags.push("volatility");
  if (/\bSynthetic\b|\bSwap\b/i.test(n)) tags.push("synthetic");
  if (/\bActive(?:ly)?\b/i.test(n)) tags.push("active");
  if (/\bTR\b/.test(n)) tags.push("total-return");
  if (assetClass === "global-equity" && !ctx.vix && DIVIDEND_RE.test(n)) tags.push("dividend");
  // 선물 기반: 만기 교체(롤오버) 비용이 있어 기초자산 가격과 수익률이 다를 수 있다.
  let futures = ctx.vix || /\bFutures\b|Managed Future\b/i.test(body);
  if (assetClass === "commodity") {
    const physical = /Grantor Trust/i.test(info.legalType ?? "") || /Physical/i.test(body) || (PHYSICAL_METAL_NAME.test(body) && !FUTURES_WORDS.test(body));
    futures = futures || !physical;
  }
  if (assetClass === "fx" && /\bDB\b|Dollar Index/i.test(body)) futures = true;
  if (assetClass === "crypto" && (info.symbol === "BITO" || /Bitcoin Strategy|Ether Strategy/i.test(body))) futures = true;
  if (futures) tags.push("futures");
  if (single || CONCENTRATED_RE.test(n)) tags.push("concentrated");

  return {
    assetClass,
    region,
    theme,
    broad,
    tags,
    leverage,
    brand: extractUsBrand(name),
    groupKey: groupKeyOf(n, info.symbol, tags, leverage, single),
  };
}
