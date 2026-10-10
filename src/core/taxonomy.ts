import type { AssetClass, Region, StructureTag, Taxonomy } from "./types";

/**
 * ETF 이름(+네이버 탭 코드)으로 자산군·지역·테마·구조 태그를 분류한다.
 *
 * 왜 이름 기반인가: 국내 ETF는 운용사가 이름 규칙(예: "…레버리지", "…(H)", "…커버드콜")으로
 * 상품 구조를 드러내도록 관행이 굳어 있고, 별도 분류 API는 없다. 규칙 기반이라 테스트가 쉽고
 * 오분류가 나면 규칙 한 줄만 고치면 된다. 오분류 가능성은 docs/DESIGN.md 에 한계로 명시한다.
 */

/** 네이버 금융 ETF 탭 코드: 1 국내시장지수, 2 국내업종/테마, 3 국내파생, 4 해외주식, 5 원자재, 6 채권, 7 기타 */
export type NaverTab = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const has = (name: string, ...words: string[]) => words.some((w) => name.includes(w));
const re = (name: string, pattern: RegExp) => pattern.test(name);

export function extractBrand(name: string): string {
  const i = name.indexOf(" ");
  return i > 0 ? name.slice(0, i) : "";
}

/**
 * 같은 지수를 추종하는 ETF를 묶기 위한 키. 브랜드를 떼고 공백/대소문자를 정규화한다.
 * (H)·(합성)·액티브·TR 은 환노출/구조가 달라 서로 다른 상품이므로 키에 남긴다.
 */
export function makeGroupKey(name: string): string {
  const brand = extractBrand(name);
  const body = brand ? name.slice(brand.length + 1) : name;
  return body.replace(/\s+/g, "").toLowerCase();
}

function detectLeverage(name: string): number {
  const inverse = has(name, "인버스");
  const lev = has(name, "레버리지");
  const x2 = /2X|2x|2배/.test(name);
  if (inverse) return x2 ? -2 : -1;
  if (lev) return /3X|3x|3배/.test(name) ? 3 : 2;
  return 1;
}

const SINGLE_STOCKS = [
  "삼성전자", "SK하이닉스", "테슬라", "엔비디아", "팔란티어", "애플", "마이크로소프트", "아마존",
  "구글", "알파벳", "메타", "브로드컴", "현대차", "네이버", "카카오", "TSMC", "코인베이스", "아이온큐",
];

function detectTags(name: string, leverage: number): StructureTag[] {
  const tags: StructureTag[] = [];
  if (leverage > 1) tags.push("leveraged");
  if (leverage < 0) tags.push("inverse");
  if (has(name, "커버드콜", "프리미엄", "옵션")) tags.push("covered-call");
  if (re(name, /\(H\)|\(합성 ?H\)|\(H,|환헤지/)) tags.push("hedged");
  if (has(name, "(합성")) tags.push("synthetic");
  if (has(name, "액티브", "KoAct")) tags.push("active");
  if (re(name, /TR(?![a-zA-Z])/) && !has(name, "TRF", "TREX")) tags.push("total-return");
  if (has(name, "배당", "분배")) tags.push("dividend");
  // 선물 기반 상품은 만기 교체(롤오버) 비용 때문에 기초자산 가격과 수익률이 다를 수 있다
  if (has(name, "선물")) tags.push("futures");
  if (
    has(name, "단일종목") ||
    re(name, /TOP\s?[1-5](?!\d)/i) ||
    (SINGLE_STOCKS.some((s) => name.includes(s)) && !has(name, "그룹", "채권혼합50", "TOP10"))
  ) {
    tags.push("concentrated");
  }
  return tags;
}

// ───────── 자산군 ─────────

function detectAssetClass(name: string, tab: NaverTab | null): AssetClass {
  // 혼합자산이 가장 먼저: "삼성전자SK하이닉스채권혼합50" 은 채권 ETF가 아니라 주식+채권 혼합이다.
  if (has(name, "혼합", "TDF", "TRF", "자산배분", "멀티에셋", "올웨더", "All Weather")) return "multi";
  // 주식지수와 금을 함께 담는 상품(예: 미국S&P500&GOLD)도 혼합자산이다.
  if (re(name, /(S&P|나스닥).*(GOLD|골드)|(GOLD|골드).*(S&P|나스닥)/i)) return "multi";

  // 통화(환율) 상품. "미국달러SOFR금리" 같은 달러 단기금리 상품은 현금성이라 먼저 걸러낸다.
  if (has(name, "SOFR", "머니마켓", "CD금리", "CD1년", "KOFR", "초단기", "단기통안", "금리액티브", "금리투자", "파킹")) {
    return "cash";
  }
  if (re(name, /(달러|엔|유로|위안|엔화|환율)선물|달러(?!.*(채|SOFR))|^.*미국달러$/) && !has(name, "채권")) return "fx";

  if (has(name, "리츠", "인프라", "부동산")) return "real-asset";

  // 원자재 가격을 추종하는 상품만 원자재. "미국원유에너지기업", "천연가스밸류체인"은 해당 산업의 주식이다.
  const body = name.slice(extractBrand(name).length).trim();
  const equityLike = re(name, /기업|밸류체인|생산|채굴|광산|관련주/);
  if (
    re(body, /^은(?!행)|KRX금|금현물|금선물|골드|금은|은선물|국제금|^금|금\(H\)|Gold/i) ||
    has(name, "원유", "WTI", "구리", "천연가스", "농산물", "원자재", "팔라듐", "백금", "탄소배출권", "콩선물", "옥수수") ||
    tab === 5
  ) {
    if (!re(name, /금융|금리/) && !equityLike) return "commodity";
  }

  if (
    has(name, "채권", "국채", "국고채", "회사채", "크레딧", "하이일드", "통안채", "금융채", "종합채", "물가채", "장기채", "단기채", "채권", "머니") ||
    re(name, /미국채|美국채|만기|\d{2}-\d{2}.*채/) ||
    (tab === 6 && !re(name, /S&P|나스닥|주식/))
  ) {
    return "bond";
  }

  if (tab === 4 || region(name, tab) !== "KR") return "global-equity";
  return "kr-equity";
}

// ───────── 지역 ─────────

const US_STOCKS = ["테슬라", "엔비디아", "팔란티어", "애플", "마이크로소프트", "아마존", "구글", "알파벳", "브로드컴", "코인베이스", "아이온큐", "버크셔", "일라이릴리"];

function region(name: string, tab: NaverTab | null): Region {
  if (re(name, /미국|나스닥|NASDAQ|S&P|다우|러셀|필라델피아|월가|빅테크|월스트리트/i) && !has(name, "한국")) return "US";
  if (US_STOCKS.some((s) => name.includes(s))) return "US";
  if (re(name, /차이나|중국|CSI|항셍|홍콩|과창판|STAR50|China|HSCEI/)) return "CN";
  // "커뮤니케이션"에 "니케이"가 들어 있어 오탐하므로 뒤에 "션"이 오면 제외한다.
  if (re(name, /일본|니케이(?!션)|Nikkei|TOPIX|JPX/)) return "JP";
  // "인도네시아"는 인도가 아니다.
  if (re(name, /인도(?!네시아)|Nifty|니프티/)) return "IN";
  if (has(name, "베트남")) return "VN";
  if (re(name, /유럽|독일|영국|프랑스|유로스탁스|STOXX|이탈리아/)) return "EU";
  if (re(name, /글로벌|선진국|신흥국|이머징|MSCI ?World|ACWI|세계|아시아|멕시코|브라질|사우디|중동|라틴/i)) return "GLOBAL";
  if (tab === 4) return "GLOBAL";
  return "KR";
}

// ───────── 테마 ─────────

/** 먼저 매칭되는 규칙이 이긴다. 구체적인 테마를 앞에 둔다. */
const THEMES: { label: string; pattern: RegExp }[] = [
  { label: "반도체", pattern: /반도체|필라델피아|SOX|HBM|파운드리/ },
  { label: "2차전지", pattern: /2차전지|배터리|리튬|양극재/ },
  { label: "AI·빅테크", pattern: /AI|인공지능|빅테크|테크TOP|Magnificent|매그니피센트|FANG|소프트웨어|클라우드|SaaS|데이터센터|사이버보안|플랫폼|인터넷|메타버스|게임|클라우드/ },
  { label: "로봇", pattern: /로봇|휴머노이드|자동화/ },
  { label: "바이오·헬스케어", pattern: /바이오|헬스케어|제약|의료|비만|생명|신약/ },
  { label: "방산·우주", pattern: /방산|우주|항공|K방산|디펜스/ },
  { label: "조선·해운", pattern: /조선|해운|MASGA/ },
  { label: "원전·에너지", pattern: /원전|원자력|SMR|우라늄|에너지|태양광|ESS|수소|풍력|전력|신재생|클린|전력인프라|천연가스|정유/ },
  { label: "전기차·자동차", pattern: /전기차|자율주행|모빌리티|자동차|현대차그룹/ },
  { label: "금융", pattern: /금융|은행|(?<!우선)증권|보험|핀테크/ },
  { label: "소비·미디어", pattern: /소비재|필수소비|경기소비|화장품|K-?뷰티|K-?푸드|음식|엔터|미디어|콘텐츠|컨슈머|여행|레저|럭셔리|명품/ },
  { label: "건설·산업재", pattern: /건설|철강|화학|소재|기계|산업재|인프라|운송|물류/ },
  { label: "배당·가치", pattern: /배당|고배당|배당성장|배당귀족|밸류업|가치|저PBR|PBR|리츠/ },
  { label: "스마트베타", pattern: /퀄리티|모멘텀|로우볼|저변동|저평가|스마트|성장|그로스|밸류$|동일가중|ESG|SRI|Quality|Momentum/i },
];

/** 시장 대표(분산) 지수: 이름에서 지수명을 뽑아 theme 으로 쓴다. */
const BROAD_INDEXES: { label: string; pattern: RegExp }[] = [
  { label: "S&P500", pattern: /S&P ?500|S&P500/i },
  { label: "나스닥100", pattern: /나스닥 ?100|NASDAQ ?100/i },
  { label: "나스닥 종합", pattern: /나스닥(?!\s?100)(?!.*(100|테크|바이오))/ },
  { label: "다우존스", pattern: /다우존스|다우(?!.*(존스)?\s?배당)/ },
  { label: "코스닥150", pattern: /코스닥 ?150/ },
  { label: "코스피200", pattern: /(^|[^\d])200(?!\d)|코스피 ?200|KOSPI ?200/ },
  { label: "KRX300", pattern: /KRX ?300/ },
  { label: "MSCI Korea", pattern: /MSCI ?Korea|MSCI ?코리아/i },
  { label: "선진국(MSCI World)", pattern: /MSCI ?World|선진국|ACWI|글로벌 ?(주식|증시)/ },
  { label: "신흥국", pattern: /신흥국|이머징|EM\b/ },
  { label: "인도 Nifty50", pattern: /인도 ?(Nifty|니프티)?\s?50|Nifty ?50|인도Nifty/ },
  { label: "차이나 대표", pattern: /차이나(?!.*(전기차|배터리|AI|테크|반도체|항셍테크|과창판))|CSI ?300|CSI300|항셍(?!테크)|중국본토|중국A/ },
  { label: "일본 대표", pattern: /니케이 ?225|Nikkei|TOPIX|일본(?!.*(반도체|테크|AI|방산))/ },
  { label: "베트남 대표", pattern: /베트남|VN30/ },
];

function detectTheme(name: string, assetClass: AssetClass): { theme: string | null; broad: boolean } {
  if (assetClass === "kr-equity" || assetClass === "global-equity") {
    // 테마가 뚜렷한 상품(예: 미국반도체)은 광범위 지수로 보지 않는다.
    for (const t of THEMES) if (t.pattern.test(name)) return { theme: t.label, broad: false };
    for (const b of BROAD_INDEXES) if (b.pattern.test(name)) return { theme: b.label, broad: true };
    return { theme: null, broad: false };
  }
  if (assetClass === "commodity") {
    const body = name.slice(extractBrand(name).length).trim();
    if (has(name, "금은", "금·은", "귀금속")) return { theme: "귀금속", broad: false };
    if (re(body, /^은(?!행)|은선물/)) return { theme: "은", broad: false };
    if (re(body, /금|골드|Gold/i)) return { theme: "금", broad: false };
    if (has(name, "원유", "WTI")) return { theme: "원유", broad: false };
    if (has(name, "팔라듐")) return { theme: "팔라듐", broad: false };
    if (has(name, "희토류")) return { theme: "희토류", broad: false };
    if (has(name, "구리")) return { theme: "구리", broad: false };
    if (has(name, "농산물", "콩", "옥수수")) return { theme: "농산물", broad: false };
    if (has(name, "천연가스")) return { theme: "천연가스", broad: false };
    if (has(name, "탄소")) return { theme: "탄소배출권", broad: false };
    return { theme: "원자재 종합", broad: false };
  }
  if (assetClass === "bond") {
    if (has(name, "미국채", "美국채", "미국국채", "미국 국채")) return { theme: "미국채", broad: false };
    if (has(name, "국고채", "국채")) return { theme: "국채", broad: false };
    if (has(name, "회사채", "크레딧")) return { theme: "회사채", broad: false };
    if (has(name, "하이일드")) return { theme: "하이일드", broad: false };
    if (has(name, "물가채")) return { theme: "물가연동채", broad: false };
    if (has(name, "금융채", "은행채")) return { theme: "금융채", broad: false };
    if (has(name, "종합채")) return { theme: "종합채권", broad: false };
    if (has(name, "단기", "통안")) return { theme: "단기채", broad: false };
    return { theme: "채권", broad: false };
  }
  if (assetClass === "cash") return { theme: "파킹·초단기", broad: false };
  if (assetClass === "multi") {
    if (has(name, "TDF")) return { theme: "TDF(생애주기)", broad: false };
    if (has(name, "채권혼합")) return { theme: "주식+채권 혼합", broad: false };
    return { theme: "자산배분", broad: false };
  }
  if (assetClass === "real-asset") {
    return { theme: has(name, "인프라") && !has(name, "리츠") ? "인프라" : "리츠", broad: false };
  }
  if (assetClass === "fx") {
    if (has(name, "달러")) return { theme: "달러", broad: false };
    if (has(name, "엔")) return { theme: "엔화", broad: false };
    if (has(name, "유로")) return { theme: "유로", broad: false };
    if (has(name, "위안")) return { theme: "위안", broad: false };
    return { theme: "통화", broad: false };
  }
  return { theme: null, broad: false };
}

export function classify(name: string, tab: NaverTab | null = null): Taxonomy {
  const leverage = detectLeverage(name);
  const tags = detectTags(name, leverage);
  const assetClass = detectAssetClass(name, tab);
  let { theme, broad } = detectTheme(name, assetClass);
  // "KODEX 레버리지", "KODEX 인버스"처럼 지수명이 생략된 국내 파생 상품은 코스피200 기준이다.
  if (assetClass === "kr-equity" && theme === null && leverage !== 1 && /^(레버리지|인버스)/.test(name.slice(extractBrand(name).length).trim())) {
    theme = "코스피200";
    broad = true;
  }
  const reg: Region =
    assetClass === "kr-equity"
      ? "KR"
      : assetClass === "global-equity"
        ? region(name, tab)
        : assetClass === "fx" || assetClass === "commodity" || assetClass === "cash"
          ? "NA"
          : region(name, tab);
  return {
    assetClass,
    region: reg,
    theme,
    broad,
    tags,
    leverage,
    brand: extractBrand(name),
    groupKey: makeGroupKey(name),
  };
}
