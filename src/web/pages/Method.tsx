import { useState } from "react";
import { fmtDate, fmtFxRate, fmtRatio, fmtSnapshotList, fmtSurvivorshipGap } from "../../core/format";
import { usCollectionRule } from "../../core/market-view";
import { EXCLUSION_LABEL, FACTOR_KEYS, FACTOR_LABELS, HORIZONS, MIN_AVG_VALUE, PROFILES, effectiveWeights } from "../../core/scoring";
import type { Profile } from "../../core/types";
import { Disclaimer } from "../components/bits";
import { useApp, useBacktest, type BacktestSummary, type ComboCell } from "../data";
import { countComboSig, fmtCI, isSig } from "../significance";

const signedPp = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%p`;
/** 백테스트 요약에서 직접 계산한 해석 문장. 데이터가 갱신되어도 문장이 사실과 어긋나지 않는다. */
function Reading({ bt }: { bt: BacktestSummary }) {
  const cells = Object.values(bt.profiles).flatMap((byH) => Object.values(byH));
  const total = cells.length;
  const beat = cells.filter((c) => c.excess > 0).length;
  const sig = cells.filter(isSig).length;
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
        <li><Survivorship bt={bt} /> 거래비용·세금·괴리율은 반영하지 않았습니다.</li>
      </ul>
    </div>
  );
}

/** 생존편향 문장. 포함한 상장폐지 ETF 수와 목록의 기준일에 따라 자동으로 달라진다. */
function Survivorship({ bt }: { bt: BacktestSummary }) {
  const n = bt.delistedIncluded ?? 0;
  const snaps = bt.delistedSnapshots ?? [];
  if (n === 0) {
    return <><b>상장폐지된 ETF를 포함하지 못했습니다</b>(상장폐지 목록은 로그인·접근 제한으로 자동 수집 불가). 그래서 생존편향으로 절대 수익은 과대평가되었을 수 있습니다.</>;
  }
  return snaps.length ? (
    <>
      KRX 전종목 시세({fmtSnapshotList(snaps)} 기준)에 있었다가 이후 상장폐지된 ETF {n}개를 포함했고, 보유 도중 시세가 끝나면 마지막 가격에 청산된 것으로 계산했습니다.
      다만 <b>부분 보정</b>입니다 — {fmtSurvivorshipGap(snaps)}는 여전히 빠져 있어 절대 수익은 다소 과대평가될 수 있습니다.
    </>
  ) : (
    <>상장폐지 ETF {n}개를 포함했고 보유 도중 시세가 끝나면 마지막 가격에 청산된 것으로 계산했지만, 목록에 없는 상장폐지 ETF는 여전히 빠져 있어 절대 수익은 다소 과대평가될 수 있습니다.</>
  );
}

const COMBO_ROWS = ["추천 상위 3개 균등", "추천 1위 단독", "조합 3개 · 역변동성", "조합 2개 · 역변동성"] as const;
const COMBO_MAIN = "조합 3개 · 역변동성";

/** 조합 검증의 해석 문장. 데이터에서 직접 계산해 갱신 후에도 사실과 어긋나지 않게 한다. */
function ComboReading({ bt }: { bt: BacktestSummary }) {
  const cells = Object.values(bt.combos ?? {}).flatMap((byH) => Object.values(byH).map((row) => row[COMBO_MAIN])).filter((c): c is ComboCell => !!c);
  if (!cells.length) return null;
  const total = cells.length;
  const { lowerMdd, sigMdd, sigRet } = countComboSig(cells);
  const mddGain = cells.map((c) => c.dMdd * 100);
  return (
    <div className="notice">
      <b>어떻게 읽어야 하나요</b>
      <ul className="plain">
        <li>
          ‘{COMBO_MAIN}’(앱이 제안하는 방식)은 {total}개 구간(투자 성향 × 보유 기간) 중 <b>{lowerMdd}개</b>에서 기준보다 보유 중 최대낙폭이 작았고
          (개선 폭 {Math.min(...mddGain).toFixed(1)}~{Math.max(...mddGain).toFixed(1)}%p), 겹치지 않는 표본의 95% 구간이 0을 벗어난 구간은 <b>{sigMdd}개</b>입니다.
        </li>
        <li>
          수익 차이는 {total}개 중 <b>{sigRet}개</b>만 0과 구분됩니다. 즉 <b>조합의 효과는 ‘수익을 더 내는 것’이 아니라 ‘나쁜 경우의 낙폭을 줄이는 것’</b>입니다.
          낙폭 감소는 분산의 기계적 효과라 수익률보다 신뢰할 만하지만, 이 역시 한 번의 장세에서 확인한 것입니다.
        </li>
        <li>과거 시점의 구성종목을 알 수 없어 겹침 필터는 이 검증에 포함되지 않았습니다(상관·분산 효과 부분만 검증). <Survivorship bt={bt} /></li>
      </ul>
    </div>
  );
}

/**
 * 해외(미국) 상장 ETF를 어떻게 다루는지 한곳에 모은 설명. 검증 범위의 한계를 맨 위에 눈에 띄게 둔다.
 * 숫자(개수·기준일·환율·수집 기준)는 모두 데이터와 상수에서 가져온다.
 */
function OverseasKey({ usCount, krCount }: { usCount: number; krCount: number }) {
  return (
    <aside className="notice key" aria-labelledby="us-key-h">
      <b id="us-key-h">해외(미국) 상장 ETF는 검증 범위가 다릅니다</b>
      <ul className="plain">
        <li>
          해외 상장 ETF{usCount > 0 ? `(이 데이터에서 ${usCount.toLocaleString("ko-KR")}개)` : ""}에도 국내 상장 ETF{krCount > 0 ? `(${krCount.toLocaleString("ko-KR")}개)` : ""}와 <b>같은 점수식</b>을 씁니다.
          하지만 <b>백테스트(워크포워드 검증)는 국내 상장 ETF만으로 했습니다.</b> 이 방식이 해외 상장 ETF에서도 과거에 잘 작동했는지는 확인하지 못했습니다.
        </li>
        <li>
          <b>해외 ETF의 생존편향은 보정하지 못했습니다.</b> 이미 상장폐지되어 사라진 해외 ETF는 목록에 없어, 지금 살아남은 ETF만 보고 과거 성과를 평가하게 됩니다. 그래서 해외 ETF의 과거 수익은 실제보다 좋아 보일 수 있습니다.
        </li>
        <li>
          <b>선택 편향도 있습니다.</b> {usCollectionRule()} 순자산은 성과가 좋아 돈이 몰린 ETF일수록 큰 경향이 있어, 해외 ETF 목록에는 과거 성과가 좋았던 종목이 더 많이 남아 있습니다.
          같은 점수여도 국내 ETF보다 해외 ETF가 과거에 더 좋았던 쪽으로 기울어 있을 수 있으니, 두 시장의 점수를 그대로 견주지 마세요.
        </li>
      </ul>
    </aside>
  );
}

function OverseasMethod({ usCount }: { usCount: number }) {
  const { snap } = useApp();
  return (
    <section className="card" aria-labelledby="mus">
      <h2 id="mus">해외(미국) 상장 ETF는 이렇게 다룹니다</h2>
      <ul className="plain">
        <li>
          <b>수집 기준</b> — {usCollectionRule()}. 미국 상장 ETF 전체가 아니라 규모와 거래가 큰 일부이고, 다른 나라에 상장된 ETF와 ETN(발행사 신용에 기대는 상환 증권)은 넣지 않았습니다.
          {usCount > 0 ? ` 이 데이터에는 ${usCount.toLocaleString("ko-KR")}개가 들어 있습니다.` : " 지금 데이터에는 해외 상장 ETF가 없습니다."}
        </li>
        <li>
          <b>원화 환산</b> — 달러 수정종가(배당·분할 보정)에 <b>같은 날 원/달러 환율을 곱해 가격 시계열 자체를 원화로 바꾼 뒤</b>, 국내 ETF와 같은 계산(수익률·변동성·최대낙폭·샤프지수)을 적용합니다.
          그래서 환율이 오르내린 만큼이 수익률·변동성·낙폭에 그대로 들어갑니다. 순자산은 달러 순자산에 기준일 환율을, 일평균 거래대금은 거래일마다의 환율을 곱한 값입니다. 환율 전망은 반영하지 않습니다. 순자산은 야후가 주는 펀드 단위 값이라, 뮤추얼펀드 클래스와 한 몸인 ETF(뱅가드 등)는 다른 클래스까지 합친 값이 나와 † 로 표시합니다(실제 ETF 규모보다 훨씬 큼).
        </li>
        <li>
          <b>데이터 출처</b> — 시세·환율·펀드 정보는 야후 파이낸스의 비공식 API, ETF 목록은 나스닥의 ETF 목록입니다. 공식으로 제공되는 서비스가 아니라서 형식이 바뀌거나 중단될 수 있고, 오류·지연이 있을 수 있습니다.
        </li>
        <li>
          <b>기준일</b> — 국내 시세 기준일 {fmtDate(snap.asOf)}
          {snap.asOfUs ? <>, 해외(미국) 시세 기준일 {fmtDate(snap.asOfUs)}{snap.asOfUs !== snap.asOf ? " (두 날짜가 달라 국내와 해외 가격이 같은 날 값이 아닙니다)" : " (지금은 같은 날짜지만 시차·휴장일 때문에 다를 수 있습니다)"}</> : " (해외 시세 없음)"}
          {snap.fxUsdKrw ? <>, 환산에 쓴 최신 환율 {fmtFxRate(snap.fxUsdKrw.rate)}/달러({fmtDate(snap.fxUsdKrw.date)})</> : null}.
        </li>
        <li>
          <b>분류</b> — 자산군·지역·테마·구조는 영문 이름과 모닝스타 카테고리로 자동 판별하므로 오분류가 있을 수 있습니다. 모닝스타 카테고리(영문)는 참고용으로 화면에 그대로 보여줍니다.
        </li>
        <li>
          <b>제공하지 않는 것</b> — 괴리율(데이터 없음), 구성종목 겹침(조합 제안의 겹침 확인 포함). 세금(양도소득세 등)·환전 비용·거래시간 차이도 점수에 반영하지 않으며 각 ETF 상세의 ‘알아둘 점’에 적어 두었습니다.
        </li>
      </ul>
    </section>
  );
}

export function Method() {
  const { prefs, snap, counts } = useApp();
  const { data: bt } = useBacktest();
  const [m, setM] = useState<"m3" | "m6" | "m12">("m6");
  const w = effectiveWeights(prefs.profile, prefs.horizon);

  return (
    <>
      <h1>점수는 이렇게 계산됩니다</h1>
      <p className="lead">숨기는 것 없이 방법과 한계를 공개합니다. 이 점수는 <b>미래 수익률 예측기가 아니라, 과거 데이터로 후보를 좁히는 필터</b>입니다.</p>
      <OverseasKey usCount={counts.US} krCount={counts.KR} />

      <section className="card" aria-labelledby="m1">
        <h2 id="m1">1단계 · 자격 심사 (점수와 별개로 먼저 걸러냄)</h2>
        <ul className="plain">
          <li><b>{EXCLUSION_LABEL.market}</b>: 상장 시장을 ‘국내 상장’ 또는 ‘해외(미국) 상장’으로 고르면 반대편은 심사 대상에서 뺍니다(기본은 전체)</li>
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
        <h2 id="m2">2단계 · {FACTOR_KEYS.length}개 항목을 0~100으로 점수화</h2>
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

      <OverseasMethod usCount={counts.US} />

      <section className="card" aria-labelledby="m3">
        <h2 id="m3">3단계 · 과거에 이 방식을 썼다면? (워크포워드 검증)</h2>
        <p className="notice key-inline"><b>국내 상장 ETF만의 검증입니다.</b> 아래 결과의 ETF {bt ? `${bt.nEtf.toLocaleString("ko-KR")}개` : ""}는 모두 국내 상장 ETF이고, 해외(미국) 상장 ETF는 포함하지 않았습니다.</p>
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
                  const sig = isSig(c);
                  return (
                    <tr key={p}>
                      <th scope="row">{PROFILES[p].label}</th>
                      <td className="num">{fmtRatio(c.top)}</td>
                      <td className="num">{fmtRatio(c.cand)}</td>
                      <td className="num">{signedPp(c.indepMean)} ± {fmtCI(c.indepCI)} <small className="muted">(n={c.indepN}){sig ? "" : " · 0 포함"}</small></td>
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
        {bt && <p className="hint">‘비중첩’은 보유 기간 간격(3·6·12개월)의 달만 뽑아 서로 겹치지 않게 한 표본입니다. 어느 달부터 뽑느냐에 따라 결과가 달라지므로 시작 달을 가능한 모든 경우로 계산해 평균했고, 표본이 2~22개뿐이라 구간은 t 분포로 계산했습니다(n 은 시작 달별 표본 수의 평균을 반올림한 값).</p>}
        {bt && <Reading bt={bt} />}
      </section>

      {bt?.combos && (
        <section className="card" aria-labelledby="m3b">
          <h2 id="m3b">4단계 · 조합 제안은 효과가 있었나? (워크포워드 검증)</h2>
          <p>
            같은 방식으로, 각 월말에 만든 조합을 <b>처음 비중으로 보유</b>했을 때의 실제 결과를 ‘추천 상위 3개를 균등하게 산 것’과 비교했습니다({bt.comboMonths}개 월말, 위 보유 기간 선택과 연동).
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>투자 성향</th><th>전략</th><th className="num">평균 수익</th><th className="num">평균 최대낙폭</th><th className="num">나쁜 달(하위 10%) 수익</th><th className="num">낙폭 차이 vs 균등 Top3 (비중첩 95%)</th><th className="num">수익 차이 vs 균등 Top3</th></tr>
              </thead>
              <tbody>
                {(["stable", "balanced", "aggressive"] as Profile[]).flatMap((p) =>
                  COMBO_ROWS.map((name, k) => {
                    const c = bt.combos?.[p]?.[m]?.[name];
                    if (!c) return null;
                    const base = name === COMBO_ROWS[0];
                    return (
                      <tr key={`${p}-${name}`} className={name === COMBO_MAIN ? "current" : ""}>
                        {k === 0 ? <th scope="row" rowSpan={COMBO_ROWS.length}>{PROFILES[p].label}</th> : null}
                        <td>{name}{name === COMBO_MAIN && <span className="badge">앱 방식</span>}</td>
                        <td className="num">{fmtRatio(c.ret)}</td>
                        <td className="num">{fmtRatio(c.mdd)}</td>
                        <td className="num">{fmtRatio(c.p10)}</td>
                        <td className="num">{base ? "-" : `${signedPp(c.dMdd)} ± ${fmtCI(c.dMddCI)}`}</td>
                        <td className="num">{base ? "-" : `${signedPp(c.dRet)} ± ${fmtCI(c.dRetCI)}`}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <ComboReading bt={bt} />
        </section>
      )}

      <section className="card" aria-labelledby="m4">
        <h2 id="m4">알려진 한계</h2>
        <ul className="plain">
          <li>분류(자산군·테마·구조)는 ETF <b>이름 규칙</b>으로 자동 판별해 일부 오분류가 있을 수 있습니다. 상세 화면의 운용사 설명을 함께 확인하세요.</li>
          <li>
            국내 ETF 데이터는 네이버 금융 공개 정보({fmtDate(snap.asOf)} 기준)
            {snap.asOfUs ? <>, 해외(미국) ETF 데이터는 야후 파이낸스(비공식 API)·나스닥 ETF 목록({fmtDate(snap.asOfUs)} 기준)</> : null}
            이며 실시간이 아니고, 오류·지연이 있을 수 있습니다. 매매 전 증권사 앱에서 현재가와 호가를 확인하세요.
          </li>
          {counts.US > 0 && <li>해외(미국) 상장 ETF의 수익률은 환율 변동을 포함한 원화 기준이고, 환율의 앞날은 예측하지 않습니다. 세금·환전·거래시간 차이는 점수에 들어 있지 않습니다.</li>}
          <li>구성종목 겹침, 환율 전망, 금리 사이클, 밸류에이션은 반영하지 않습니다. 여러 ETF를 고르면 같은 종목에 중복 투자될 수 있습니다.</li>
          <li>과거 성과는 미래를 보장하지 않습니다. 이 앱은 투자자문이 아닙니다.</li>
        </ul>
      </section>
      <Disclaimer compact />
    </>
  );
}
