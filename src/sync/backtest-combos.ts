/**
 * 조합 제안의 워크포워드 검증.
 *
 * 질문: 앱이 제안하는 2~3개 조합이, (a) 추천 1위 하나만 사는 것, (b) 추천 상위 3개를 균등하게 사는 것보다
 *       보유 기간 중 낙폭과 최악의 결과를 실제로 줄이는가? 그 대가로 수익을 얼마나 포기하는가?
 *
 * 각 월말 T 에서 그 시점까지의 데이터만으로 후보 풀과 조합을 만들고(주간 수익률 최근 3년),
 * 처음 비중으로 3·6·12개월 보유(매수 후 보유, 리밸런싱 없음)한 실제 결과를 비교한다.
 * 과거 시점의 구성종목은 알 수 없어 겹침 필터는 쓰지 않는다 — 상관·분산 효과 기반 부분만 검증된다.
 * 편향(생존편향 등)은 backtest.ts 와 같다.
 */
import { indexOnOrBefore, shiftMonths } from "../core/metrics";
import { proposeCombos, selectPool, weeklyReturns, MAX_WEEKS, type ComboCandidate, type Weighting } from "../core/portfolio";
import { DEFAULT_PREFS, PROFILES, rankEtfs } from "../core/scoring";
import type { PriceSeries, Profile } from "../core/types";
import { mean, quantile, stderr, universeAsOf, weeklyClosesAsOf, type AsOfEtf, type Loaded } from "./bt-common";

const MONTHS = [3, 6, 12] as const;
const MIN_REPS = 30;

interface Member {
  series: PriceSeries;
  idx: number;
  w: number;
}

/** 처음 비중으로 매수 후 보유했을 때의 실제 결과(수익률, 보유 중 최대낙폭). 아직 그 날짜가 안 왔으면 null. */
function forwardBasket(members: Member[], t: string, months: number): { ret: number; mdd: number } | null {
  const target = shiftMonths(t, months);
  const ref = members[0] as Member;
  for (const m of members) if ((m.series.dates[m.series.dates.length - 1] as string) < target) return null;
  const end = indexOnOrBefore(ref.series.dates, target);
  if (end <= ref.idx) return null;

  let peak = 1;
  let mdd = 0;
  let value = 1;
  for (let i = ref.idx; i <= end; i++) {
    const d = ref.series.dates[i] as string;
    value = 0;
    for (const m of members) {
      const j = m === ref ? i : indexOnOrBefore(m.series.dates, d);
      value += m.w * ((m.series.close[j] as number) / (m.series.close[m.idx] as number));
    }
    peak = Math.max(peak, value);
    mdd = Math.min(mdd, value / peak - 1);
  }
  return { ret: value - 1, mdd };
}

export interface ComboStrategyResult {
  n: number;
  ret: number;
  mdd: number;
  /** 월별 결과 중 하위 10% 수익률(나쁜 달의 경계) */
  p10: number;
  /** 기준 전략(Top3 균등) 대비 차이와 비중첩 95% 구간 */
  dRet: number;
  dRetCI: number;
  dMdd: number;
  dMddCI: number;
  /** 기준 전략보다 낙폭이 작았던 달의 비율 */
  mddWin: number;
}

export type ComboSummary = Record<string, Record<string, Record<string, ComboStrategyResult>>>;

const BASELINE = "추천 상위 3개 균등";

interface Outcome {
  t: string;
  ret: number;
  mdd: number;
}

export function runComboBacktest(
  loaded: Loaded[],
  dates: string[],
  log: (m: string) => void = console.log,
): { summary: ComboSummary; markdown: string; nMonths: number } {
  const profiles: Profile[] = ["stable", "balanced", "aggressive"];
  const variants: { name: string; size: 2 | 3; weighting: Weighting }[] = [
    { name: "조합 3개 · 역변동성", size: 3, weighting: "inverse-vol" },
    { name: "조합 3개 · 균등", size: 3, weighting: "equal" },
    { name: "조합 2개 · 역변동성", size: 2, weighting: "inverse-vol" },
    { name: "조합 2개 · 균등", size: 2, weighting: "equal" },
  ];
  // key = `${profile}|${months}|${strategy}` → 월별 결과
  const acc = new Map<string, Outcome[]>();
  const push = (profile: Profile, m: number, strat: string, o: Outcome) => {
    const k = `${profile}|${m}|${strat}`;
    if (!acc.has(k)) acc.set(k, []);
    acc.get(k)!.push(o);
  };

  let used = 0;
  for (const t of dates) {
    const universe = universeAsOf(loaded, t);
    const byCode = new Map<string, AsOfEtf>(universe.map((u) => [u.e.code, u]));
    const etfs = universe.map((u) => u.e);
    for (const profile of profiles) {
      const rec = rankEtfs(etfs, { ...DEFAULT_PREFS, profile, horizon: "mid", dedupe: true });
      if (rec.ranked.length < MIN_REPS) continue;
      const pool = selectPool(rec.ranked, 10);
      const cands: ComboCandidate[] = pool.map((s) => {
        const u = byCode.get(s.etf.code) as AsOfEtf;
        return { etf: s.etf, score: s.score, returns: weeklyReturns(weeklyClosesAsOf(u.series, u.idx, MAX_WEEKS)) };
      });

      const baskets = new Map<string, Member[]>();
      const top3 = pool.slice(0, 3);
      if (top3.length === 3) baskets.set(BASELINE, top3.map((s) => ({ ...(byCode.get(s.etf.code) as AsOfEtf), w: 1 / 3 })).map(toMember));
      baskets.set("추천 1위 단독", [toMember({ ...(byCode.get(rec.ranked[0]!.etf.code) as AsOfEtf), w: 1 })]);
      for (const v of variants) {
        const best = proposeCombos(cands, profile, { size: v.size, weighting: v.weighting, poolSize: 14, limit: 1 })[0];
        if (best) baskets.set(v.name, best.members.map((m) => toMember({ ...(byCode.get(m.cand.etf.code) as AsOfEtf), w: m.weight })));
      }
      if (!baskets.has(BASELINE)) continue;
      used++;

      for (const m of MONTHS) {
        // 모든 전략이 같은 달에 평가 가능해야 비교가 공정하다
        const outs = new Map<string, { ret: number; mdd: number }>();
        for (const [name, members] of baskets) {
          const o = forwardBasket(members, t, m);
          if (o) outs.set(name, o);
        }
        if (!outs.has(BASELINE)) continue;
        for (const [name, o] of outs) push(profile, m, name, { t, ...o });
      }
    }
  }
  log(`조합 백테스트: ${dates.length}개 월말 중 ${Math.round(used / profiles.length)}개 월 사용`);

  // 집계
  const summary: ComboSummary = {};
  const strategies = ["추천 1위 단독", BASELINE, ...variants.map((v) => v.name)];
  for (const profile of profiles) {
    summary[profile] = {};
    for (const m of MONTHS) {
      const base = new Map((acc.get(`${profile}|${m}|${BASELINE}`) ?? []).map((o) => [o.t, o]));
      const row: Record<string, ComboStrategyResult> = {};
      for (const s of strategies) {
        const outs = (acc.get(`${profile}|${m}|${s}`) ?? []).filter((o) => base.has(o.t));
        if (outs.length < 5) continue;
        const dR = outs.map((o) => o.ret - (base.get(o.t) as Outcome).ret);
        const dM = outs.map((o) => o.mdd - (base.get(o.t) as Outcome).mdd);
        const indepR = dR.filter((_, i) => i % m === 0);
        const indepM = dM.filter((_, i) => i % m === 0);
        row[s] = {
          n: outs.length,
          ret: mean(outs.map((o) => o.ret)),
          mdd: mean(outs.map((o) => o.mdd)),
          p10: quantile(outs.map((o) => o.ret), 0.1),
          dRet: mean(dR),
          dRetCI: indepR.length > 1 ? 1.96 * stderr(indepR) : NaN,
          dMdd: mean(dM),
          dMddCI: indepM.length > 1 ? 1.96 * stderr(indepM) : NaN,
          mddWin: dM.filter((x) => x > 1e-9).length / dM.length, // mdd 는 음수: 클수록(0에 가까울수록) 낙폭이 작음
        };
      }
      summary[profile]![`m${m}`] = row;
    }
  }
  return { summary, markdown: renderCombos(summary, strategies), nMonths: Math.round(used / profiles.length) };
}

function toMember(a: AsOfEtf & { w: number }): Member {
  return { series: a.series, idx: a.idx, w: a.w };
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%p`;

function renderCombos(summary: ComboSummary, strategies: string[]): string {
  const L: string[] = [];
  L.push("");
  L.push("---");
  L.push("");
  L.push("# 조합 제안 검증 (워크포워드)");
  L.push("");
  L.push("각 월말에 그 시점까지의 데이터만으로 후보 풀(상위 후보 + 자산군별 1위)과 조합을 만들고, **처음 비중으로 보유**(리밸런싱 없음)했을 때의 실제 3·6·12개월 결과를 비교했습니다.");
  L.push(`기준 전략은 **${BASELINE}**(추천 엔진 상위 3개를 1/3씩)입니다. 과거 시점의 구성종목은 알 수 없어 겹침 필터는 쓰지 않았으므로, 상관·분산 효과 부분만 검증됩니다.`);
  L.push("");
  for (const profile of Object.keys(summary)) {
    L.push(`## ${PROFILES[profile as Profile].label}`);
    L.push("");
    for (const m of MONTHS) {
      const row = summary[profile]![`m${m}`];
      if (!row) continue;
      L.push(`### 보유 ${m}개월`);
      L.push("");
      L.push(`| 전략 | 표본(월) | 평균 수익 | 평균 최대낙폭 | 나쁜 달(하위 10%) 수익 | 수익 차이 vs 기준 (비중첩 95%) | 낙폭 차이 vs 기준 (비중첩 95%) | 기준보다 낙폭 작았던 달 |`);
      L.push("|---|---:|---:|---:|---:|---|---|---:|");
      for (const s of strategies) {
        const r = row[s];
        if (!r) continue;
        const ci = (v: number, c: number) => (s === BASELINE ? "-" : `${signed(v)} ± ${Number.isFinite(c) ? (c * 100).toFixed(1) : "-"}`);
        L.push(`| ${s} | ${r.n} | ${pct(r.ret)} | ${pct(r.mdd)} | ${pct(r.p10)} | ${ci(r.dRet, r.dRetCI)} | ${ci(r.dMdd, r.dMddCI)} | ${s === BASELINE ? "-" : pct(r.mddWin, 0)} |`);
      }
      L.push("");
    }
  }
  return L.join("\n");
}
