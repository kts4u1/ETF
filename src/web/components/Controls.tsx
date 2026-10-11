import { fmtNum, tr } from "../../core/i18n";
import { ASSET_CLASS_LABEL } from "../../core/explain";
import { MARKET_FILTERS, MARKET_FILTER_LABEL, describeCounts, usCollectionRule } from "../../core/market-view";
import { HORIZONS, PROFILES } from "../../core/scoring";
import type { AssetClass, Horizon, MarketFilter, Profile } from "../../core/types";
import { useApp } from "../data";

const CLASS_ORDER: AssetClass[] = ["kr-equity", "global-equity", "bond", "cash", "commodity", "multi", "real-asset", "fx", "crypto"];

function Segmented<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="field" role="radiogroup" aria-label={label}>
      <span className="field-label">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? "on" : ""}
            title={o.hint}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 추천 조건 입력. 결과 바로 위 한 줄(+고급 옵션)에 둔다. */
export function Controls() {
  const { prefs, setPrefs, resetPrefs, counts } = useApp();
  // 선택지에 마우스를 올렸을 때 보이는 설명: 그 시장에 ETF가 몇 개 있는지(데이터에서 센 값)
  const marketHint = (k: MarketFilter) => {
    if (k === "all") return describeCounts(counts);
    if (counts[k] === 0) return tr(`이 데이터에는 ${MARKET_FILTER_LABEL[k]} ETF가 없습니다`, `This data has no ${MARKET_FILTER_LABEL[k]} ETFs`);
    return `${describeCounts({ KR: k === "KR" ? counts.KR : 0, US: k === "US" ? counts.US : 0 })}${k === "US" ? tr(" — 원화 환산 기준", " — KRW-converted basis") : ""}`;
  };
  const selected = prefs.assetClasses;
  const toggleClass = (c: AssetClass) => {
    const cur = selected ?? CLASS_ORDER;
    const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
    setPrefs({ assetClasses: next.length === 0 || next.length === CLASS_ORDER.length ? null : next });
  };

  return (
    <section className="controls card" aria-label={tr("추천 조건", "Picks settings")}>
      <div className="controls-row">
        <Segmented<Profile>
          label={tr("투자 성향", "Risk profile")}
          value={prefs.profile}
          options={(Object.keys(PROFILES) as Profile[]).map((k) => ({ value: k, label: PROFILES[k].label, hint: PROFILES[k].description }))}
          onChange={(profile) => setPrefs({ profile })}
        />
        <Segmented<Horizon>
          label={tr("투자 기간", "Horizon")}
          value={prefs.horizon}
          options={(Object.keys(HORIZONS) as Horizon[]).map((k) => ({ value: k, label: HORIZONS[k].label, hint: HORIZONS[k].description }))}
          onChange={(horizon) => setPrefs({ horizon })}
        />
        <Segmented<MarketFilter>
          label={tr("상장 시장", "Listing market")}
          value={prefs.market}
          options={MARKET_FILTERS.map((k) => ({ value: k, label: MARKET_FILTER_LABEL[k], hint: marketHint(k) }))}
          onChange={(market) => setPrefs({ market })}
        />
      </div>
      <p className="hint">{PROFILES[prefs.profile].description} {HORIZONS[prefs.horizon].description}</p>

      <div className="field">
        <span className="field-label">{tr("자산군", "Asset classes")} {selected === null ? tr("(전체)", "(all)") : tr(`(${selected.length}개 선택)`, `(${selected.length} selected)`)}</span>
        <div className="chips-row">
          {CLASS_ORDER.map((c) => {
            const on = selected === null || selected.includes(c);
            return (
              <button key={c} type="button" className={`chip-btn${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggleClass(c)}>
                {ASSET_CLASS_LABEL[c]}
              </button>
            );
          })}
        </div>
      </div>

      <details className="advanced">
        <summary>{tr("고급 옵션", "Advanced options")}</summary>
        <div className="adv-grid">
          <label className="check">
            <input type="checkbox" checked={prefs.includeLeveraged} onChange={(e) => setPrefs({ includeLeveraged: e.target.checked })} />
            <span><b>{tr("레버리지·인버스 포함", "Include leveraged / inverse")}</b><small>{tr("하루 수익률의 2배/반대 추종. 장기 보유 시 손실 위험이 매우 큽니다.", "Tracks 2x or the opposite of the daily return. The risk of loss is very high if held long term.")}</small></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.includeCoveredCall} onChange={(e) => setPrefs({ includeCoveredCall: e.target.checked })} />
            <span><b>{tr("커버드콜 포함", "Include covered call")}</b><small>{tr("분배금이 높지만 상승 수익이 제한됩니다.", "High distributions, but upside is capped.")}</small></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.includeYoung} onChange={(e) => setPrefs({ includeYoung: e.target.checked })} />
            <span><b>{tr("상장 1년 미만 포함", "Include listed under 1 year")}</b><small>{tr("성과 검증이 부족해 점수에 감점이 붙습니다.", "A score penalty applies because the track record is short.")}</small></span>
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.dedupe} onChange={(e) => setPrefs({ dedupe: e.target.checked })} />
            <span><b>{tr("같은 지수는 대표 1개만", "One representative per index")}</b><small>{tr("예: S&P500 ETF 여러 개 중 점수가 가장 높은 것만 보여줍니다.", "E.g. of several S&P 500 ETFs, only the highest-scoring one is shown.")}</small></span>
          </label>
          <div className="select-note">
            <label className="select">
              <span>{tr("최소 순자산", "Min. net assets")}</span>
              <select value={prefs.minAumEok} onChange={(e) => setPrefs({ minAumEok: Number(e.target.value) })}>
                {[100, 300, 1000, 3000, 10000].map((v) => <option key={v} value={v}>{v >= 10000 ? tr(`${v / 10000}조원 이상`, `₩${v / 10000}T or more`) : tr(`${fmtNum(v)}억원 이상`, `₩${fmtNum(v / 10)}B or more`)}</option>)}
              </select>
            </label>
            {prefs.market !== "KR" && (
              <p className="hint">{usCollectionRule()}. {tr("위 하한을 낮춰도 이 기준 미만의 해외 ETF는 목록에 없습니다.", "Lowering the minimum above will not bring back US ETFs below this threshold; they are not in the list.")}</p>
            )}
          </div>
          <label className="select">
            <span>{tr("총보수 상한", "Max expense ratio")}</span>
            <select value={prefs.maxFee ?? ""} onChange={(e) => setPrefs({ maxFee: e.target.value === "" ? null : Number(e.target.value) })}>
              <option value="">{tr("제한 없음", "No limit")}</option>
              {[0.1, 0.2, 0.3, 0.5, 0.7].map((v) => <option key={v} value={v}>{tr(`연 ${v}% 이하`, `${v}% a year or less`)}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className="link-btn" onClick={resetPrefs}>{tr("기본값으로 되돌리기", "Reset to defaults")}</button>
      </details>
    </section>
  );
}
