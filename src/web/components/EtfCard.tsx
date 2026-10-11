import { cautions, explain, typeLine } from "../../core/explain";
import { tr } from "../../core/i18n";
import { issuerLabel } from "../../core/i18n-labels";
import { fmtFee, fmtRatio } from "../../core/format";
import { isOverseas } from "../../core/market";
import { aumText, fxNote, listingLine } from "../../core/market-view";
import { mddOf } from "../../core/scoring";
import type { Scored } from "../../core/types";
import { useApp, useSeries } from "../data";
import { compareHref, etfHref } from "../router";
import { sliceSeries } from "../series-utils";
import { CautionList, Delta, FactorBars, FxNote, RiskPips, TagChips } from "./bits";
import { BasketButton } from "./BasketButton";
import { Sparkline } from "./Sparkline";

export function EtfCard({ s, rank }: { s: Scored; rank: number }) {
  const { prefs, byCode } = useApp();
  const { data: series } = useSeries();
  const e = s.etf;
  const ex = explain(s, prefs);
  const warn = cautions(e).filter((c) => c.level !== "info").slice(0, 2);
  const spark = series ? sliceSeries(series, e.code, 156) : null;
  const overseas = isOverseas(e);
  const listing = listingLine(e);
  const alts = s.alternatives.map((c) => byCode.get(c)).filter(Boolean);

  return (
    <article className="card etf-card">
      <header className="etf-head">
        <span className="rank" aria-label={tr(`${rank}위`, `Rank ${rank}`)}>{rank}</span>
        <div className="etf-title">
          <h3><a href={etfHref(e.code)}>{e.name}</a></h3>
          <p className="sub">{e.code} · {e.issuer ? issuerLabel(e.issuer) : tr("운용사 미상", "Issuer unknown")} · {typeLine(e)}</p>
          {listing && <p className="sub">{listing}</p>}
        </div>
        <div className="score" title={ex.headline}>
          <b>{Math.round(s.score)}</b><small>/100</small>
        </div>
      </header>

      <div className="etf-meta">
        <TagChips etf={e} />
        <RiskPips etf={e} />
      </div>

      {ex.reasons.length > 0 && (
        <ul className="reasons">
          {ex.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
      <CautionList items={warn} />

      <dl className="stats">
        <div><dt>{tr("최근 1년", "Last 1 year")}</dt><dd><Delta v={e.m.ret.y1} /></dd></div>
        <div><dt>{tr("3년 연평균", "3-year CAGR")}</dt><dd><Delta v={e.m.cagr3y} /></dd></div>
        <div><dt>{tr("최대낙폭", "Max drawdown")}</dt><dd>{fmtRatio(mddOf(e), 0)}</dd></div>
        <div><dt>{tr("총보수", "Expense ratio")}</dt><dd>{fmtFee(e.fee)}</dd></div>
        <div><dt>{tr("순자산", "Net assets")}</dt><dd>{aumText(e)}</dd></div>
        <div className="spark-cell"><dt>{tr("3년 추이", "3-year trend")}</dt><dd>{spark ? <Sparkline values={spark.values} label={tr(`${e.name} 최근 3년 가격 추이${overseas ? "(원화 환산)" : ""}`, `${e.name} price trend, last 3 years${overseas ? " (KRW-converted)" : ""}`)} /> : <span className="muted">-</span>}</dd></div>
      </dl>
      {overseas && <FxNote>{fxNote()} {tr("— 위 수익률·순자산·추이는 모두 이 환산값 기준입니다.", "— the returns, net assets and trend above all use this converted value.")}</FxNote>}

      <footer className="etf-foot">
        <details>
          <summary>{tr("점수 자세히", "Score details")}</summary>
          <FactorBars factors={s.factors} />
          {s.youngPenalty > 0 && <p className="hint">{tr(`상장 기간이 짧아 ${s.youngPenalty.toFixed(1)}점 감점되었습니다.`, `A ${s.youngPenalty.toFixed(1)}-point penalty applies because the listing history is short.`)}</p>}
        </details>
        <span className="actions">
          {alts.length > 0 && (
            <a className="btn ghost" href={compareHref([e.code, ...alts.slice(0, 3).map((a) => a!.code)])}>
              {tr(`같은 지수 ${alts.length + 1}개 비교`, `Compare ${alts.length + 1} on the same index`)}
            </a>
          )}
          <BasketButton etf={e} />
          <a className="btn" href={etfHref(e.code)}>{tr("상세 보기", "View detail")}</a>
        </span>
      </footer>
    </article>
  );
}
