import { useMemo, useState } from "react";
import { GLOSSARY } from "../../core/glossary";
import { href } from "../router";
import { Disclaimer } from "../components/bits";

const STEPS = [
  { t: "무엇에 투자하는지 먼저 본다", d: "ETF 이름에는 대부분 힌트가 있습니다. ‘미국S&P500’은 미국 대형주 500개, ‘국고채10년’은 한국 10년 국채, ‘반도체TOP10’은 반도체 상위 10종목입니다. 이 앱의 자산군·테마 칩이 이를 풀어서 보여줍니다." },
  { t: "구조를 확인한다 — 이름 끝 표기가 중요", d: "(H)=환헤지, (합성)=스왑 구조, 액티브=운용역이 종목 선택, TR=분배금 재투자, 커버드콜=상승 일부 포기+옵션 프리미엄, 레버리지/인버스=하루 수익률의 배수. 해외 상장 ETF에는 버퍼(손실 일부를 막는 대신 상승 한도), 변동성(VIX) 같은 구조도 있습니다. 이런 표기가 있으면 위험과 비용이 달라집니다." },
  { t: "어느 시장에 상장돼 있는지 본다", d: "같은 미국 지수를 따라가도 한국 거래소에 상장된 ETF는 원화로, 미국 거래소에 상장된 ETF는 달러로 거래됩니다. 이 앱은 ‘국내’/‘미국’ 배지로 구분합니다. 해외(미국) 상장 ETF는 환전이 필요하고 거래 시간이 한국 시간 밤이며 세금 체계가 다르고, 환율 변동이 수익에 그대로 반영됩니다. 이 앱은 이를 원화로 환산해 국내 ETF와 같은 기준으로 보여주지만, 과거 검증은 국내 상장 ETF만으로 했습니다." },
  { t: "같은 지수라면 ‘비용’과 ‘규모’로 고른다", d: "S&P500 ETF는 운용사별로 10개가 넘지만 같은 지수를 따릅니다. 이럴 땐 총보수가 낮고, 순자산이 크고, 거래대금이 많은 쪽이 대체로 유리합니다. 상세 화면의 ‘같은 지수 ETF’ 표에서 비교하세요." },
  { t: "과거의 ‘얼마 벌었나’보다 ‘얼마나 흔들렸나’를 본다", d: "최근 1년 +120%를 보고 사면, 같은 상품이 -40%까지 빠졌던 구간(최대낙폭)을 견뎌야 합니다. 내가 감당할 수 있는 낙폭을 먼저 정하고, 그 안에 드는 후보만 보세요. 투자 성향 설정이 이를 대신해 줍니다." },
  { t: "새로 나온 ETF는 일단 지켜본다", d: "상장 1년 미만이면 하락장 성과가 없습니다. 이 앱은 기본으로 추천에서 제외하고, 포함하면 점수를 깎습니다. 신규 ETF는 ‘탐색’에서 상장 기간 순으로 정렬해 볼 수 있습니다." },
  { t: "세금과 계좌도 수익의 일부", d: "국내 주식형 ETF는 매매차익이 비과세지만 해외·채권·원자재 ETF는 과세됩니다. 해외(미국) 상장 ETF는 현행 기준으로 매매차익에 양도소득세가 따로 붙습니다. ISA·연금저축·IRP에서 사면 세금을 미룰 수 있습니다. 같은 상품도 계좌에 따라 실수익이 달라집니다." },
];

export function Learn() {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? GLOSSARY.filter((g) => (g.term + g.short + g.long).toLowerCase().includes(s)) : GLOSSARY;
  }, [q]);

  return (
    <>
      <h1>ETF, 이렇게 고르세요</h1>
      <p className="lead">ETF가 너무 많아서 막막할 때 순서대로 확인하면 되는 {STEPS.length}단계와 용어 사전입니다.</p>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={i} className="card"><span className="step-no" aria-hidden>{i + 1}</span><div><h3>{s.t}</h3><p>{s.d}</p></div></li>
        ))}
      </ol>

      <div className="section-head">
        <h2 id="gloss">용어 사전</h2>
        <input type="search" placeholder="용어 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="용어 검색" />
      </div>
      <dl className="glossary">
        {list.map((g) => (
          <div key={g.term} className="card">
            <dt>{g.term} <span className="muted">— {g.short}</span></dt>
            <dd>{g.long}</dd>
          </div>
        ))}
      </dl>
      {list.length === 0 && <div className="card empty">검색 결과가 없습니다.</div>}
      <p><a href={href("/method")}>점수는 어떻게 계산되나요? →</a></p>
      <Disclaimer compact />
    </>
  );
}
