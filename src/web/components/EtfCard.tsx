import { cautions, explain, typeLine } from "../../core/explain";
import { fmtFee, fmtRatio } from "../../core/format";
import { isOverseas } from "../../core/market";
import { FX_NOTE, aumText, listingLine } from "../../core/market-view";
import { mddOf } from "../../core/scoring";
import type { Scored } from "../../core/types";
import { useApp, useSeries } from "../data";
import { compareHref, etfHref } from "../router";
import { sliceSeries } from "../series-utils";
import { CautionList, Delta, FactorBars, FxNote, RiskPips, TagChips } from "./bits";
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
        <span className="rank" aria-label={`${rank}위`}>{rank}</span>
        <div className="etf-title">
          <h3><a href={etfHref(e.code)}>{e.name}</a></h3>
          <p className="sub">{e.code} · {e.issuer ?? "운용사 미상"} · {typeLine(e)}</p>
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
        <div><dt>최근 1년</dt><dd><Delta v={e.m.ret.y1} /></dd></div>
        <div><dt>3년 연평균</dt><dd><Delta v={e.m.cagr3y} /></dd></div>
        <div><dt>최대낙폭</dt><dd>{fmtRatio(mddOf(e), 0)}</dd></div>
        <div><dt>총보수</dt><dd>{fmtFee(e.fee)}</dd></div>
        <div><dt>순자산</dt><dd>{aumText(e)}</dd></div>
        <div className="spark-cell"><dt>3년 추이</dt><dd>{spark ? <Sparkline values={spark.values} label={`${e.name} 최근 3년 가격 추이${overseas ? "(원화 환산)" : ""}`} /> : <span className="muted">-</span>}</dd></div>
      </dl>
      {overseas && <FxNote>{FX_NOTE} — 위 수익률·순자산·추이는 모두 이 환산값 기준입니다.</FxNote>}

      <footer className="etf-foot">
        <details>
          <summary>점수 자세히</summary>
          <FactorBars factors={s.factors} />
          {s.youngPenalty > 0 && <p className="hint">상장 기간이 짧아 {s.youngPenalty.toFixed(1)}점 감점되었습니다.</p>}
        </details>
        <span className="actions">
          {alts.length > 0 && (
            <a className="btn ghost" href={compareHref([e.code, ...alts.slice(0, 3).map((a) => a!.code)])}>
              같은 지수 {alts.length + 1}개 비교
            </a>
          )}
          <a className="btn" href={etfHref(e.code)}>상세 보기</a>
        </span>
      </footer>
    </article>
  );
}
