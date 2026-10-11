import { useState } from "react";
import type { EtfRecord } from "../../core/types";
import { fmtNum, isEn, tr } from "../../core/i18n";
import { issuerLabel } from "../../core/i18n-labels";
import { cautions, explain, indexTrackingSentence, structureNotes, taxNote, typeLine } from "../../core/explain";
import { feeWonPer10M, fmtDate, fmtFee, fmtHistory, fmtPercentUnit, fmtRatio, fmtWon, priceParts } from "../../core/format";
import { MARKET_LABEL, isOverseas, marketOf } from "../../core/market";
import { aumText, fxNote, listingLine } from "../../core/market-view";
import { mddOf, sameGroup, volOf } from "../../core/scoring";
import { CautionList, Delta, Disclaimer, FactorBars, FxNote, MarketBadge, RiskPips, TagChips } from "../components/bits";
import { BasketButton } from "../components/BasketButton";
import { HoldingsSection } from "../components/Holdings";
import { LineChart } from "../components/LineChart";
import { useApp, useSeries } from "../data";
import { compareHref, etfHref, href } from "../router";
import { RANGES, sliceSeries, type RangeKey } from "../series-utils";

export function Detail({ code }: { code: string | null }) {
  const { byCode, snap, prefs, scoreOf, excludedBy } = useApp();
  const { data: series } = useSeries();
  const [range, setRange] = useState<RangeKey>("3Y");
  const e = code ? (byCode.get(code) ?? byCode.get(code.toUpperCase())) : undefined; // 티커는 대소문자 구분 없이(#/etf/spy)

  if (!e) {
    return (
      <div className="card empty">
        <p>{tr("해당 ETF를 찾을 수 없습니다", "ETF not found")}{code ? `: ${code}` : ""}.</p>
        <a className="btn" href={href("/explore")}>{tr("ETF 탐색으로", "Back to Explore")}</a>
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
      <p className="crumb"><a href={href("/")}>{tr("추천", "Picks")}</a> › <a href={href("/explore")}>{tr("탐색", "Explore")}</a> › {e.code}</p>
      <header className="detail-head">
        <div>
          <h1>{e.name}</h1>
          <p className="sub">{e.code} · {e.issuer ? issuerLabel(e.issuer) : tr("운용사 미상", "Issuer unknown")} · {typeLine(e)}</p>
          {listing && <p className="sub">{listing}</p>}
          <div className="etf-meta"><TagChips etf={e} max={8} /><RiskPips etf={e} /></div>
          <p className="detail-actions"><BasketButton etf={e} /></p>
        </div>
        <div className="price-box">
          {price.sub ? (
            <b>{price.main} <small className="price-krw">({price.sub})</small></b>
          ) : (
            <b>{isEn() ? `₩${fmtNum(Math.round(e.price))}` : <>{fmtNum(Math.round(e.price))}<small>원</small></>}</b>
          )}
          <span className="muted">{tr("전일 대비", "Day change")}{overseas ? tr("(달러 기준)", " (USD basis)") : ""} {e.changeRate === null ? "-" : <span className={e.changeRate > 0 ? "up" : e.changeRate < 0 ? "down" : ""}>{fmtPercentUnit(e.changeRate, 2, true)}</span>}</span>
          <span className="muted">{fmtDate(m.asOf)} {tr("종가", "close")}{overseas ? tr(" · 현지 거래일 기준", " · local trading day") : ""}</span>
          {overseas && <span className="muted">{fxNote()}</span>}
        </div>
      </header>

      {s && ex ? (
        <section className="card score-card" aria-label={tr("추천 점수", "Pick score")}>
          <div className="score-big"><b>{Math.round(s.score)}</b><small>/100</small></div>
          <div className="score-body">
            <p className="headline">{ex.headline}</p>
            <ul className="reasons">{ex.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
          <div className="score-bars"><FactorBars factors={s.factors} /></div>
        </section>
      ) : (
        <section className="card notice" aria-label={tr("추천 제외 안내", "Why not a pick")}>
          <b>{tr("현재 조건에서는 추천 후보가 아닙니다.", "Not a pick candidate under the current settings.")}</b>
          <p>{reason ?? tr("후보 조건을 충족하지 않습니다.", "Does not meet the candidate criteria.")}</p>
          <p className="hint">{tr("아래 정보는 참고용으로 확인할 수 있습니다. 홈에서 상장 시장이나 고급 옵션을 바꾸면 후보에 포함될 수도 있습니다.", "The details below are for reference. Changing the listing market or advanced options on Picks may bring it into the candidates.")}</p>
        </section>
      )}

      <div className="grid-2">
        <section className="card" aria-labelledby="what-h">
          <h2 id="what-h">{tr("이 ETF는 무엇인가요?", "What is this ETF?")}</h2>
          <p>
            {isEn() ? <>An ETF investing in <b>{typeLine(e)}</b>.</> : <><b>{typeLine(e)}</b>에 투자하는 ETF입니다.</>}
            {indexTrackingSentence(e) ? ` ${indexTrackingSentence(e)}` : null}
          </p>
          {notes.length > 0 && <ul className="plain">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {e.description && (
            <>
              <h3>{tr("운용사 설명", "Issuer description")}</h3>
              <p className="quote">{e.description}{isEn() && /[가-힣]/.test(e.description) && <small className="muted"> (Original: Korean)</small>}</p>
            </>
          )}
          <h3>{tr("세금", "Tax")}</h3>
          <p>{taxNote(e)} <span className="muted">{tr("세법은 바뀔 수 있고 개인 상황에 따라 다릅니다.", "Tax rules can change and depend on your situation.")}</span></p>
        </section>

        <section className="card" aria-labelledby="key-h">
          <h2 id="key-h">{tr("핵심 정보", "Key facts")}</h2>
          <dl className="kv">
            <div><dt>{tr("상장 시장", "Listing market")}</dt><dd><MarketBadge etf={e} /> {MARKET_LABEL[marketOf(e)]}</dd></div>
            {overseas && (
              <>
                <div><dt>{tr("거래소", "Exchange")}</dt><dd>{e.exchange ?? "-"}</dd></div>
                <div><dt>{tr("모닝스타 카테고리", "Morningstar category")} <small className="muted">{tr("(참고)", "(for reference)")}</small></dt><dd>{e.category ?? "-"}</dd></div>
                <div><dt>{tr("거래 통화", "Trading currency")}</dt><dd>{tr("달러(USD)", "US dollar (USD)")}</dd></div>
              </>
            )}
            <div><dt>{tr("총보수 (연)", "Expense ratio (annual)")}</dt><dd>{fmtFee(e.fee)} <small className="muted">{e.fee === null ? tr("1,000만원당 연 -원", "Per ₩10M: -/yr") : isEn() ? `Per ₩10M: ₩${fmtNum(feeWonPer10M(e.fee))}/yr` : `1,000만원당 연 ${fmtNum(feeWonPer10M(e.fee))}원`}</small></dd></div>
            <div><dt>{tr("순자산", "Net assets")}{overseas && <small className="muted"> {tr("(원화 환산)", "(in KRW)")}</small>}</dt><dd>{aumText(e)}{e.aumScope === "fund" && <small className="muted"> {tr("펀드 전체 합계", "fund-wide total")}</small>}</dd></div>
            <div><dt>{tr("일평균 거래대금(20일)", "Avg daily trading value (20d)")}{overseas && <small className="muted"> {tr("(원화 환산)", "(in KRW)")}</small>}</dt><dd>{fmtWon(m.avgValue20)}</dd></div>
            <div><dt>{tr("최근 12개월 분배율", "Distribution yield (12m)")}</dt><dd>{fmtPercentUnit(e.divYield)}</dd></div>
            <div><dt>{tr("괴리율", "Premium/discount to NAV")}</dt><dd>{overseas ? <>- <small className="muted">{tr("해외 상장은 제공하지 않음", "not provided for US-listed")}</small></> : fmtPercentUnit(e.navGap, 2, true)}</dd></div>
            <div><dt>{tr("시세 보유 기간", "Price history")}</dt><dd>{fmtHistory(m.years, m.days)} {m.days < 1990 && <small className="muted">({fmtDate(m.firstDate)}~)</small>}</dd></div>
            <div><dt>{tr("연 변동성 (3년/1년)", "Annual volatility (3y / 1y)")}</dt><dd>{fmtRatio(m.vol3y, 0)} / {fmtRatio(m.vol1y, 0)}</dd></div>
            <div><dt>{tr("최대낙폭", "Max drawdown")} ({m.mdd3y !== null ? tr("3년", "3y") : tr("1년", "1y")})</dt><dd>{fmtRatio(mddOf(e), 1)}</dd></div>
            <div><dt>{tr("52주 고점 대비", "From 52-week high")}</dt><dd>{fmtRatio(m.drawdown, 1)}</dd></div>
            <div><dt>{tr("샤프지수", "Sharpe ratio")} ({m.sharpe3y !== null ? tr("3년", "3y") : tr("1년", "1y")})</dt><dd>{(m.sharpe3y ?? m.sharpe1y)?.toFixed(2) ?? "-"}</dd></div>
          </dl>
          <p className="hint">{tr("변동성 기준 위험", "Volatility-based risk")}: {volOf(e) === null ? tr("정보 없음", "n/a") : tr(`연 ${fmtRatio(volOf(e), 0)}`, `${fmtRatio(volOf(e), 0)} a year`)}. {tr("수익률은 분배금이 보정된 수정주가 기준입니다.", "Returns use dividend-adjusted prices.")}</p>
          {overseas && <FxNote>{fxNote()}. {tr("순자산은 달러 순자산에 기준일 환율을, 거래대금은 거래일 환율을 곱했고, 변동성·최대낙폭·수익률에는 환율 변동이 그대로 들어 있습니다.", "Net assets are the USD figure times the as-of FX rate and trading value uses the trade-date rate; volatility, max drawdown and returns include currency moves as is.")}</FxNote>}
        </section>
      </div>

      <section className="card" aria-labelledby="chart-h">
        <div className="section-head">
          <h2 id="chart-h">{tr(`가격 추이 (주간 종가${overseas ? ", 원화 환산" : ""})`, `Price trend (weekly close${overseas ? ", in KRW" : ""})`)}</h2>
          <div className="seg small" role="radiogroup" aria-label={tr("기간", "Range")}>
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={range === k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{k}</button>
            ))}
          </div>
        </div>
        {sl ? (
          <LineChart
            dates={sl.dates}
            series={[{ id: e.code, label: e.name, color: "var(--series-1)", values: sl.values }]}
            yFormat={(v) => fmtNum(Math.round(v))}
            ariaLabel={tr(`${e.name} 최근 ${range} 주간 종가 추이${overseas ? "(원화 환산)" : ""}. 최근 1년 수익률 ${fmtRatio(m.ret.y1, 1, true)}`, `${e.name} weekly close, last ${range}${overseas ? " (in KRW)" : ""}. 1-year return ${fmtRatio(m.ret.y1, 1, true)}`)}
          />
        ) : (
          <div className="chart-loading">{tr("차트 불러오는 중…", "Loading chart…")}</div>
        )}
        {overseas && <FxNote>{tr("이 차트와 아래 수익률은 달러 수정종가 × 같은 날 원/달러 환율로 바꾼 원화 기준입니다. 환율 변동이 포함되어 달러 기준 차트·수익률과 다를 수 있습니다.", "This chart and the returns below are in KRW: the USD adjusted close times the same-day USD/KRW rate. Currency moves are included, so they can differ from USD charts and returns.")}</FxNote>}
        <table className="returns">
          <caption className="sr-only">{tr("기간별 수익률", "Returns by period")}</caption>
          <thead><tr><th>{tr("1개월", "1M")}</th><th>{tr("3개월", "3M")}</th><th>{tr("6개월", "6M")}</th><th>{tr("1년", "1Y")}</th><th>{tr("3년", "3Y")}</th><th>{tr("5년", "5Y")}</th></tr></thead>
          <tbody>
            <tr>
              <td><Delta v={m.ret.m1} /></td><td><Delta v={m.ret.m3} /></td><td><Delta v={m.ret.m6} /></td>
              <td><Delta v={m.ret.y1} /></td><td><Delta v={m.ret.y3} /></td><td><Delta v={m.ret.y5} /></td>
            </tr>
            <tr className="sub-row">
              <td colSpan={3} />
              <td>{tr("연", "Ann.")} <Delta v={m.cagr1y} /></td><td>{tr("연", "Ann.")} <Delta v={m.cagr3y} /></td><td>{tr("연", "Ann.")} <Delta v={m.cagr5y} /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <HoldingsSection etf={e} />

      <section className="card" aria-labelledby="warn-h">
        <h2 id="warn-h">{tr("알아둘 점", "Things to know")}</h2>
        <CautionList items={cautions(e)} />
        {cautions(e).length === 0 && <p className="muted">{tr("특별히 눈에 띄는 구조적 주의사항은 없습니다. 그래도 모든 투자에는 원금 손실 위험이 있습니다.", "No notable structural cautions. Every investment can still lose principal.")}</p>}
      </section>

      {group.length > 1 && (
        <section className="card" aria-labelledby="grp-h">
          <div className="section-head">
            <h2 id="grp-h">{tr(`같은 지수를 추종하는 ETF ${group.length}개`, `${group.length} ETFs tracking the same index`)}</h2>
            <a className="btn ghost" href={compareHref([e.code, ...group.filter((g) => g.code !== e.code).slice(0, 3).map((g) => g.code)])}>{tr("차트로 비교", "Compare on chart")}</a>
          </div>
          <p className="hint">{isEn() ? <>With the same index, return gaps mostly come from <b>expense ratio, tracking error and ease of trading</b>. Lower fees and larger size generally help.</> : <>지수가 같다면 수익률 차이는 대부분 <b>총보수·추적오차·거래 편의성</b>에서 납니다. 보수가 낮고 규모가 큰 쪽이 일반적으로 유리합니다.</>}</p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ETF</th><th className="num">{tr("총보수", "Expense ratio")}</th><th className="num">{tr("순자산", "Net assets")}</th><th className="num">{tr("거래대금", "Trading value")}</th><th className="num">{tr("1년", "1Y")}</th><th className="num">{tr("괴리율", "Prem/disc")}</th></tr></thead>
              <tbody>
                {group.map((g) => (
                  <tr key={g.code} className={g.code === e.code ? "current" : ""}>
                    <td className="cell-name"><MarketBadge etf={g} /> {g.code === e.code ? <b>{g.name}</b> : <a href={etfHref(g.code)}>{g.name}</a>}</td>
                    <td className="num">{fmtFee(g.fee)}{g.fee === minFee && <span className="badge">{tr("최저", "Lowest")}</span>}</td>
                    <td className="num">{aumText(g)}</td>
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
