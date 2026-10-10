import { useState } from "react";
import type { EtfRecord } from "../../core/types";
import { cautions, explain, structureNotes, taxNote, typeLine } from "../../core/explain";
import { feeWonPer10M, fmtDate, fmtEok, fmtFee, fmtHistory, fmtPercentUnit, fmtRatio, fmtWon, priceParts } from "../../core/format";
import { MARKET_LABEL, isOverseas, marketOf } from "../../core/market";
import { FX_NOTE, listingLine } from "../../core/market-view";
import { mddOf, sameGroup, volOf } from "../../core/scoring";
import { CautionList, Delta, Disclaimer, FactorBars, FxNote, MarketBadge, RiskPips, TagChips } from "../components/bits";
import { HoldingsSection } from "../components/Holdings";
import { LineChart } from "../components/LineChart";
import { useApp, useSeries } from "../data";
import { compareHref, etfHref, href } from "../router";
import { RANGES, sliceSeries, type RangeKey } from "../series-utils";

export function Detail({ code }: { code: string | null }) {
  const { byCode, snap, prefs, scoreOf, excludedBy } = useApp();
  const { data: series } = useSeries();
  const [range, setRange] = useState<RangeKey>("3Y");
  const e = code ? byCode.get(code) : undefined;

  if (!e) {
    return (
      <div className="card empty">
        <p>해당 ETF를 찾을 수 없습니다{code ? `: ${code}` : ""}.</p>
        <a className="btn" href={href("/explore")}>ETF 탐색으로</a>
      </div>
    );
  }

  const s = scoreOf(e.code);
  const reason = excludedBy.get(e.code);
  const ex = s ? explain(s, prefs) : null;
  const group = sameGroup(snap.etfs, e);
  const m = e.m;
  const sl = series ? sliceSeries(series, e.code, RANGES[range]) : null;
  const notes = structureNotes(e);
  const minFee = Math.min(...group.map((g) => g.fee ?? Infinity));
  const overseas = isOverseas(e);
  const listing = listingLine(e);
  const price = priceParts(e);
  // 괴리율은 해외 상장 ETF에는 데이터가 없다. 빈칸으로 두지 않고 이유를 적는다.
  const navGapText = (g: EtfRecord) => (isOverseas(g) ? "-" : fmtPercentUnit(g.navGap, 2, true));

  return (
    <>
      <p className="crumb"><a href={href("/")}>추천</a> › <a href={href("/explore")}>탐색</a> › {e.code}</p>
      <header className="detail-head">
        <div>
          <h1>{e.name}</h1>
          <p className="sub">{e.code} · {e.issuer ?? "운용사 미상"} · {typeLine(e)}</p>
          {listing && <p className="sub">{listing}</p>}
          <div className="etf-meta"><TagChips etf={e} max={8} /><RiskPips etf={e} /></div>
        </div>
        <div className="price-box">
          {price.sub ? (
            <b>{price.main} <small className="price-krw">({price.sub})</small></b>
          ) : (
            <b>{Math.round(e.price).toLocaleString("ko-KR")}<small>원</small></b>
          )}
          <span className="muted">전일 대비 {e.changeRate === null ? "-" : <span className={e.changeRate > 0 ? "up" : e.changeRate < 0 ? "down" : ""}>{fmtPercentUnit(e.changeRate, 2, true)}</span>}</span>
          <span className="muted">{fmtDate(m.asOf)} 종가{overseas ? " · 현지 거래일 기준" : ""}</span>
          {overseas && <span className="muted">{FX_NOTE}</span>}
        </div>
      </header>

      {s && ex ? (
        <section className="card score-card" aria-label="추천 점수">
          <div className="score-big"><b>{Math.round(s.score)}</b><small>/100</small></div>
          <div className="score-body">
            <p className="headline">{ex.headline}</p>
            <ul className="reasons">{ex.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
          <div className="score-bars"><FactorBars factors={s.factors} /></div>
        </section>
      ) : (
        <section className="card notice" aria-label="추천 제외 안내">
          <b>현재 조건에서는 추천 후보가 아닙니다.</b>
          <p>{reason ?? "후보 조건을 충족하지 않습니다."}</p>
          <p className="hint">아래 정보는 참고용으로 확인할 수 있습니다. 홈에서 상장 시장이나 고급 옵션을 바꾸면 후보에 포함될 수도 있습니다.</p>
        </section>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="what-h">
          <h2 id="what-h">이 ETF는 무엇인가요?</h2>
          <p>
            <b>{typeLine(e)}</b>에 투자하는 ETF입니다.
            {e.tax.tags.includes("active") ? " 운용역이 종목을 골라 지수 대비 초과수익을 노립니다." : " 정해진 지수의 움직임을 따라가도록 운용됩니다."}
          </p>
          {notes.length > 0 && <ul className="plain">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {e.description && (
            <>
              <h3>운용사 설명</h3>
              <p className="quote">{e.description}</p>
            </>
          )}
          <h3>세금</h3>
          <p>{taxNote(e)} <span className="muted">세법은 바뀔 수 있고 개인 상황에 따라 다릅니다.</span></p>
        </section>

        <section className="card" aria-labelledby="key-h">
          <h2 id="key-h">핵심 정보</h2>
          <dl className="kv">
            <div><dt>상장 시장</dt><dd><MarketBadge etf={e} /> {MARKET_LABEL[marketOf(e)]}</dd></div>
            {overseas && (
              <>
                <div><dt>거래소</dt><dd>{e.exchange ?? "-"}</dd></div>
                <div><dt>모닝스타 카테고리 <small className="muted">(참고)</small></dt><dd>{e.category ?? "-"}</dd></div>
                <div><dt>거래 통화</dt><dd>달러(USD)</dd></div>
              </>
            )}
            <div><dt>총보수 (연)</dt><dd>{fmtFee(e.fee)} <small className="muted">1,000만원당 연 {e.fee === null ? "-" : feeWonPer10M(e.fee).toLocaleString("ko-KR")}원</small></dd></div>
            <div><dt>순자산{overseas && <small className="muted"> (원화 환산)</small>}</dt><dd>{fmtEok(e.aumEok)}</dd></div>
            <div><dt>일평균 거래대금(20일){overseas && <small className="muted"> (원화 환산)</small>}</dt><dd>{fmtWon(m.avgValue20)}</dd></div>
            <div><dt>최근 12개월 분배율</dt><dd>{fmtPercentUnit(e.divYield)}</dd></div>
            <div><dt>괴리율</dt><dd>{overseas ? <>- <small className="muted">해외 상장은 제공하지 않음</small></> : fmtPercentUnit(e.navGap, 2, true)}</dd></div>
            <div><dt>시세 보유 기간</dt><dd>{fmtHistory(m.years, m.days)} {m.days < 1990 && <small className="muted">({fmtDate(m.firstDate)}~)</small>}</dd></div>
            <div><dt>연 변동성 (3년/1년)</dt><dd>{fmtRatio(m.vol3y, 0)} / {fmtRatio(m.vol1y, 0)}</dd></div>
            <div><dt>최대낙폭 ({m.mdd3y !== null ? "3년" : "1년"})</dt><dd>{fmtRatio(mddOf(e), 1)}</dd></div>
            <div><dt>52주 고점 대비</dt><dd>{fmtRatio(m.drawdown, 1)}</dd></div>
            <div><dt>샤프지수 ({m.sharpe3y !== null ? "3년" : "1년"})</dt><dd>{(m.sharpe3y ?? m.sharpe1y)?.toFixed(2) ?? "-"}</dd></div>
          </dl>
          <p className="hint">변동성 기준 위험: {volOf(e) === null ? "정보 없음" : `연 ${fmtRatio(volOf(e), 0)}`}. 수익률은 분배금이 보정된 수정주가 기준입니다.</p>
          {overseas && <FxNote>{FX_NOTE}. 순자산은 달러 순자산에 기준일 환율을, 거래대금은 거래일 환율을 곱했고, 변동성·최대낙폭·수익률에는 환율 변동이 그대로 들어 있습니다.</FxNote>}
        </section>
      </div>

      <section className="card" aria-labelledby="chart-h">
        <div className="section-head">
          <h2 id="chart-h">가격 추이 (주간 종가{overseas ? ", 원화 환산" : ""})</h2>
          <div className="seg small" role="radiogroup" aria-label="기간">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={range === k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{k}</button>
            ))}
          </div>
        </div>
        {sl ? (
          <LineChart
            dates={sl.dates}
            series={[{ id: e.code, label: e.name, color: "var(--series-1)", values: sl.values }]}
            yFormat={(v) => Math.round(v).toLocaleString("ko-KR")}
            ariaLabel={`${e.name} 최근 ${range} 주간 종가 추이${overseas ? "(원화 환산)" : ""}. 최근 1년 수익률 ${fmtRatio(m.ret.y1, 1, true)}`}
          />
        ) : (
          <div className="chart-loading">차트 불러오는 중…</div>
        )}
        {overseas && <FxNote>이 차트와 아래 수익률은 달러 수정종가 × 같은 날 원/달러 환율로 바꾼 원화 기준입니다. 환율 변동이 포함되어 달러 기준 차트·수익률과 다를 수 있습니다.</FxNote>}
        <table className="returns">
          <caption className="sr-only">기간별 수익률</caption>
          <thead><tr><th>1개월</th><th>3개월</th><th>6개월</th><th>1년</th><th>3년</th><th>5년</th></tr></thead>
          <tbody>
            <tr>
              <td><Delta v={m.ret.m1} /></td><td><Delta v={m.ret.m3} /></td><td><Delta v={m.ret.m6} /></td>
              <td><Delta v={m.ret.y1} /></td><td><Delta v={m.ret.y3} /></td><td><Delta v={m.ret.y5} /></td>
            </tr>
            <tr className="sub-row">
              <td colSpan={3} />
              <td>연 <Delta v={m.cagr1y} /></td><td>연 <Delta v={m.cagr3y} /></td><td>연 <Delta v={m.cagr5y} /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <HoldingsSection etf={e} />

      <section className="card" aria-labelledby="warn-h">
        <h2 id="warn-h">알아둘 점</h2>
        <CautionList items={cautions(e)} />
        {cautions(e).length === 0 && <p className="muted">특별히 눈에 띄는 구조적 주의사항은 없습니다. 그래도 모든 투자에는 원금 손실 위험이 있습니다.</p>}
      </section>

      {group.length > 1 && (
        <section className="card" aria-labelledby="grp-h">
          <div className="section-head">
            <h2 id="grp-h">같은 지수를 추종하는 ETF {group.length}개</h2>
            <a className="btn ghost" href={compareHref([e.code, ...group.filter((g) => g.code !== e.code).slice(0, 3).map((g) => g.code)])}>차트로 비교</a>
          </div>
          <p className="hint">지수가 같다면 수익률 차이는 대부분 <b>총보수·추적오차·거래 편의성</b>에서 납니다. 보수가 낮고 규모가 큰 쪽이 일반적으로 유리합니다.</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ETF</th><th className="num">총보수</th><th className="num">순자산</th><th className="num">거래대금</th><th className="num">1년</th><th className="num">괴리율</th></tr></thead>
              <tbody>
                {group.map((g) => (
                  <tr key={g.code} className={g.code === e.code ? "current" : ""}>
                    <td className="cell-name"><MarketBadge etf={g} /> {g.code === e.code ? <b>{g.name}</b> : <a href={etfHref(g.code)}>{g.name}</a>}</td>
                    <td className="num">{fmtFee(g.fee)}{g.fee === minFee && <span className="badge">최저</span>}</td>
                    <td className="num">{fmtEok(g.aumEok)}</td>
                    <td className="num">{fmtWon(g.m.avgValue20)}</td>
                    <td className="num"><Delta v={g.m.ret.y1} /></td>
                    <td className="num">{navGapText(g)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <Disclaimer />
    </>
  );
}
