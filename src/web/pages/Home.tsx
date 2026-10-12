import { ASSET_CLASS_LABEL } from "../../core/explain";
import { fmtNum, tr } from "../../core/i18n";
import { MARKET_LABEL } from "../../core/market";
import { MARKET_FILTER_LABEL, describeCounts, summarizeExclusions } from "../../core/market-view";
import { EXCLUSION_LABEL, HORIZONS, PROFILES, diversify } from "../../core/scoring";
import type { AssetClass } from "../../core/types";
import { Disclaimer, MarketBadge } from "../components/bits";
import { Controls } from "../components/Controls";
import { EtfCard } from "../components/EtfCard";
import { useApp } from "../data";
import { etfHref, href } from "../router";

export function Home() {
  const { prefs, rec, counts } = useApp();
  const top = diversify(rec.ranked, 10, 2);

  // 자산군별 대표: 전체 순위에서 자산군마다 가장 높은 1개
  const seen = new Set<AssetClass>();
  const perClass = rec.ranked.filter((s) => {
    const c = s.etf.tax.assetClass;
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  // 선택하지 않은 시장의 ETF는 '나빠서 제외'된 것이 아니므로 목록에 펼치지 않고 개수만 따로 밝힌다
  const { rows: reasonRows, judged, outOfScope } = summarizeExclusions(rec.excluded);
  const noneInMarket = prefs.market !== "all" && counts[prefs.market] === 0;

  return (
    <>
      <section className="hero">
        <h1>{tr("내게 맞는 ETF 후보 찾기", "Find ETF candidates that fit you")}</h1>
        <p>
          {describeCounts(counts)}{tr("를 투자 성향과 기간에 맞춰 ", " are scored for your risk profile and horizon on ")}<b>{tr("과거 성과·위험·비용·거래량", "past performance, risk, cost and trading volume")}</b>{tr("으로 점수화합니다.", ".")}
          {" "}{tr("같은 지수를 따르는 ETF는 하나로 묶고, 위험한 구조(레버리지 등)는 기본으로 걸러냅니다.", "ETFs that track the same index are grouped into one, and risky structures (leveraged, etc.) are filtered out by default.")}
        </p>
        {counts.US > 0 && (
          <p className="hint">
            {tr("해외(미국) 상장 ETF는 원화로 환산한 가격에 같은 점수식을 적용합니다. 다만 과거 검증(백테스트)은 국내 상장 ETF만으로 했습니다.", "US-listed ETFs are scored with the same formula on KRW-converted prices. The historical check (backtest), however, used Korea-listed ETFs only.")}{" "}
            <a href={href("/method")}>{tr("자세히", "Details")}</a>
          </p>
        )}
      </section>

      <Controls />

      <section aria-labelledby="top-h">
        <div className="section-head">
          <h2 id="top-h">{tr(`${PROFILES[prefs.profile].label} · ${HORIZONS[prefs.horizon].label} 상위 후보`, `Top candidates · ${PROFILES[prefs.profile].label} · ${HORIZONS[prefs.horizon].label}`)}</h2>
          <span className="muted">
            {prefs.market === "all" ? "" : `${MARKET_LABEL[prefs.market]} · `}
            {tr(`후보 ${fmtNum(rec.universeSize)}개 중 · 자산군/테마당 최대 2개`, `Out of ${fmtNum(rec.universeSize)} candidates · max 2 per asset class/theme`)}
          </span>
        </div>
        {top.length === 0 ? (
          <div className="card empty">
            {noneInMarket
              ? <>{tr(`이 데이터에는 ${MARKET_LABEL[prefs.market as "KR" | "US"]} ETF가 없습니다. 상장 시장을 ‘${MARKET_FILTER_LABEL.all}’로 바꿔 보세요.`, `This data has no ${MARKET_LABEL[prefs.market as "KR" | "US"]} ETFs. Try setting the listing market to “${MARKET_FILTER_LABEL.all}”.`)}</>
              : <>{tr("조건에 맞는 ETF가 없습니다. 고급 옵션에서 조건을 완화해 보세요.", "No ETFs match. Try relaxing the filters under Advanced options.")}</>}
          </div>
        ) : (
          <div className="cards">
            {top.map((s, i) => <EtfCard key={s.etf.code} s={s} rank={i + 1} />)}
          </div>
        )}
        <Disclaimer />
        {top.length >= 3 && (
          <p className="cta"><a className="btn ghost" href={href("/combo")}>{tr("이 후보들로 2~3개 조합 만들기 →", "Build a 2–3 ETF combo from these →")}</a> <span className="muted">{tr("서로 다르게 움직이는 ETF를 섞어 하락 때 덜 빠지게", "Mix ETFs that move differently to soften drawdowns")}</span></p>
        )}
      </section>

      {perClass.length > 1 && (
        <section aria-labelledby="class-h">
          <div className="section-head"><h2 id="class-h">{tr("자산군별 대표 후보", "Top candidate by asset class")}</h2><span className="muted">{tr("각 자산군에서 점수가 가장 높은 1개", "The highest-scoring one in each asset class")}</span></div>
          <div className="table-wrap">
            <table className="table rec-table">
              <thead><tr><th>{tr("자산군", "Asset class")}</th><th>ETF</th><th className="num">{tr("점수", "Score")}</th></tr></thead>
              <tbody>
                {perClass.map((s) => (
                  <tr key={s.etf.code}>
                    <td>{ASSET_CLASS_LABEL[s.etf.tax.assetClass]}</td>
                    <td><MarketBadge etf={s.etf} /> <a href={etfHref(s.etf.code)}>{s.etf.name}</a> <span className="muted">{s.etf.code}</span></td>
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
          <summary id="ex-h">{tr(`추천에서 제외된 ETF ${fmtNum(judged)}개 — 왜 제외됐나요?`, `${fmtNum(judged)} ETFs excluded from the picks — why?`)}</summary>
          <p className="hint">{tr("점수가 높아도 거래가 거의 없거나 규모가 너무 작거나 구조가 위험한 상품은 후보에서 먼저 걸러냅니다.", "Products that are barely traded, too small or structurally risky are filtered out first, however high they might score.")}</p>
          <ul className="reason-list">
            {reasonRows.map(([code, items]) => (
              <li key={code}>
                <details>
                  <summary><b>{EXCLUSION_LABEL[code]}</b> <span className="muted">{tr(`${fmtNum(items.length)}개`, fmtNum(items.length))}</span></summary>
                  <ul className="names">
                    {items.slice(0, 40).map((x) => (
                      <li key={x.etf.code}><a href={etfHref(x.etf.code)}>{x.etf.name}</a> <span className="muted">{x.reason}</span></li>
                    ))}
                    {items.length > 40 && <li className="muted">{tr(`… 외 ${items.length - 40}개 (탐색 화면에서 검색할 수 있습니다)`, `… and ${items.length - 40} more (search them in Explore)`)}</li>}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
          {outOfScope > 0 && (
            <p className="hint">
              {tr(
                `상장 시장을 ‘${MARKET_FILTER_LABEL[prefs.market]}’로 골라 심사 대상에서 뺀 ${prefs.market === "KR" ? MARKET_LABEL.US : MARKET_LABEL.KR} ETF ${fmtNum(outOfScope)}개는 위 개수에 넣지 않았습니다.`,
                `${fmtNum(outOfScope)} ${prefs.market === "KR" ? MARKET_LABEL.US : MARKET_LABEL.KR} ETFs left out of the review by the “${MARKET_FILTER_LABEL[prefs.market]}” listing-market choice are not counted above.`,
              )}
            </p>
          )}
        </details>
      </section>
    </>
  );
}
