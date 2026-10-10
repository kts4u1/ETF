import { useMemo, useState } from "react";
import { typeLine } from "../../core/explain";
import { fmtEok, fmtFee, fmtPercentUnit, fmtRatio, fmtWon } from "../../core/format";
import { mddOf, volOf } from "../../core/scoring";
import type { EtfRecord } from "../../core/types";
import { Disclaimer } from "../components/bits";
import { LineChart } from "../components/LineChart";
import { useApp, useSeries } from "../data";
import { compareHref, etfHref, href } from "../router";
import { RANGES, indexedSeries, type RangeKey } from "../series-utils";

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const MAX = 4;

type Row = { label: string; get: (e: EtfRecord) => number | null; fmt: (e: EtfRecord) => string; better: "high" | "low" };
const ROWS: Row[] = [
  { label: "총보수 (연)", get: (e) => e.fee, fmt: (e) => fmtFee(e.fee), better: "low" },
  { label: "순자산", get: (e) => e.aumEok, fmt: (e) => fmtEok(e.aumEok), better: "high" },
  { label: "일평균 거래대금", get: (e) => e.m.avgValue20, fmt: (e) => fmtWon(e.m.avgValue20), better: "high" },
  { label: "최근 1년", get: (e) => e.m.ret.y1, fmt: (e) => fmtRatio(e.m.ret.y1, 1, true), better: "high" },
  { label: "3년 연평균", get: (e) => e.m.cagr3y, fmt: (e) => fmtRatio(e.m.cagr3y, 1, true), better: "high" },
  { label: "연 변동성", get: (e) => volOf(e), fmt: (e) => fmtRatio(volOf(e), 0), better: "low" },
  { label: "최대낙폭", get: (e) => { const d = mddOf(e); return d === null ? null : -d; }, fmt: (e) => fmtRatio(mddOf(e), 0), better: "low" },
  { label: "샤프지수", get: (e) => e.m.sharpe3y ?? e.m.sharpe1y, fmt: (e) => (e.m.sharpe3y ?? e.m.sharpe1y)?.toFixed(2) ?? "-", better: "high" },
  { label: "괴리율", get: (e) => (e.navGap === null ? null : Math.abs(e.navGap)), fmt: (e) => fmtPercentUnit(e.navGap, 2, true), better: "low" },
];

export function Compare({ codes }: { codes: string[] }) {
  const { byCode, snap } = useApp();
  const { data: series } = useSeries();
  const [range, setRange] = useState<RangeKey>("3Y");
  const [q, setQ] = useState("");
  const picked = codes.map((c) => byCode.get(c)).filter((e): e is EtfRecord => !!e).slice(0, MAX);

  const idx = useMemo(
    () => (series && picked.length ? indexedSeries(series, picked.map((p) => p.code), RANGES[range]) : null),
    [series, picked, range],
  );

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return snap.etfs.filter((e) => !codes.includes(e.code) && (e.name.toLowerCase().includes(s) || e.code.includes(s))).slice(0, 8);
  }, [q, snap, codes]);

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
      <h1>ETF 비교</h1>
      <p className="lead">최대 {MAX}개를 같은 시작점(=100)에 맞춰 비교합니다. 같은 지수를 따르는 ETF라면 선들이 거의 겹치고, 차이는 주로 보수에서 납니다.</p>

      <section className="card">
        <div className="picked">
          {picked.map((p, i) => (
            <span key={p.code} className="pick">
              <span className="legend-key" style={{ background: COLORS[i] }} aria-hidden />
              <a href={etfHref(p.code)}>{p.name}</a>
              <a className="x" aria-label={`${p.name} 제거`} href={compareHref(picked.filter((x) => x.code !== p.code).map((x) => x.code))}>×</a>
            </span>
          ))}
          {picked.length === 0 && <span className="muted">아래에서 ETF를 검색해 추가하세요.</span>}
        </div>
        {picked.length < MAX && (
          <div className="add">
            <input type="search" placeholder="이름 또는 코드로 검색해 추가" value={q} onChange={(e) => setQ(e.target.value)} aria-label="비교할 ETF 검색" />
            {results.length > 0 && (
              <ul className="suggest">
                {results.map((r) => (
                  <li key={r.code}>
                    <a href={compareHref([...picked.map((p) => p.code), r.code])} onClick={() => setQ("")}>{r.name} <span className="muted">{r.code} · {typeLine(r)}</span></a>
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
              <h2 id="cmp-chart">수익률 비교 (시작=100)</h2>
              <div className="seg small" role="radiogroup" aria-label="기간">
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
                  ariaLabel={`${picked.map((p) => p.name).join(", ")} 비교 차트`}
                />
                <p className="hint">공통 시작일 {idx.startDate.slice(0, 4)}-{idx.startDate.slice(4, 6)}-{idx.startDate.slice(6, 8)} 기준. 상장일이 늦은 ETF가 있으면 그 시점부터 비교합니다.</p>
              </>
            ) : <div className="chart-loading">차트 불러오는 중…</div>}
          </section>

          <section className="card" aria-labelledby="cmp-table">
            <h2 id="cmp-table">지표 비교</h2>
            <div className="table-wrap">
              <table className="table compare-table">
                <thead><tr><th />{picked.map((p) => <th key={p.code} className="num"><a href={etfHref(p.code)}>{p.name}</a></th>)}</tr></thead>
                <tbody>
                  {ROWS.map((r) => {
                    const best = bestCodes(r);
                    return (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        {picked.map((p) => {
                          const isBest = best.has(p.code);
                          return <td key={p.code} className={`num${isBest ? " best" : ""}`}>{r.fmt(p)}{isBest && <span className="badge">우위</span>}</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="hint">‘우위’는 해당 행에서 화면에 보이는 값이 가장 유리한 ETF입니다(값이 모두 같으면 표시하지 않음). 행마다 기준이 다르므로 종합 판단은 직접 하세요.</p>
          </section>
        </>
      )}
      <p><a href={href("/explore")}>← ETF 탐색으로</a></p>
      <Disclaimer />
    </>
  );
}
