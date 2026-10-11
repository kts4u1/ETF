import { useMemo, useState } from "react";
import { typeLine } from "../../core/explain";
import { tr } from "../../core/i18n";
import { fmtFee, fmtPercentUnit, fmtRatio, fmtWon } from "../../core/format";
import { MARKET_LABEL, isOverseas, marketOf } from "../../core/market";
import { aumFundNote, aumText, fxMethod, fxNote, listingLine, matchRank } from "../../core/market-view";
import { mddOf, volOf } from "../../core/scoring";
import type { EtfRecord } from "../../core/types";
import { Disclaimer, FxNote, MarketBadge } from "../components/bits";
import { OverlapPanel } from "../components/Holdings";
import { LineChart } from "../components/LineChart";
import { useApp, useSeries } from "../data";
import { compareHref, etfHref, href } from "../router";
import { RANGES, indexedSeries, type RangeKey } from "../series-utils";

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const MAX = 4;

type Row = { label: string; get: (e: EtfRecord) => number | null; fmt: (e: EtfRecord) => string; better: "high" | "low" };
/** 행 이름이 언어에 따라 달라서 함수로 만든다 */
const rows = (): Row[] => [
  { label: tr("총보수 (연)", "Expense ratio (annual)"), get: (e) => e.fee, fmt: (e) => fmtFee(e.fee), better: "low" },
  { label: tr("순자산", "Net assets"), get: (e) => (e.aumScope === "fund" ? null : e.aumEok), fmt: (e) => aumText(e), better: "high" },
  { label: tr("일평균 거래대금", "Avg daily trading value"), get: (e) => e.m.avgValue20, fmt: (e) => fmtWon(e.m.avgValue20), better: "high" },
  { label: tr("최근 1년", "Last 1 year"), get: (e) => e.m.ret.y1, fmt: (e) => fmtRatio(e.m.ret.y1, 1, true), better: "high" },
  { label: tr("3년 연평균", "3-year CAGR"), get: (e) => e.m.cagr3y, fmt: (e) => fmtRatio(e.m.cagr3y, 1, true), better: "high" },
  { label: tr("연 변동성", "Annualized volatility"), get: (e) => volOf(e), fmt: (e) => fmtRatio(volOf(e), 0), better: "low" },
  { label: tr("최대낙폭", "Max drawdown"), get: (e) => { const d = mddOf(e); return d === null ? null : -d; }, fmt: (e) => fmtRatio(mddOf(e), 0), better: "low" },
  { label: tr("샤프지수", "Sharpe ratio"), get: (e) => e.m.sharpe3y ?? e.m.sharpe1y, fmt: (e) => (e.m.sharpe3y ?? e.m.sharpe1y)?.toFixed(2) ?? "-", better: "high" },
  // 해외 상장은 괴리율 데이터가 없다("-"). 없는 값으로 '우위'를 가리지 않는다.
  { label: tr("괴리율", "Premium/discount to NAV"), get: (e) => (isOverseas(e) || e.navGap === null ? null : Math.abs(e.navGap)), fmt: (e) => (isOverseas(e) ? "-" : fmtPercentUnit(e.navGap, 2, true)), better: "low" },
];

export function Compare({ codes }: { codes: string[] }) {
  const { byCode, snap } = useApp();
  const ROWS = rows();
  const { data: series } = useSeries();
  const [range, setRange] = useState<RangeKey>("3Y");
  const [q, setQ] = useState("");
  const picked = codes.map((c) => byCode.get(c) ?? byCode.get(c.toUpperCase())).filter((e): e is EtfRecord => !!e).slice(0, MAX);

  const idx = useMemo(
    () => (series && picked.length ? indexedSeries(series, picked.map((p) => p.code), RANGES[range]) : null),
    [series, picked, range],
  );

  const results = useMemo(() => {
    if (!q.trim()) return [];
    // 티커·코드가 정확히 맞는 것을 먼저(예: SPY 를 입력하면 이름에 spy 가 들어간 다른 ETF보다 위에)
    return snap.etfs
      .filter((e) => !codes.includes(e.code))
      .map((e) => ({ e, rank: matchRank(e, q) }))
      .filter((x) => x.rank > 0)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 8)
      .map((x) => x.e);
  }, [q, snap, codes]);
  const hasOverseas = picked.some(isOverseas);
  const hasMixed = hasOverseas && picked.some((p) => !isOverseas(p));

  /**
   * 행마다 가장 유리한 ETF를 표시한다. 단, 화면에 보이는 값이 모두 같으면(예: 변동성 15% / 15% / 15%)
   * 소수점 아래의 미세한 차이로 '우위'를 주장하지 않는다.
   */
  const bestCodes = (r: Row): Set<string> => {
    const items = picked.map((p) => ({ code: p.code, v: r.get(p), text: r.fmt(p) })).filter((x): x is { code: string; v: number; text: string } => x.v !== null);
    if (items.length < 2 || new Set(items.map((x) => x.text)).size < 2) return new Set();
    const target = (r.better === "high" ? Math.max : Math.min)(...items.map((x) => x.v));
    const bestText = items.find((x) => x.v === target)!.text;
    return new Set(items.filter((x) => x.text === bestText).map((x) => x.code));
  };

  // 같은 지수끼리 비교하면 브랜드명이 가장 짧고 구분되는 라벨이다
  const sameIndex = picked.length > 1 && picked.every((p) => p.tax.groupKey === picked[0]!.tax.groupKey);

  return (
    <>
      <h1>{tr("ETF 비교", "Compare ETFs")}</h1>
      <p className="lead">{tr(`최대 ${MAX}개를 같은 시작점(=100)에 맞춰 비교합니다. 같은 지수를 따르는 ETF라면 선들이 거의 겹치고, 차이는 주로 보수에서 납니다.`, `Compare up to ${MAX} ETFs rebased to the same starting point (=100). ETFs tracking the same index overlap almost completely; the difference is mostly the fee.`)}</p>

      <section className="card">
        <div className="picked">
          {picked.map((p, i) => (
            <span key={p.code} className="pick">
              <span className="legend-key" style={{ background: COLORS[i] }} aria-hidden />
              <MarketBadge etf={p} />
              <a href={etfHref(p.code)}>{p.name}</a>
              <a className="x" aria-label={tr(`${p.name} 제거`, `Remove ${p.name}`)} href={compareHref(picked.filter((x) => x.code !== p.code).map((x) => x.code))}>×</a>
            </span>
          ))}
          {picked.length === 0 && <span className="muted">{tr("아래에서 ETF를 검색해 추가하세요.", "Search below to add ETFs.")}</span>}
        </div>
        {picked.length < MAX && (
          <div className="add">
            <input type="search" placeholder={tr("이름·코드·티커로 검색해 추가 (예: 반도체, 069500, SPY)", "Search by name, code or ticker to add (e.g. semiconductor, 069500, SPY)")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr("비교할 ETF 검색", "Search ETFs to compare")} />
            {results.length > 0 && (
              <ul className="suggest">
                {results.map((r) => (
                  <li key={r.code}>
                    <a href={compareHref([...picked.map((p) => p.code), r.code])} onClick={() => setQ("")}><MarketBadge etf={r} /> {r.name} <span className="muted">{r.code} · {typeLine(r)}</span></a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {picked.length > 0 && (
        <>
          <section className="card" aria-labelledby="cmp-chart">
            <div className="section-head">
              <h2 id="cmp-chart">{tr("수익률 비교 (시작=100)", "Return comparison (start = 100)")}</h2>
              <div className="seg small" role="radiogroup" aria-label={tr("기간", "Period")}>
                {(Object.keys(RANGES) as RangeKey[]).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={range === k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>{k}</button>
                ))}
              </div>
            </div>
            {idx ? (
              <>
                <LineChart
                  dates={idx.dates}
                  series={idx.rows.map((r, i) => {
                    const etf = byCode.get(r.code)!;
                    return { id: r.code, label: etf.name, shortLabel: sameIndex ? etf.tax.brand : undefined, color: COLORS[i] ?? COLORS[0]!, values: r.values };
                  })}
                  yFormat={(v) => v.toFixed(0)}
                  ariaLabel={tr(`${picked.map((p) => p.name).join(", ")} 비교 차트`, `${picked.map((p) => p.name).join(", ")} comparison chart`)}
                />
                <p className="hint">{tr("공통 시작일", "Common start date")} {idx.startDate.slice(0, 4)}-{idx.startDate.slice(4, 6)}-{idx.startDate.slice(6, 8)}{tr(" 기준. 상장일이 늦은 ETF가 있으면 그 시점부터 비교합니다.", ". If an ETF listed later, the comparison starts from its listing.")}</p>
                {hasOverseas && (
                  <FxNote>
                    {fxNote()}. {tr("해외(미국) 상장 ETF의 선은 환율 변동이 포함된 원화 기준입니다.", "Lines for US-listed ETFs are in KRW and include currency moves.")}{hasMixed ? tr(" 국내 상장 ETF와 같은 원화 기준으로 겹쳐 보이지만, 세금·환전·거래시간은 다릅니다.", " They are plotted on the same KRW basis as Korea-listed ETFs, but taxes, currency exchange and trading hours differ.") : ""}
                  </FxNote>
                )}
              </>
            ) : <div className="chart-loading">{tr("차트 불러오는 중…", "Loading chart…")}</div>}
          </section>

          <OverlapPanel codes={picked.map((p) => p.code)} />

          <section className="card" aria-labelledby="cmp-table">
            <h2 id="cmp-table">{tr("지표 비교", "Metric comparison")}</h2>
            <div className="table-wrap">
              <table className="table compare-table">
                <thead><tr><th />{picked.map((p) => <th key={p.code} className="num"><a href={etfHref(p.code)}>{p.name}</a></th>)}</tr></thead>
                <tbody>
                  <tr>
                    <th scope="row">{tr("상장 시장", "Listing market")}</th>
                    {picked.map((p) => <td key={p.code} className="num"><MarketBadge etf={p} /> {MARKET_LABEL[marketOf(p)]}</td>)}
                  </tr>
                  {hasOverseas && (
                    <tr>
                      <th scope="row">{tr("거래소 · 카테고리", "Exchange · category")} <small className="muted">{tr("(참고)", "(reference)")}</small></th>
                      {picked.map((p) => <td key={p.code} className="num wrap-cell">{listingLine(p) ?? "-"}</td>)}
                    </tr>
                  )}
                  {ROWS.map((r) => {
                    const best = bestCodes(r);
                    return (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        {picked.map((p) => {
                          const isBest = best.has(p.code);
                          return <td key={p.code} className={`num${isBest ? " best" : ""}`}>{r.fmt(p)}{isBest && <span className="badge">{tr("우위", "Best")}</span>}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">{tr("‘우위’는 해당 행에서 화면에 보이는 값이 가장 유리한 ETF입니다(값이 모두 같으면 표시하지 않음). 행마다 기준이 다르므로 종합 판단은 직접 하세요.", "“Best” marks the ETF with the most favorable displayed value in that row (not shown when all values are equal). Criteria differ by row, so make your own overall judgment.")}</p>
            {picked.some((p) => p.aumScope === "fund") && <p className="hint">{aumFundNote()} {tr("그래서 순자산 행의 ‘우위’ 표시에서는 † 항목을 제외합니다.", "So † items are excluded from the “Best” mark in the net assets row.")}</p>}
            {hasOverseas && <FxNote>{tr(`해외(미국) 상장 ETF의 순자산·거래대금·수익률·변동성·최대낙폭은 ${fxMethod()} 기준의 원화 환산값이고, 괴리율은 해외 상장에는 제공하지 않아 ‘-’로 둡니다.`, `Net assets, trading value, returns, volatility and max drawdown of US-listed ETFs are KRW-converted values (${fxMethod()}); premium/discount to NAV is not provided for US listings and is shown as “-”.`)}</FxNote>}
          </section>
        </>
      )}
      <p><a href={href("/explore")}>{tr("← ETF 탐색으로", "← Back to Explore")}</a></p>
      <Disclaimer />
    </>
  );
}
