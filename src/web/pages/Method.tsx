import { useState } from "react";
import { fmtRatio } from "../../core/format";
import { EXCLUSION_LABEL, FACTOR_KEYS, FACTOR_LABELS, HORIZONS, MIN_AVG_VALUE, PROFILES, effectiveWeights } from "../../core/scoring";
import type { Profile } from "../../core/types";
import { Disclaimer } from "../components/bits";
import { useApp, useBacktest, type BacktestSummary } from "../data";

const signedPp = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%p`;

/** 백테스트 요약에서 직접 계산한 해석 문장. 데이터가 갱신되어도 문장이 사실과 어긋나지 않는다. */
function Reading({ bt }: { bt: BacktestSummary }) {
  const cells = Object.values(bt.profiles).flatMap((byH) => Object.values(byH));
  const total = cells.length;
  const beat = cells.filter((c) => c.excess > 0).length;
  const sig = cells.filter((c) => c.indepMean - c.indepCI > 0).length;
  const naiveHigher = cells.filter((c) => c.naiveTop > c.top).length;
  const naiveWorseDd = cells.filter((c) => c.naiveMdd < c.topMdd).length;
  return (
    <div className="notice">
      <b>어떻게 읽어야 하나요</b>
      <ul className="plain">
        <li>
          모델 상위 후보는 {total}개 구간(투자 성향 × 보유 기간) 중 <b>{beat}개</b>에서 후보 중앙값보다 평균 수익이 높았습니다.
          하지만 겹치지 않는 표본으로 보면 신뢰구간이 0을 벗어난 구간은 <b>{sig}개</b>뿐이라, {sig === 0 ? "모든 구간에서 우연과 구분되지 않습니다" : "나머지는 우연과 구분되지 않습니다"}.
          표본이 짧고 한 번의 장세에 집중되어 있습니다.
        </li>
        <li>
          단순히 ‘최근 1년 수익률 순’으로 고르면 {total}개 중 {naiveHigher}개 구간에서 평균 수익이 더 높았지만, 보유 중 최대낙폭은 {naiveWorseDd}개 구간에서 더 컸습니다.
          이 모델은 더 높은 수익을 예측한다기보다, <b>비슷한 수익을 노리면서 낙폭·비용·거래량을 함께 걸러 고르는 도구</b>로 보는 편이 정확합니다.
        </li>
        <li>상장폐지된 ETF가 빠져 있어(생존편향) 절대 수익은 과대평가되고, 거래비용·세금·괴리율은 반영하지 않았습니다.</li>
      </ul>
    </div>
  );
}

export function Method() {
  const { prefs, snap } = useApp();
  const { data: bt } = useBacktest();
  const [m, setM] = useState<"m3" | "m6" | "m12">("m6");
  const w = effectiveWeights(prefs.profile, prefs.horizon);

  return (
    <>
      <h1>점수는 이렇게 계산됩니다</h1>
      <p className="lead">숨기는 것 없이 방법과 한계를 공개합니다. 이 점수는 <b>미래 수익률 예측기가 아니라, 과거 데이터로 후보를 좁히는 필터</b>입니다.</p>

      <section className="card" aria-labelledby="m1">
        <h2 id="m1">1단계 · 자격 심사 (점수와 별개로 먼저 걸러냄)</h2>
        <ul className="plain">
          <li><b>{EXCLUSION_LABEL.leveraged}</b>: 기본 제외 — 매일 재조정되어 장기 보유에 부적합</li>
          <li><b>순자산</b> {prefs.minAumEok.toLocaleString("ko-KR")}억원 미만 제외 — 청산·상장폐지 위험</li>
          <li><b>일평균 거래대금</b> {(MIN_AVG_VALUE / 1e8).toFixed(0)}억원 미만 제외 — 원하는 가격에 사고팔기 어려움</li>
          <li><b>상장 1년 미만</b> 기본 제외 — 하락장 성과 미검증 (포함 시 3년 미만은 감점)</li>
          <li>
            <b>투자 성향 위험 한도</b> — {(["stable", "balanced", "aggressive"] as Profile[]).map((k, i) => {
              const c = PROFILES[k];
              return (
                <span key={k}>
                  {i > 0 && " / "}
                  {c.label}: {c.maxVol === null ? "제한 없음" : `연 변동성 ${(c.maxVol * 100).toFixed(0)}%·최대낙폭 -${((c.maxMdd ?? 0) * 100).toFixed(0)}% 초과 제외`}
                </span>
              );
            })}
          </li>
        </ul>
      </section>

      <section className="card" aria-labelledby="m2">
        <h2 id="m2">2단계 · 6개 항목을 0~100으로 점수화</h2>
        <p>후보들 사이에서의 <b>순위(백분위)</b>로 계산하므로, 몇몇 종목이 폭등해도 점수 체계가 왜곡되지 않습니다.</p>
        <table className="table">
          <thead><tr><th>항목</th><th>무엇을 보나</th><th className="num">현재 가중치<small>({PROFILES[prefs.profile].label}·{HORIZONS[prefs.horizon].label})</small></th></tr></thead>
          <tbody>
            {FACTOR_KEYS.map((k) => (
              <tr key={k}>
                <td><b>{FACTOR_LABELS[k].name}</b></td>
                <td>{FACTOR_LABELS[k].hint}</td>
                <td className="num"><span className="bar-track inline"><span className="bar-fill" style={{ width: `${w[k] * 100 * 2.2}%` }} /></span> {(w[k] * 100).toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">비용은 총보수 0%=100점·0.7%↑=0점. 신뢰는 순자산·거래대금의 로그 스케일. 같은 지수 ETF는 점수가 가장 높은 하나만 대표로 노출합니다. 수익률은 분배금이 보정된 수정주가(총수익) 기준이고 기간은 달력(1·3·6개월, 1·3·5년) 기준입니다.</p>
      </section>

      <section className="card" aria-labelledby="m3">
        <h2 id="m3">3단계 · 과거에 이 방식을 썼다면? (워크포워드 검증)</h2>
        <p>
          각 월말 시점에 <b>그 시점까지의 데이터만으로</b> 같은 코드를 돌려 상위 10개를 뽑고, 이후 실제 수익률을 같은 시점 후보군 중앙값과 비교했습니다
          ({bt ? `${bt.nDates}개 월말 · ${bt.nEtf.toLocaleString("ko-KR")}개 ETF · 데이터 기준 ${bt.asOf}` : "불러오는 중"}).
        </p>
        <div className="seg small" role="radiogroup" aria-label="보유 기간">
          {([["m3", "3개월"], ["m6", "6개월"], ["m12", "12개월"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={m === k} className={m === k ? "on" : ""} onClick={() => setM(k)}>보유 {l}</button>
          ))}
        </div>
        {bt ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>투자 성향</th><th className="num">모델 상위10 평균</th><th className="num">후보 중앙값</th><th className="num">초과수익 (비중첩, 95% 구간)</th><th className="num">단순 ‘1년 수익률 순’</th><th className="num">보유 중 최대낙폭 (모델 / 1년순)</th><th className="num">점수-수익 상관(IC)</th></tr>
              </thead>
              <tbody>
                {(["stable", "balanced", "aggressive"] as Profile[]).map((p) => {
                  const c = bt.profiles[p]?.[m];
                  if (!c) return null;
                  const sig = c.indepMean - c.indepCI > 0;
                  return (
                    <tr key={p}>
                      <th scope="row">{PROFILES[p].label}</th>
                      <td className="num">{fmtRatio(c.top)}</td>
                      <td className="num">{fmtRatio(c.cand)}</td>
                      <td className="num">{signedPp(c.indepMean)} ± {(c.indepCI * 100).toFixed(1)} <small className="muted">(n={c.indepN}){sig ? "" : " · 0 포함"}</small></td>
                      <td className="num">{fmtRatio(c.naiveTop)}</td>
                      <td className="num">{fmtRatio(c.topMdd, 0)} / {fmtRatio(c.naiveMdd, 0)}</td>
                      <td className="num">{c.ic === null ? "-" : c.ic.toFixed(2)}{c.icCI !== null && <small className="muted"> ±{c.icCI.toFixed(2)}</small>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="chart-loading">불러오는 중…</div>}
        {bt && <Reading bt={bt} />}
      </section>

      <section className="card" aria-labelledby="m4">
        <h2 id="m4">알려진 한계</h2>
        <ul className="plain">
          <li>분류(자산군·테마·구조)는 ETF <b>이름 규칙</b>으로 자동 판별해 일부 오분류가 있을 수 있습니다. 상세 화면의 운용사 설명을 함께 확인하세요.</li>
          <li>데이터는 네이버 금융 공개 정보({snap.asOf.slice(0, 4)}-{snap.asOf.slice(4, 6)}-{snap.asOf.slice(6, 8)} 기준)이며 실시간이 아니고, 오류·지연이 있을 수 있습니다. 매매 전 증권사 앱에서 현재가와 호가를 확인하세요.</li>
          <li>구성종목 겹침, 환율 전망, 금리 사이클, 밸류에이션은 반영하지 않습니다. 여러 ETF를 고르면 같은 종목에 중복 투자될 수 있습니다.</li>
          <li>과거 성과는 미래를 보장하지 않습니다. 이 앱은 투자자문이 아닙니다.</li>
        </ul>
      </section>
      <Disclaimer compact />
    </>
  );
}
