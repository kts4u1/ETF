import { useMemo, useState } from "react";
import { explainProposal, ASSET_CLASS_LABEL } from "../../core/explain";
import { fmtRatio } from "../../core/format";
import { exposureOf } from "../../core/overlap";
import { proposeCombos, roleOf, selectPool, weeklyReturns, type ComboCandidate, type Proposal } from "../../core/portfolio";
import { isOverseas } from "../../core/market";
import { fxNote } from "../../core/market-view";
import { HORIZONS, PROFILES } from "../../core/scoring";
import { Disclaimer, FxNote, MarketBadge } from "../components/bits";
import { Controls } from "../components/Controls";
import { LineChart } from "../components/LineChart";
import { useApp, useBacktest, useHoldings, useSeries, type ComboCell } from "../data";
import { etfHref, href } from "../router";
import { fullValues } from "../series-utils";

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const LETTER = ["A", "B", "C"];

export function Combo() {
  const { prefs, rec, counts } = useApp();
  const { data: series } = useSeries();
  const { data: holdings } = useHoldings();
  const [size, setSize] = useState<2 | 3>(3);

  const ready = !!series && !!holdings;
  const proposals = useMemo(() => {
    if (!series || !holdings) return [];
    const pool = selectPool(rec.ranked, 10);
    const cands: ComboCandidate[] = pool.map((s) => ({
      etf: s.etf,
      score: s.score,
      returns: weeklyReturns(fullValues(series, s.etf.code)),
      exposure: exposureOf(holdings, s.etf.code),
    }));
    return proposeCombos(cands, prefs.profile, { size, weighting: "inverse-vol", poolSize: 14, limit: 3 });
  }, [series, holdings, rec, prefs.profile, size]);

  return (
    <>
      <h1>ETF 조합 제안</h1>
      <p className="lead">
        하나만 사는 것보다 <b>서로 다르게 움직이는 2~3개를 섞으면 하락 때 덜 빠집니다.</b>{" "}
        추천 후보 중에서 구성종목이 겹치지 않고 함께 움직이는 정도가 낮은 조합을 골라 비중까지 제안합니다.
      </p>

      <Controls />

      <section aria-labelledby="combo-h">
        <div className="section-head">
          <h2 id="combo-h">{PROFILES[prefs.profile].label} · {HORIZONS[prefs.horizon].label} 조합</h2>
          <div className="seg small" role="radiogroup" aria-label="조합 크기">
            {([2, 3] as const).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={size === n} className={size === n ? "on" : ""} onClick={() => setSize(n)}>{n}개 조합</button>
            ))}
          </div>
        </div>

        {!ready ? (
          <div className="card chart-loading">시세와 구성종목을 불러오는 중…</div>
        ) : proposals.length === 0 ? (
          <div className="card empty">
            <p>현재 조건으로는 {size}개 조합을 만들 수 없습니다.</p>
            <p className="hint">후보가 부족하거나, 후보들의 공통 시세 이력이 1년 미만이거나, 조합이 성향 한도(변동성·낙폭)를 넘는 경우입니다. 자산군을 넓히거나 성향을 바꿔 보세요.</p>
          </div>
        ) : (
          <div className="combos">
            {proposals.map((p, i) => <ProposalCard key={p.members.map((m) => m.cand.etf.code).join("+")} p={p} index={i} />)}
          </div>
        )}
        <div className="notice">
          <b>이 제안을 어떻게 읽어야 하나요</b>
          <ul className="plain">
            <ValidationLines size={size} />
            {counts.US > 0 && <li>위 과거 검증은 국내 상장 ETF 조합으로만 했습니다. 해외(미국) 상장 ETF가 들어간 조합은 같은 방식으로 검증하지 않았고, 구성종목 겹침도 계산하지 못합니다.</li>}
            <li>비중은 수익을 예측해서 정한 것이 아니라 변동성이 작은 ETF에 조금 더 싣는 단순한 규칙(역변동성, 15~60%)입니다. 선물 기반·통화 ETF는 자동 제안에서 제외합니다.</li>
            <li>전체 검증 결과는 <a href={href("/method")}>방법론</a>에서 볼 수 있습니다.</li>
          </ul>
        </div>
        <Disclaimer />
      </section>
    </>
  );
}

/** 현재 선택(성향·조합 크기)에 해당하는 실제 검증값으로 문장을 만든다. 일반화하지 않고 해당 칸의 숫자만 말한다. */
function ValidationLines({ size }: { size: 2 | 3 }) {
  const { prefs } = useApp();
  const { data: bt } = useBacktest();
  if (!bt?.combos) return null;
  const strat = `조합 ${size}개 · 역변동성`;
  const base = "추천 상위 3개 균등";
  const lines = (["m6", "m12"] as const).map((h) => {
    const row = bt.combos?.[prefs.profile]?.[h];
    const c: ComboCell | undefined = row?.[strat];
    const b: ComboCell | undefined = row?.[base];
    if (!c || !b) return null;
    const better = c.dMdd > 0;
    const sig = c.dMddCI !== null && Math.abs(c.dMdd) - c.dMddCI > 0;
    return (
      <li key={h}>
        <b>과거 검증({PROFILES[prefs.profile].label} · {size}개 조합 · 보유 {h === "m6" ? 6 : 12}개월):</b>{" "}
        보유 중 최대낙폭이 평균 {fmtRatio(c.mdd, 0)}로, 추천 상위 3개를 균등하게 산 경우({fmtRatio(b.mdd, 0)})보다 {Math.abs(c.dMdd * 100).toFixed(1)}%p {better ? "작았습니다" : "컸습니다"}
        ({sig ? "우연으로 보기 어려운 차이" : "우연과 구분되지 않는 수준"}). 수익은 {c.dRet >= 0 ? "+" : ""}{(c.dRet * 100).toFixed(1)}%p 차이로 {c.dRetCI !== null && Math.abs(c.dRet) - c.dRetCI > 0 ? "의미 있는 차이가 있었습니다" : "우연과 구분되지 않았습니다"}.
      </li>
    );
  });
  return (
    <>
      {lines}
      <li>이 방식의 가치는 수익 예측이 아니라 <b>나쁜 경우의 낙폭을 줄이는 분산</b>입니다. 위 숫자는 한 번의 장세에서 확인한 것이라 앞으로도 같다는 보장은 없습니다.</li>
    </>
  );
}

function ProposalCard({ p, index }: { p: Proposal; index: number }) {
  const { byCode } = useApp();
  const { data: series } = useSeries();
  const ex = explainProposal(p, (c) => byCode.get(c));
  const weeks = p.stats.weeks;

  // 차트: 조합과 구성 ETF를 같은 시작점(=100)에서
  const chart = useMemo(() => {
    if (!series) return null;
    const start = series.grid.length - (weeks + 1);
    if (start < 0) return null;
    const dates = series.grid.slice(start);
    const lines = p.members.map((m, k) => {
      const vals = fullValues(series, m.cand.etf.code).slice(start);
      const base = vals[0];
      return { id: m.cand.etf.code, label: m.cand.etf.name, shortLabel: m.cand.etf.tax.brand ? m.cand.etf.name.slice(m.cand.etf.tax.brand.length + 1) : m.cand.etf.name, color: COLORS[k] ?? COLORS[0]!, values: vals.map((v) => (v == null || base == null ? null : (v / base) * 100)) };
    });
    let v = 100;
    const combo = [100, ...p.returns.map((r) => (v *= 1 + r))];
    return { dates, series: [...lines, { id: "combo", label: `조합 ${LETTER[index]}`, shortLabel: `조합 ${LETTER[index]}`, color: "var(--text)", emphasis: true, values: combo }] };
  }, [series, p, weeks, index]);

  return (
    <article className="card combo-card">
      <header className="combo-head">
        <h3>조합 {LETTER[index]}</h3>
        <span className="muted">조합 점수 {Math.round(p.score)} · 품질 {Math.round(p.quality)} · 분산 {Math.round(p.diversification)}</span>
      </header>

      <div className="alloc" role="img" aria-label={`비중: ${p.members.map((m) => `${m.cand.etf.name} ${Math.round(m.weight * 100)}%`).join(", ")}`}>
        {p.members.map((m, k) => (
          <span key={m.cand.etf.code} className="alloc-seg" style={{ flex: m.weight, background: COLORS[k] }}>
            <b>{Math.round(m.weight * 100)}%</b>
          </span>
        ))}
      </div>

      <ul className="members">
        {p.members.map((m, k) => (
          <li key={m.cand.etf.code}>
            <span className="legend-key" style={{ background: COLORS[k] }} aria-hidden />
            <div className="member-body">
              <span><MarketBadge etf={m.cand.etf} /> <a href={etfHref(m.cand.etf.code)}><b>{m.cand.etf.name}</b></a></span>
              <span className="muted">{Math.round(m.weight * 100)}% · {roleOf(m.cand.etf)} · {ASSET_CLASS_LABEL[m.cand.etf.tax.assetClass]}{m.cand.etf.tax.theme ? ` · ${m.cand.etf.tax.theme}` : ""} · 추천 점수 {Math.round(m.cand.score)}</span>
            </div>
          </li>
        ))}
      </ul>

      <dl className="stats">
        <div><dt>연 변동성</dt><dd>{fmtRatio(p.stats.vol, 0)} <small className="muted">(구성 평균 {fmtRatio(p.stats.avgMemberVol, 0)})</small></dd></div>
        <div><dt>과거 최대낙폭</dt><dd>{fmtRatio(p.stats.mdd, 0)}</dd></div>
        <div><dt>분산 비율</dt><dd>{p.stats.diversificationRatio.toFixed(2)}<small className="muted"> (1=효과 없음)</small></dd></div>
        <div><dt>구성종목 겹침</dt><dd>{p.avgOverlap === null ? <span className="muted">확인 불가</span> : `평균 ${p.avgOverlap.toFixed(0)}%`}</dd></div>
        <div><dt>과거 연수익 (참고)</dt><dd>{fmtRatio(p.stats.cagr, 0, true)}<small className="muted"> {Math.round(weeks / 52 * 10) / 10}년</small></dd></div>
      </dl>

      <ul className="reasons">{ex.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {p.members.some((m) => isOverseas(m.cand.etf)) && <FxNote>{fxNote()} — 해외(미국) 상장 ETF가 포함되어 위 변동성·낙폭·차트에 환율 변동이 들어 있습니다.</FxNote>}

      {chart ? (
        <LineChart dates={chart.dates} series={chart.series} yFormat={(v) => v.toFixed(0)} ariaLabel={`조합 ${LETTER[index]}와 구성 ETF의 최근 ${Math.round(weeks / 52 * 10) / 10}년 비교 차트(시작=100)`} height={240} />
      ) : <div className="chart-loading">차트 불러오는 중…</div>}

      <details className="caution-details" open>
        <summary>알아둘 점</summary>
        <ul className="plain">{ex.cautions.map((c, i) => <li key={i}>{c}</li>)}</ul>
      </details>
    </article>
  );
}
