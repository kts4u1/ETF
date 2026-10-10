import { useMemo } from "react";
import {
  commonHoldings,
  exposureOf,
  overlapLevel,
  overlapMatrix,
  rankOverlaps,
  topWeight,
  type Exposure,
  type HoldingsFile,
} from "../../core/overlap";
import { isOverseas } from "../../core/market";
import type { EtfRecord } from "../../core/types";
import { useApp, useHoldings } from "../data";
import { compareHref, etfHref } from "../router";

const UNAVAILABLE_TEXT: Record<string, string> = {
  "derivative-structure": "레버리지·인버스·합성(스왑) ETF는 선물·스왑으로 지수를 추종해서, 보유 종목이 실제 노출을 나타내지 않아 겹침을 계산하지 않습니다.",
  "low-coverage": "선물·스왑 등 종목이 아닌 자산 비중이 커서 구성종목으로 실제 노출을 설명하기 어렵습니다.",
  "no-data": "공시된 구성종목 정보가 없습니다.",
  "overseas-listed": "해외 상장 ETF는 구성종목 전체를 구할 수 없어 겹침을 계산하지 않습니다.",
};

const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;

/** 구성종목을 계산하지 못한 사유. 해외 상장은 파일에 사유가 없어도 '해외 상장이라서'가 정확한 설명이다. */
const unavailableKey = (e: Pick<EtfRecord, "market">, reason: string | undefined): string => (isOverseas(e) ? "overseas-listed" : reason ?? "no-data");

/** 상세 화면: 구성종목 상위·집중도, 그리고 구성이 비슷한 ETF */
export function HoldingsSection({ etf }: { etf: EtfRecord }) {
  const { data: file, error } = useHoldings();
  const { byCode } = useApp();

  const view = useMemo(() => {
    if (!file) return null;
    const me = exposureOf(file, etf.code);
    if (!me) return { me: undefined as Exposure | undefined, similar: [] as { code: string; pct: number }[] };
    const others: [string, Exposure][] = [];
    for (const code of Object.keys(file.etfs)) {
      const e = exposureOf(file, code);
      if (e) others.push([code, e]);
    }
    return { me, similar: rankOverlaps(etf.code, me, others, 8, 10) };
  }, [file, etf.code]);

  if (error) return null;
  if (!file || !view) return <section className="card"><h2>구성종목</h2><div className="chart-loading">불러오는 중…</div></section>;

  if (!view.me) {
    return (
      <section className="card" aria-labelledby="hold-h">
        <h2 id="hold-h">구성종목</h2>
        <p className="muted">{UNAVAILABLE_TEXT[unavailableKey(etf, file.unavailable[etf.code])]}</p>
      </section>
    );
  }

  const me = view.me;
  const e = file.etfs[etf.code]!;
  const top = me.ids.slice(0, 10).map((id, i) => ({ id, w: me.w[i] as number }));
  const top1 = topWeight(me, 1);
  const top10 = topWeight(me, 10);

  return (
    <>
      <section className="card" aria-labelledby="hold-h">
        <h2 id="hold-h">구성종목 상위 10</h2>
        <dl className="stats compact">
          <div><dt>1위 종목 비중</dt><dd>{pct(top1)}</dd></div>
          <div><dt>상위 10개 합</dt><dd>{pct(top10)}</dd></div>
          <div><dt>식별된 종목 수</dt><dd>{e.n.toLocaleString("ko-KR")}개</dd></div>
          <div><dt>종목으로 식별된 비중</dt><dd>{pct(e.t, 0)}</dd></div>
        </dl>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>종목</th><th className="num" style={{ width: "46%" }}>비중</th></tr></thead>
            <tbody>
              {top.map((h) => (
                <tr key={h.id}>
                  <td>{file.names[h.id]}</td>
                  <td className="num">
                    <span className="bar-track inline wide"><span className="bar-fill" style={{ width: `${Math.min(100, (h.w / Math.max(top[0]!.w, 1)) * 100)}%` }} /></span> {pct(h.w, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          비중은 순자산 대비입니다. 나머지는 현금·예금·선물·스왑 등 종목으로 보기 어려운 자산입니다.
          {e.lt > 0 && <> 이 ETF는 다른 ETF에 {pct(e.lt, 0)}를 투자하고 있어, 그 ETF들을 <b>풀어서</b> 실제 종목 기준으로 환산했습니다.</>}
        </p>
        {top1 >= 25 && <p className="hint"><b>집중 주의:</b> 한 종목이 {pct(top1, 0)}를 차지합니다. 지수 ETF라도 소수 종목의 영향이 큽니다.</p>}
      </section>

      {view.similar.length > 0 && (
        <section className="card" aria-labelledby="sim-h">
          <div className="section-head">
            <h2 id="sim-h">구성이 비슷한 ETF</h2>
            <span className="muted">겹침 10% 이상, 높은 순</span>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            ‘겹침’은 두 ETF에 같은 금액을 넣었을 때 같은 종목에 들어가는 비중입니다. 겹침이 높은 ETF를 함께 사면 분산 효과가 작습니다.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ETF</th><th className="num">겹침</th><th>수준</th><th /></tr></thead>
              <tbody>
                {view.similar.map((s) => {
                  const other = byCode.get(s.code);
                  if (!other) return null;
                  const lv = overlapLevel(s.pct);
                  return (
                    <tr key={s.code}>
                      <td><a href={etfHref(s.code)}>{other.name}</a>{other.tax.groupKey === etf.tax.groupKey && <span className="badge">같은 지수</span>}</td>
                      <td className="num"><b>{pct(s.pct, 0)}</b></td>
                      <td>{lv.label}</td>
                      <td className="num"><a href={compareHref([etf.code, s.code])}>비교</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

/** 비교 화면: 선택한 ETF끼리의 겹침 행렬과, 가장 많이 겹치는 쌍의 공통 종목 */
export function OverlapPanel({ codes }: { codes: string[] }) {
  const { data: file } = useHoldings();
  const { byCode } = useApp();

  const data = useMemo(() => {
    if (!file || codes.length < 2) return null;
    const exps = codes.map((c) => exposureOf(file, c));
    const matrix = overlapMatrix(exps);
    let best: { i: number; j: number; v: number } | null = null;
    for (let i = 0; i < codes.length; i++)
      for (let j = i + 1; j < codes.length; j++) {
        const v = matrix[i]![j]!;
        if (Number.isFinite(v) && (!best || v > best.v)) best = { i, j, v };
      }
    const common = best ? commonHoldings(exps[best.i]!, exps[best.j]!, 8) : [];
    return { exps, matrix, best, common };
  }, [file, codes]);

  if (codes.length < 2) return null;
  if (!file || !data) return <section className="card"><h2>구성종목 겹침</h2><div className="chart-loading">불러오는 중…</div></section>;

  const label = (c: string) => byCode.get(c)?.name ?? c;
  return (
    <section className="card" aria-labelledby="ovl-h">
      <h2 id="ovl-h">구성종목 겹침</h2>
      <p className="hint" style={{ marginTop: 0 }}>같은 금액을 넣었을 때 같은 종목에 들어가는 비중(%)입니다. 100%에 가까우면 사실상 같은 ETF입니다.</p>
      <div className="table-wrap">
        <table className="table overlap-table">
          <thead>
            <tr><th />{codes.map((c) => <th key={c} className="num">{label(c)}</th>)}</tr>
          </thead>
          <tbody>
            {codes.map((a, i) => (
              <tr key={a}>
                <th scope="row">{label(a)}</th>
                {codes.map((b, j) => {
                  const v = data.matrix[i]![j]!;
                  if (!Number.isFinite(v)) {
                    // 행 ETF 또는 열 ETF 중 계산 불가인 쪽의 사유를 툴팁으로
                    const culprit = data.exps[i] ? b : a;
                    const culpritEtf = byCode.get(culprit);
                    return <td key={b} className="num muted" title={UNAVAILABLE_TEXT[culpritEtf ? unavailableKey(culpritEtf, file.unavailable[culprit]) : file.unavailable[culprit] ?? "no-data"]}>계산 불가</td>;
                  }
                  return (
                    <td key={b} className={`num${i === j ? " diag" : ""}`} style={i === j ? undefined : { background: `color-mix(in srgb, var(--seq-fill) ${Math.min(60, v * 0.6)}%, transparent)` }}>
                      {i === j ? "-" : pct(v, 0)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.best && (
        <>
          <p className="hint">
            가장 많이 겹치는 쌍: <b>{label(codes[data.best.i]!)}</b> ↔ <b>{label(codes[data.best.j]!)}</b> ({pct(data.best.v, 0)}, {overlapLevel(data.best.v).label})
          </p>
          {data.common.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>공통 종목</th><th className="num">{label(codes[data.best.i]!)} 비중</th><th className="num">{label(codes[data.best.j]!)} 비중</th></tr></thead>
                <tbody>
                  {data.common.map((c) => (
                    <tr key={c.id}><td>{file.names[c.id]}</td><td className="num">{pct(c.wa, 2)}</td><td className="num">{pct(c.wb, 2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export type { HoldingsFile };
