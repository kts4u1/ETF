import { ASSET_CLASS_LABEL, RISK_LABEL, TAG_LABEL, riskGrade, type Caution } from "../../core/explain";
import { FACTOR_KEYS, FACTOR_LABELS } from "../../core/scoring";
import type { EtfRecord, FactorScores } from "../../core/types";

/** 위험 등급 5칸 미터. 색이 아니라 채워진 칸 수 + 텍스트 라벨로 전달한다. */
export function RiskPips({ etf, showLabel = true }: { etf: EtfRecord; showLabel?: boolean }) {
  const g = riskGrade(etf);
  return (
    <span className="risk" title={`위험 등급 ${g}/5 — 최근 변동성 기준(레버리지·인버스는 항상 5)`}>
      <span className="pips" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= g ? "on" : ""} />)}
      </span>
      {showLabel && <span className="risk-label">위험 {RISK_LABEL[g]}</span>}
    </span>
  );
}

export function TagChips({ etf, max = 6 }: { etf: EtfRecord; max?: number }) {
  const t = etf.tax;
  const chips: { text: string; kind?: string }[] = [{ text: ASSET_CLASS_LABEL[t.assetClass] }];
  if (t.theme) chips.push({ text: t.theme });
  for (const tag of t.tags) chips.push({ text: TAG_LABEL[tag] ?? tag, kind: tag === "leveraged" || tag === "inverse" ? "danger" : undefined });
  return (
    <span className="chips">
      {chips.slice(0, max).map((c, i) => <span key={i} className={`chip${c.kind ? ` chip-${c.kind}` : ""}`}>{c.text}</span>)}
    </span>
  );
}

/** 팩터 점수 막대. 단일 색(순차 블루), 두께 얇게, 값은 텍스트로 병기. */
export function FactorBars({ factors }: { factors: FactorScores }) {
  return (
    <ul className="factors" aria-label="항목별 점수">
      {FACTOR_KEYS.map((k) => (
        <li key={k} title={FACTOR_LABELS[k].hint}>
          <span className="factor-name">{FACTOR_LABELS[k].name}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.max(2, factors[k])}%` }} /></span>
          <span className="factor-val">{Math.round(factors[k])}</span>
        </li>
      ))}
    </ul>
  );
}

const LEVEL_LABEL = { high: "고위험", warn: "주의", info: "참고" } as const;
const LEVEL_ICON = { high: "▲", warn: "!", info: "i" } as const;

/** 아이콘 + 라벨 + 문장. 색에만 의존하지 않는다. */
export function CautionList({ items }: { items: Caution[] }) {
  if (!items.length) return null;
  return (
    <ul className="cautions">
      {items.map((c, i) => (
        <li key={i} className={`caution caution-${c.level}`}>
          <span className="caution-badge"><b aria-hidden>{LEVEL_ICON[c.level]}</b> {LEVEL_LABEL[c.level]}</span>
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** 한국 증시 관례: 상승=빨강, 하락=파랑. 부호를 항상 같이 표기해 색에만 의존하지 않는다. */
export function Delta({ v, digits = 1 }: { v: number | null; digits?: number }) {
  if (v === null) return <span className="muted">-</span>;
  const cls = v > 0 ? "up" : v < 0 ? "down" : "";
  return <span className={`delta ${cls}`}>{`${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`}</span>;
}

export function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`disclaimer${compact ? " compact" : ""}`} role="note">
      <b>투자 유의사항</b> 이 앱은 과거 데이터로 ETF를 분류·비교하는 정보 제공 도구이며 투자 권유나 자문이 아닙니다.
      과거 성과는 미래 수익을 보장하지 않고, 투자 손실은 투자자 본인에게 귀속됩니다. 투자 전 상품설명서와 운용사 공시를 확인하세요.
    </p>
  );
}
