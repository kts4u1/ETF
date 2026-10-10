import { ASSET_CLASS_LABEL } from "../../core/explain";
import { EXCLUSION_LABEL, HORIZONS, PROFILES, diversify } from "../../core/scoring";
import type { AssetClass, ExclusionCode } from "../../core/types";
import { Disclaimer } from "../components/bits";
import { Controls } from "../components/Controls";
import { EtfCard } from "../components/EtfCard";
import { useApp } from "../data";
import { etfHref } from "../router";

export function Home() {
  const { prefs, rec, snap } = useApp();
  const top = diversify(rec.ranked, 10, 2);

  // 자산군별 대표: 전체 순위에서 자산군마다 가장 높은 1개
  const seen = new Set<AssetClass>();
  const perClass = rec.ranked.filter((s) => {
    const c = s.etf.tax.assetClass;
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  const byReason = new Map<ExclusionCode, typeof rec.excluded>();
  for (const x of rec.excluded) {
    const arr = byReason.get(x.code);
    if (arr) arr.push(x);
    else byReason.set(x.code, [x]);
  }
  const reasonRows = [...byReason.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <>
      <section className="hero">
        <h1>내게 맞는 ETF 후보 찾기</h1>
        <p>
          국내 상장 ETF {snap.etfs.length.toLocaleString("ko-KR")}개를 투자 성향과 기간에 맞춰 <b>과거 성과·위험·비용·거래량</b>으로 점수화합니다.
          같은 지수를 따르는 ETF는 하나로 묶고, 위험한 구조(레버리지 등)는 기본으로 걸러냅니다.
        </p>
      </section>

      <Controls />

      <section aria-labelledby="top-h">
        <div className="section-head">
          <h2 id="top-h">{PROFILES[prefs.profile].label} · {HORIZONS[prefs.horizon].label} 상위 후보</h2>
          <span className="muted">후보 {rec.universeSize.toLocaleString("ko-KR")}개 중 · 자산군/테마당 최대 2개</span>
        </div>
        {top.length === 0 ? (
          <div className="card empty">조건에 맞는 ETF가 없습니다. 고급 옵션에서 조건을 완화해 보세요.</div>
        ) : (
          <div className="cards">
            {top.map((s, i) => <EtfCard key={s.etf.code} s={s} rank={i + 1} />)}
          </div>
        )}
        <Disclaimer />
      </section>

      {perClass.length > 1 && (
        <section aria-labelledby="class-h">
          <div className="section-head"><h2 id="class-h">자산군별 대표 후보</h2><span className="muted">각 자산군에서 점수가 가장 높은 1개</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>자산군</th><th>ETF</th><th className="num">점수</th></tr></thead>
              <tbody>
                {perClass.map((s) => (
                  <tr key={s.etf.code}>
                    <td>{ASSET_CLASS_LABEL[s.etf.tax.assetClass]}</td>
                    <td><a href={etfHref(s.etf.code)}>{s.etf.name}</a> <span className="muted">{s.etf.code}</span></td>
                    <td className="num">{Math.round(s.score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="ex-h">
        <details className="card excluded">
          <summary id="ex-h">추천에서 제외된 ETF {rec.excluded.length.toLocaleString("ko-KR")}개 — 왜 제외됐나요?</summary>
          <p className="hint">점수가 높아도 거래가 거의 없거나 규모가 너무 작거나 구조가 위험한 상품은 후보에서 먼저 걸러냅니다.</p>
          <ul className="reason-list">
            {reasonRows.map(([code, items]) => (
              <li key={code}>
                <details>
                  <summary><b>{EXCLUSION_LABEL[code]}</b> <span className="muted">{items.length.toLocaleString("ko-KR")}개</span></summary>
                  <ul className="names">
                    {items.slice(0, 40).map((x) => (
                      <li key={x.etf.code}><a href={etfHref(x.etf.code)}>{x.etf.name}</a> <span className="muted">{x.reason}</span></li>
                    ))}
                    {items.length > 40 && <li className="muted">… 외 {items.length - 40}개 (탐색 화면에서 검색할 수 있습니다)</li>}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </>
  );
}
