import { feeWonPer10M, fmtEok, fmtFee, fmtPercentUnit, fmtRatio, fmtWon, fmtYears } from "./format";
import { roleOf, type Proposal } from "./portfolio";
import { isOverseas } from "./market";
import { AUM_FUND_NOTE, aumText } from "./market-view";
import { HORIZONS, PROFILES, isLeveraged, volOf, mddOf } from "./scoring";
import type { AssetClass, EtfRecord, Preferences, Region, Scored } from "./types";

/** 한국어 설명 생성기. 모든 문장은 데이터에서 계산한 사실만 말하고, 미래 수익을 단정하지 않는다. */

export const ASSET_CLASS_LABEL: Record<AssetClass, string> = {
  "kr-equity": "국내 주식",
  "global-equity": "해외 주식",
  bond: "채권",
  cash: "현금성(파킹)",
  commodity: "원자재",
  multi: "혼합자산",
  "real-asset": "리츠·인프라",
  fx: "통화",
  crypto: "가상자산",
};

export const REGION_LABEL: Record<Region, string> = {
  KR: "한국",
  US: "미국",
  CN: "중국",
  JP: "일본",
  IN: "인도",
  VN: "베트남",
  EU: "유럽",
  GLOBAL: "글로벌",
  NA: "-",
};

export const TAG_LABEL: Record<string, string> = {
  leveraged: "레버리지",
  inverse: "인버스",
  "covered-call": "커버드콜",
  hedged: "환헤지",
  synthetic: "합성",
  active: "액티브",
  "total-return": "TR",
  dividend: "배당",
  concentrated: "집중투자",
  futures: "선물",
  "defined-outcome": "버퍼·목표수익",
  volatility: "변동성(VIX)",
};

// ───────── 위험 등급 ─────────

export const RISK_LABEL = ["", "매우 낮음", "낮음", "보통", "높음", "매우 높음"] as const;

/**
 * 1~5 위험 등급. 레버리지·인버스는 무조건 5. 나머지는 최근 변동성(3년, 없으면 1년)으로 나눈다.
 * 임계값은 실제 ETF 변동성 분포(현금성 0.2%, 채권 5%, 혼합 11%, 해외주식 24%, 국내주식 38%)에 맞춰 잡았다.
 * 변동성을 모를 때는 자산군으로 추정하되, 가상자산·변동성(VIX) 상품은 구조상 가격 변동이 매우 커서 5로 본다.
 */
export function riskGrade(e: EtfRecord): 1 | 2 | 3 | 4 | 5 {
  if (isLeveraged(e)) return 5;
  const v = volOf(e);
  if (v === null) {
    if (e.tax.assetClass === "crypto" || e.tax.tags.includes("volatility")) return 5;
    return e.tax.assetClass === "cash" ? 1 : e.tax.assetClass === "bond" ? 2 : 4;
  }
  if (v < 0.015) return 1;
  if (v < 0.07) return 2;
  if (v < 0.15) return 3;
  if (v < 0.3) return 4;
  return 5;
}

// ───────── "이 ETF는 무엇인가요" ─────────

export function typeLine(e: EtfRecord): string {
  const t = e.tax;
  const parts: string[] = [];
  // 지역을 모르면(NA) "- 주식" 대신 자산군 이름("해외 주식")을 쓴다
  parts.push((t.assetClass === "kr-equity" || t.assetClass === "global-equity") && t.region !== "NA"
    ? `${REGION_LABEL[t.region]} 주식`
    : ASSET_CLASS_LABEL[t.assetClass]);
  if (t.theme) parts.push(t.broad ? `${t.theme} 지수` : `${t.theme} 테마`);
  return parts.join(" · ");
}

/** 구조 태그를 초보자 언어로 풀어쓴 문장들 */
export function structureNotes(e: EtfRecord): string[] {
  const t = e.tax;
  const out: string[] = [];
  if (isOverseas(e)) {
    out.push(`미국${e.exchange ? `(${e.exchange})` : ""} 시장에 상장되어 달러로 거래되는 ETF입니다. 이 앱의 가격·순자산·거래대금·수익률은 원화로 환산한 값입니다.`);
  }
  if (t.assetClass === "crypto") out.push("비트코인·이더리움 같은 가상자산의 가격을 따라가도록 설계된 상품입니다.");
  if (t.tags.includes("leveraged")) out.push(`하루 수익률의 ${t.leverage}배를 따라가도록 설계된 상품입니다.`);
  if (t.tags.includes("inverse")) out.push(`지수가 내리면 이익, 오르면 손실이 나는 ${Math.abs(t.leverage) > 1 ? `${Math.abs(t.leverage)}배 ` : ""}반대 방향 상품입니다.`);
  if (t.tags.includes("covered-call")) out.push("주식을 보유하면서 콜옵션을 팔아 프리미엄을 분배금으로 받는 전략입니다. 상승폭은 제한되지만 분배금이 많습니다.");
  if (t.tags.includes("active")) out.push("펀드매니저가 지수와 다르게 종목을 고르는 액티브 상품입니다.");
  if (t.tags.includes("total-return")) out.push("분배금을 지급하지 않고 재투자해 복리로 불리는 TR(Total Return) 상품입니다.");
  if (t.tags.includes("hedged")) {
    out.push(isOverseas(e)
      ? "통화 헤지가 표기된 상품이지만, 이 앱은 원화로 환산하므로 원/달러 환율 영향은 그대로 받습니다."
      : "환율 변동 영향을 줄이도록 환헤지(H)를 한 상품입니다.");
  }
  if (t.tags.includes("defined-outcome")) out.push("정해진 기간 동안 옵션으로 손실의 일부를 막아 주는 대신 상승폭에 상한을 두는 버퍼·목표수익 구조의 상품입니다.");
  if (t.tags.includes("volatility")) out.push("주식시장 변동성(VIX) 선물을 이용하는 상품입니다. 선물을 사는 쪽은 시장이 불안할 때 오르고, 파는 쪽은 시장이 안정적일 때 이익이 나도록 설계됩니다(상품마다 방향이 다르니 설명서로 확인하세요).");
  if (t.tags.includes("synthetic")) out.push("실제 자산 대신 증권사와의 스왑 계약으로 지수를 추종하는 합성 상품입니다.");
  if (t.tags.includes("concentrated")) out.push("소수 종목에 집중 투자하는 상품입니다.");
  return out;
}

/**
 * "이 ETF는 무엇인가요?" 첫 문단의 운용 방식 문장. 지수 추종 여부는 이름·태그로만 판단하므로,
 * 옵션·선물 전략은 지수 추종이라고 하지 않고(구조는 아래 설명이 말한다) 해외 상장은 단정하지 않는다.
 */
export function indexTrackingSentence(e: EtfRecord): string {
  const tags = e.tax.tags;
  if (tags.includes("active")) return "운용역이 종목을 골라 지수 대비 초과수익을 노립니다.";
  if (tags.some((t) => t === "covered-call" || t === "defined-outcome" || t === "volatility")) return "";
  if (isOverseas(e)) return "지수·전략을 따라가도록 운용되는 상품으로 보이지만, 지수 추종형인지 운용역이 종목을 고르는 액티브형인지는 이 앱이 이름으로만 판단해 정확하지 않을 수 있습니다.";
  return "정해진 지수의 움직임을 따라가도록 운용됩니다.";
}

/** 세금 안내(일반론). 세법은 바뀔 수 있으므로 단정하지 않고 확인을 권한다. */
export function taxNote(e: EtfRecord): string {
  const t = e.tax;
  if (isOverseas(e)) {
    return "해외 상장 ETF는 국내 상장과 세금 체계가 다릅니다. 현행 기준으로 매매차익에는 양도소득세(연 250만원 공제 후 22%)가 붙어 본인이 신고·납부해야 하고, 분배금에는 배당소득세가 적용됩니다(현지 원천징수 포함).";
  }
  const domesticEquity =
    t.assetClass === "kr-equity" &&
    !t.tags.some((x) => x === "leveraged" || x === "inverse" || x === "covered-call" || x === "synthetic");
  if (domesticEquity) {
    return "국내 주식형 ETF는 일반적으로 매매차익에 세금이 없고 분배금에만 배당소득세(15.4%)가 붙습니다.";
  }
  return "해외·채권·원자재·파생형 ETF는 일반적으로 매매차익과 분배금 모두 배당소득세(15.4%) 대상이며 금융소득종합과세에 합산됩니다. ISA·연금계좌를 활용하면 세금을 줄일 수 있습니다.";
}

// ───────── 주의사항 ─────────

export interface Caution {
  level: "high" | "warn" | "info";
  text: string;
}

export function cautions(e: EtfRecord): Caution[] {
  const out: Caution[] = [];
  const t = e.tax;
  const m = e.m;

  if (t.tags.includes("leveraged") || t.tags.includes("inverse")) {
    out.push({
      level: "high",
      text: "매일 수익률을 n배로 추종하도록 매일 재조정되어, 오르내림이 반복되는 장세에서는 기초지수보다 훨씬 나쁜 성과가 날 수 있습니다(복리 효과). 단기 매매용이며 장기 보유에 적합하지 않습니다.",
    });
  }
  if (t.tags.includes("covered-call")) {
    out.push({
      level: "warn",
      text: "상승장에서는 수익이 제한되고 하락장에서는 하락을 그대로 받습니다. 분배율이 높아 보여도 분배금은 원금(NAV) 일부일 수 있으니 총수익(수정주가 기준 수익률)을 보세요.",
    });
  }
  if (t.tags.includes("concentrated")) {
    out.push({ level: "warn", text: "소수 종목에 집중되어 개별 기업 악재의 영향이 큽니다." });
  }
  if (t.tags.includes("futures")) {
    out.push({
      level: "warn",
      text: "선물 기반 상품입니다. 선물은 만기가 올 때마다 다음 월물로 갈아타며(롤오버) 비용이 생길 수 있어, 기초자산(예: 원유·금) 가격이 올라도 ETF 수익률은 그보다 낮을 수 있습니다.",
    });
  }
  if (t.tags.includes("synthetic")) {
    out.push({ level: "info", text: "합성(스왑) 구조는 거래 상대방 증권사의 신용위험이 있습니다." });
  }
  if (t.tags.includes("active")) {
    out.push({ level: "info", text: "액티브 ETF는 운용역에 따라 성과 편차가 크고 보수가 상대적으로 높은 편입니다." });
  }
  if (t.tags.includes("volatility")) {
    out.push({
      level: "high",
      text: "변동성(VIX) 선물 기반 상품은 구조가 특수합니다. 선물을 사는 상품은 매달 갈아타는 비용 때문에 장기 보유할수록 가치가 줄어드는 경향이 있고, 선물을 파는 상품은 시장이 급락하면 큰 손실을 볼 수 있습니다. 어느 쪽이든 장기 보유보다 단기 매매용에 가깝습니다.",
    });
  }
  if (t.tags.includes("defined-outcome")) {
    out.push({
      level: "warn",
      text: "정해진 기간 동안 손실의 일부를 막아 주는 대신 상승폭이 제한되는 구조입니다. 기간 중간에 사면 남은 버퍼와 상승 한도가 처음 설계와 달라지므로 운용사 공시로 현재 조건을 확인해야 합니다.",
    });
  }
  if (t.assetClass === "crypto") {
    const v = volOf(e);
    const dd = mddOf(e);
    const stats = [v !== null ? `연 변동성 ${fmtRatio(v, 0)}` : null, dd !== null ? `최대낙폭 ${fmtRatio(dd, 0)}` : null].filter(Boolean).join(", ");
    out.push({
      level: "warn",
      text: `가상자산은 가격 변동이 매우 큰 자산입니다${stats ? `(이 ETF의 최근 ${stats})` : ""}. 짧은 기간에도 크게 오르내릴 수 있고, 과거의 변동 폭이 앞으로의 한계를 뜻하지 않습니다.`,
    });
  }
  if (isOverseas(e)) {
    // 해외 상장 ETF는 환헤지 태그가 없고 항상 환노출이다. 지역·자산군(현금성·통화·가상자산 포함)과 무관하게 안내한다.
    out.push({
      level: "info",
      text: "원화 환산 기준이라 원/달러 환율 변동이 수익률·변동성·최대낙폭에 그대로 반영됩니다(원화 약세엔 유리, 강세엔 불리). 달러 가격이 그대로여도 환율에 따라 원화 수익이 달라집니다.",
    });
    out.push({
      level: "info",
      text: "현행 기준으로 매매차익에는 양도소득세(연 250만원 공제 후 22%)가 붙어 별도로 신고·납부해야 하고, 분배금에는 배당소득세가 적용됩니다. 세법은 바뀔 수 있으니 투자 전 확인하세요.",
    });
    out.push({
      level: "info",
      text: "달러로 거래되므로 매수할 때마다 환전이 필요하고(환전 수수료·스프레드 별도), 미국 시장은 한국 시간 밤~새벽에 열리며 휴장일도 국내와 다릅니다.",
    });
    out.push({ level: "info", text: "괴리율과 구성종목 겹침은 해외 상장 ETF에는 제공하지 않습니다(데이터 없음)." });
    if (e.aumScope === "fund") out.push({ level: "info", text: AUM_FUND_NOTE });
  } else {
    if (!t.tags.includes("hedged") && ["global-equity", "bond", "commodity", "real-asset", "multi"].includes(t.assetClass) && t.region !== "KR" && t.region !== "NA") {
      out.push({ level: "info", text: "환헤지가 없는 상품은 원/외화 환율에 따라 수익률이 달라집니다(원화 약세엔 유리, 강세엔 불리)." });
    }
    if (t.tags.includes("hedged")) {
      out.push({ level: "info", text: "환헤지(H) 상품은 환율 변동은 줄이지만 헤지 비용이 들고, 원화 약세로 인한 환차익은 얻지 못합니다." });
    }
  }

  if (m.ret.y1 === null) {
    out.push({ level: "warn", text: `상장 ${fmtYears(m.years)} — 1년 성과가 없어 장기 성과를 검증할 수 없습니다.` });
  } else if (m.years < 3) {
    out.push({ level: "info", text: `상장 ${fmtYears(m.years)}으로 3년 지표가 없습니다. 하락장 성과가 검증되지 않았을 수 있습니다.` });
  }
  if (e.aumEok < 300) {
    out.push({ level: "warn", text: `순자산 ${fmtEok(e.aumEok)}으로 작은 편입니다. 규모가 작으면 청산·상장폐지 가능성이 상대적으로 큽니다.` });
  }
  if (m.avgValue20 !== null && m.avgValue20 < 3e8) {
    out.push({ level: "warn", text: `일평균 거래대금 ${fmtWon(m.avgValue20)}으로 거래가 적어 매수·매도 호가 차이(스프레드)가 클 수 있습니다.` });
  }
  if (e.navGap !== null && Math.abs(e.navGap) >= 1) {
    out.push({ level: "warn", text: `시장가격이 NAV(순자산가치)와 ${fmtPercentUnit(e.navGap, 2, true)} 벌어져 있습니다(괴리율). 비싸게 사거나 싸게 팔 수 있습니다.` });
  }
  if (m.ret.y1 !== null && m.ret.y1 >= 0.8 && !isLeveraged(e)) {
    out.push({
      level: "warn",
      text: `최근 1년 ${fmtRatio(m.ret.y1, 0, true)} 급등했습니다. 과거의 급등이 반복된다는 보장은 없고, 급등 후에는 조정 폭도 큽니다.`,
    });
  }
  if (m.drawdown !== null && m.drawdown <= -0.2) {
    out.push({ level: "info", text: `52주 고점 대비 ${fmtRatio(m.drawdown, 0)} 낮은 가격입니다.` });
  }
  return out;
}

// ───────── 추천 사유 ─────────

export interface Explanation {
  headline: string;
  reasons: string[];
}

export function explain(s: Scored, prefs: Preferences): Explanation {
  const { etf: e, factors: f } = s;
  const m = e.m;
  const reasons: string[] = [];

  const basis = isOverseas(e) ? "분배금 보정·원화 환산 시세 기준" : "분배금 보정 시세 기준";
  if (f.ret >= 70) {
    const parts = [m.ret.y1 !== null ? `최근 1년 ${fmtRatio(m.ret.y1, 1, true)}` : null, m.cagr3y !== null ? `3년 연평균 ${fmtRatio(m.cagr3y, 1, true)}` : null].filter(Boolean);
    if (parts.length) reasons.push(`수익성 상위권: ${parts.join(", ")} (${basis}).`);
  }
  if (f.eff >= 70) {
    const sh = m.sharpe3y ?? m.sharpe1y;
    if (sh !== null) reasons.push(`위험 대비 수익 효율이 높은 편입니다(샤프지수 ${sh.toFixed(2)}).`);
  }
  if (f.safety >= 70) {
    const dd = mddOf(e);
    const v = volOf(e);
    reasons.push(`후보군 중 흔들림이 작은 편: 최대낙폭 ${fmtRatio(dd, 0)}${v !== null ? `, 연 변동성 ${fmtRatio(v, 0)}` : ""}.`);
  }
  if (f.trend >= 75 && (m.trend200 ?? -1) > 0) {
    reasons.push("200일 이동평균선 위에서 거래되고 12개월 모멘텀이 상위권입니다.");
  }
  if (e.fee !== null && f.cost >= 80) {
    reasons.push(`총보수 연 ${fmtFee(e.fee)}로 낮습니다(1,000만원당 연 ${feeWonPer10M(e.fee).toLocaleString("ko-KR")}원).`);
  }
  if (f.trust >= 80) {
    // † 순자산은 펀드 전체 합계라 ETF 클래스의 규모·청산 위험을 말해 주지 못하므로 거래대금만 근거로 쓴다.
    reasons.push(e.aumScope === "fund"
      ? `일평균 거래대금 ${fmtWon(m.avgValue20)} — 사고팔기 쉽습니다(순자산은 펀드 전체 합계라 규모 근거로 쓰지 않았습니다).`
      : `순자산 ${aumText(e)}, 일평균 거래대금 ${fmtWon(m.avgValue20)} — 사고팔기 쉽고 청산 위험이 낮습니다.`);
  }
  if (s.groupSize > 1) {
    reasons.unshift(
      s.groupRank === 1
        ? `같은 지수를 추종하는 후보 ETF ${s.groupSize}개 중 종합 1위입니다.`
        : `같은 지수를 추종하는 후보 ETF ${s.groupSize}개 중 종합 ${s.groupRank}위입니다.`,
    );
  }
  return {
    headline: `${PROFILES[prefs.profile].label} · ${HORIZONS[prefs.horizon].label} 기준 종합 ${Math.round(s.score)}점`,
    reasons: reasons.slice(0, 5),
  };
}

// ───────── 조합 설명 ─────────

export interface ProposalExplanation {
  reasons: string[];
  cautions: string[];
}

/** 조합 제안의 근거와 주의사항. 수치는 모두 계산값이고, 미래를 약속하지 않는다. */
export function explainProposal(p: Proposal, byCode: (code: string) => { name: string } | undefined): ProposalExplanation {
  const reasons: string[] = [];
  const cautions: string[] = [];
  const st = p.stats;

  const roles = new Map<string, number>();
  for (const m of p.members) roles.set(roleOf(m.cand.etf), (roles.get(roleOf(m.cand.etf)) ?? 0) + m.weight);
  reasons.push(`역할 분담: ${[...roles].map(([r, w]) => `${r} ${Math.round(w * 100)}%`).join(" · ")}`);

  if (st.diversificationRatio > 1.05) {
    const cut = 1 - st.vol / st.avgMemberVol;
    reasons.push(
      `함께 들면 변동성이 ${fmtRatio(st.vol, 0)}로, 구성 ETF를 따로 든 평균(${fmtRatio(st.avgMemberVol, 0)})보다 약 ${Math.round(cut * 100)}% 낮아집니다(서로 다르게 움직이는 효과).`,
    );
  } else {
    reasons.push("구성 ETF들이 비슷하게 움직여 분산 효과는 크지 않습니다.");
  }
  reasons.push(`과거 ${Math.round(st.weeks / 52 * 10) / 10}년 기준 최대낙폭 ${fmtRatio(st.mdd, 0)}, 연 변동성 ${fmtRatio(st.vol, 0)}.`);

  const overseas = p.members.map((m) => m.cand.etf).filter(isOverseas);
  if (p.avgOverlap !== null) {
    const m = p.maxOverlap;
    reasons.push(
      `구성종목 겹침이 평균 ${p.avgOverlap.toFixed(0)}%로 ${p.avgOverlap < 10 ? "거의 없어 실제로 서로 다른 종목에 분산됩니다" : "일부 있습니다"}${m && m.pct >= 10 ? ` (가장 큰 겹침: ${byCode(m.a)?.name ?? m.a} ↔ ${byCode(m.b)?.name ?? m.b} ${m.pct.toFixed(0)}%)` : ""}.`,
    );
  } else {
    cautions.push(overseas.length
      ? "해외 상장 ETF는 구성종목 정보가 없어 겹침을 확인하지 못했습니다. 같은 종목에 중복 투자될 수 있습니다."
      : "일부 ETF는 구성종목 정보가 없어(레버리지·합성 등) 겹침을 확인하지 못했습니다.");
  }
  if (overseas.length && p.avgOverlap !== null) {
    cautions.push(`해외 상장 ETF(${overseas.map((e) => e.name).join(", ")})는 구성종목 정보가 없어 위 겹침 수치에 포함되지 않았습니다.`);
  }
  if (overseas.length) {
    cautions.push("해외 상장 ETF는 원화 환산 기준이라 환율 변동이 조합의 수익·낙폭에 반영되고, 양도소득세·환전·거래시간이 국내 상장 ETF와 다릅니다. 위 수치는 이를 반영한 과거 값입니다.");
  }

  cautions.push(
    `수익률(연 ${fmtRatio(st.cagr, 0)})은 최근 ${Math.round(st.weeks / 52 * 10) / 10}년 과거 값이며 같은 흐름이 반복된다는 보장이 없습니다. 이 조합의 의미는 수익 예측이 아니라 ‘낙폭을 줄이는 분산’입니다.`,
  );
  cautions.push("비중을 계속 유지하는 것으로 계산했습니다. 실제로는 시간이 지나며 비중이 변하므로 연 1~2회 점검(리밸런싱)이 필요하고, 거래비용·세금은 반영하지 않았습니다.");
  return { reasons, cautions };
}
