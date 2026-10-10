import { useMemo, useState } from "react";
import { ASSET_CLASS_LABEL, REGION_LABEL, TAG_LABEL } from "../../core/explain";
import { fmtFee, fmtHistory, fmtRatio, fmtWon } from "../../core/format";
import { isOverseas, marketOf } from "../../core/market";
import { AUM_FUND_NOTE, MARKET_FILTERS, MARKET_FILTER_LABEL, aumText, describeCounts, listingLine, matchesQuery } from "../../core/market-view";
import { mddOf, volOf } from "../../core/scoring";
import type { AssetClass, EtfRecord, MarketFilter, Region } from "../../core/types";
import { Delta, Disclaimer, FxNote, MarketBadge } from "../components/bits";
import { useApp } from "../data";
import { compareHref, etfHref } from "../router";

type SortKey = "score" | "name" | "y1" | "cagr3y" | "vol" | "mdd" | "fee" | "aum" | "value" | "years";

const COLS: { key: SortKey; label: string; num: boolean; desc: boolean; hint?: string }[] = [
  { key: "name", label: "ETF", num: false, desc: false },
  { key: "score", label: "점수", num: true, desc: true, hint: "현재 추천 조건 기준. 후보가 아니면 -" },
  { key: "y1", label: "1년", num: true, desc: true },
  { key: "cagr3y", label: "3년 연평균", num: true, desc: true },
  { key: "vol", label: "변동성", num: true, desc: false },
  { key: "mdd", label: "최대낙폭", num: true, desc: false },
  { key: "fee", label: "총보수", num: true, desc: false },
  { key: "aum", label: "순자산", num: true, desc: true },
  { key: "value", label: "거래대금", num: true, desc: true },
  { key: "years", label: "시세 기간", num: true, desc: true, hint: "수집한 시세 기준(최대 8년)" },
];

const PAGE = 50;

export function Explore() {
  const { snap, scoreOf, counts } = useApp();
  const [q, setQ] = useState("");
  const [mkt, setMkt] = useState<MarketFilter>("all");
  const [cls, setCls] = useState<AssetClass | "">("");
  const [region, setRegion] = useState<Region | "">("");
  const [tag, setTag] = useState("");
  const [onlyCand, setOnlyCand] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "score", dir: -1 });
  const [shown, setShown] = useState(PAGE);
  const [sel, setSel] = useState<string[]>([]);

  const value = (e: EtfRecord, k: SortKey): number | string | null => {
    switch (k) {
      case "name": return e.name;
      case "score": return scoreOf(e.code)?.score ?? null;
      case "y1": return e.m.ret.y1;
      case "cagr3y": return e.m.cagr3y;
      case "vol": return volOf(e);
      case "mdd": return mddOf(e);
      case "fee": return e.fee;
      case "aum": return e.aumScope === "fund" ? null : e.aumEok; // † 펀드 합계는 순위에서 뺀다(ETF 클래스 규모가 아님)
      case "value": return e.m.avgValue20;
      case "years": return e.m.years;
    }
  };

  const rows = useMemo(() => {
    const filtered = snap.etfs.filter((e) => {
      // 검색: 코드(국내 6자리·해외 티커)·이름(국내 한글·해외 영문)·테마(한글), 대소문자·공백 무시
      if (!matchesQuery(e, q)) return false;
      if (mkt !== "all" && marketOf(e) !== mkt) return false;
      if (cls && e.tax.assetClass !== cls) return false;
      if (region && e.tax.region !== region) return false;
      if (tag && !e.tax.tags.includes(tag as never)) return false;
      if (onlyCand && !scoreOf(e.code)) return false;
      return true;
    });
    const { key, dir } = sort;
    // 값이 없는(null) 항목은 정렬 방향과 무관하게 항상 뒤로
    return filtered.sort((a, b) => {
      const va = value(a, key);
      const vb = value(b, key);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = typeof va === "string" ? va.localeCompare(vb as string, "ko") : (va as number) - (vb as number);
      return c * dir;
    });
  }, [snap, q, mkt, cls, region, tag, onlyCand, sort, scoreOf]);
  const hasOverseas = useMemo(() => rows.some(isOverseas), [rows]);

  const toggleSort = (key: SortKey, desc: boolean) => {
    setShown(PAGE);
    setSort((cur) => (cur.key === key ? { key, dir: (cur.dir * -1) as 1 | -1 } : { key, dir: desc ? -1 : 1 }));
  };
  const toggleSel = (code: string) =>
    setSel((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : cur.length >= 4 ? cur : [...cur, code]));

  const regions = useMemo(() => [...new Set(snap.etfs.map((e) => e.tax.region))].filter((r) => r !== "NA"), [snap]);

  return (
    <>
      <h1>ETF 탐색</h1>
      <p className="lead">{describeCounts(counts)}를 검색·필터·정렬합니다. 점수는 홈에서 정한 투자 성향·기간·상장 시장 기준입니다.</p>

      <section className="card filters" aria-label="필터">
        <input type="search" placeholder="이름·코드·티커·테마 검색 (예: 반도체, 미국S&P500, 069500, SPY)" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} aria-label="ETF 검색" />
        <div className="filter-row">
          <label className="select"><span>상장 시장</span>
            <select value={mkt} onChange={(e) => { setMkt(e.target.value as MarketFilter); setShown(PAGE); }}>
              {MARKET_FILTERS.map((k) => <option key={k} value={k}>{MARKET_FILTER_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="select"><span>자산군</span>
            <select value={cls} onChange={(e) => { setCls(e.target.value as AssetClass | ""); setShown(PAGE); }}>
              <option value="">전체</option>
              {(Object.keys(ASSET_CLASS_LABEL) as AssetClass[]).map((c) => <option key={c} value={c}>{ASSET_CLASS_LABEL[c]}</option>)}
            </select>
          </label>
          <label className="select"><span>지역</span>
            <select value={region} onChange={(e) => { setRegion(e.target.value as Region | ""); setShown(PAGE); }}>
              <option value="">전체</option>
              {regions.map((r) => <option key={r} value={r}>{REGION_LABEL[r]}</option>)}
            </select>
          </label>
          <label className="select"><span>특징</span>
            <select value={tag} onChange={(e) => { setTag(e.target.value); setShown(PAGE); }}>
              <option value="">전체</option>
              {Object.entries(TAG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="check inline"><input type="checkbox" checked={onlyCand} onChange={(e) => { setOnlyCand(e.target.checked); setShown(PAGE); }} /><span>추천 후보만</span></label>
        </div>
      </section>

      <div className="section-head">
        <span className="muted">{rows.length.toLocaleString("ko-KR")}개</span>
        {sel.length >= 2 ? <a className="btn" href={compareHref(sel)}>선택한 {sel.length}개 비교</a> : <span className="muted">비교하려면 2~4개를 체크하세요</span>}
      </div>

      {hasOverseas && <FxNote>해외(미국) 상장 ETF의 가격·순자산·거래대금·수익률은 원화 환산 값입니다(달러 가격 × 같은 날 원/달러 환율). 모닝스타 카테고리는 참고용 영문 분류입니다.</FxNote>}

      <div className="table-wrap">
        <table className="table explore">
          <thead>
            <tr>
              <th aria-label="비교 선택" />
              {COLS.map((c) => (
                <th key={c.key} className={c.num ? "num" : ""} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"} title={c.hint}>
                  <button type="button" className="th-btn" onClick={() => toggleSort(c.key, c.desc)}>
                    {c.label}{sort.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((e) => {
              const sc = scoreOf(e.code);
              return (
                <tr key={e.code}>
                  <td><input type="checkbox" checked={sel.includes(e.code)} disabled={!sel.includes(e.code) && sel.length >= 4} onChange={() => toggleSel(e.code)} aria-label={`${e.name} 비교에 추가`} /></td>
                  <td className="name-cell">
                    <a href={etfHref(e.code)}>{e.name}</a>
                    <span className="muted"><MarketBadge etf={e} /> {e.code}{isOverseas(e) && listingLine(e) ? ` · ${listingLine(e)}` : ""} · {ASSET_CLASS_LABEL[e.tax.assetClass]}{e.tax.theme ? ` · ${e.tax.theme}` : ""}{e.tax.tags.length ? ` · ${e.tax.tags.map((t) => TAG_LABEL[t]).join("·")}` : ""}</span>
                  </td>
                  <td className="num">{sc ? Math.round(sc.score) : <span className="muted">-</span>}</td>
                  <td className="num"><Delta v={e.m.ret.y1} /></td>
                  <td className="num"><Delta v={e.m.cagr3y} /></td>
                  <td className="num">{fmtRatio(volOf(e), 0)}</td>
                  <td className="num">{fmtRatio(mddOf(e), 0)}</td>
                  <td className="num">{fmtFee(e.fee)}</td>
                  <td className="num" title={e.aumScope === "fund" ? AUM_FUND_NOTE : undefined}>{aumText(e)}</td>
                  <td className="num">{fmtWon(e.m.avgValue20)}</td>
                  <td className="num">{fmtHistory(e.m.years, e.m.days)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.slice(0, shown).some((e) => e.aumScope === "fund") && <p className="hint">{AUM_FUND_NOTE} 순자산 정렬에서는 † 항목을 맨 뒤로 보냅니다.</p>}
      {rows.length === 0 && <div className="card empty">조건에 맞는 ETF가 없습니다.</div>}
      {shown < rows.length && (
        <p className="more"><button type="button" className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({Math.min(PAGE, rows.length - shown)}개)</button></p>
      )}
      <Disclaimer compact />
    </>
  );
}
