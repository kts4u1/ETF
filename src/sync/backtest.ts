/**
 * 워크포워드 백테스트: "그 시점에 알 수 있던 데이터만으로" 점수를 매기고, 이후 실제 수익률과 비교한다.
 *
 * 검증 대상은 가격에서 나오는 팩터(수익성·효율·안정성·추세)와 거래대금 기반 신뢰도뿐이다.
 * 과거 시점의 총보수·순자산은 알 수 없으므로(현재 값을 쓰면 미래 정보 누출) 비용은 중립(50점),
 * 순자산은 게이트를 통과하는 상수로 고정한다.
 *
 * 알려진 편향(반드시 결과 해석에 반영):
 *  1. 생존편향 — 현재 상장 중인 ETF만 있다. 상장폐지된 ETF(대체로 부진)가 빠져 있어 절대 수익은 과대평가된다.
 *  2. 표본 — 시계열이 한 번의 장세(최근 몇 년)에 집중되어 있고 월별 표본은 서로 겹친다.
 *  3. 거래비용·세금·괴리율 미반영.
 */
import { writeFile } from "node:fs/promises";
import { forwardMaxDrawdown, forwardReturnMonths, shiftMonths } from "../core/metrics";
import { DEFAULT_PREFS, diversify, percentileRanks, PROFILES, rankEtfs } from "../core/scoring";
import type { FactorKey, Horizon, Profile, Scored } from "../core/types";
import { runComboBacktest } from "./backtest-combos";
import { loadUniverse, mean, median, monthEnds, stderr, universeAsOf } from "./bt-common";

const FWD_MONTHS = [3, 6, 12] as const;
const TOP_N = 10;
const MIN_CANDIDATES = 30;

function spearman(a: number[], b: number[]): number {
  const ra = percentileRanks(a) as number[];
  const rb = percentileRanks(b) as number[];
  const ma = mean(ra);
  const mb = mean(rb);
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = (ra[i] as number) - ma;
    const y = (rb[i] as number) - mb;
    sab += x * y; saa += x * x; sbb += y * y;
  }
  return saa === 0 || sbb === 0 ? 0 : sab / Math.sqrt(saa * sbb);
}

type Chooser = (reps: Scored[]) => Scored[];

interface Fwd { top: number; candMean: number; candMedian: number; topMdd: number; candMdd: number }
interface Row { t: string; fwd: Record<number, Fwd | null> }

export async function runBacktest(log: (m: string) => void = console.log): Promise<string> {
  const { loaded, asOf: lastDate } = await loadUniverse();
  log(`백테스트 대상 ${loaded.length}개 ETF`);
  const dates = monthEnds("20201231", shiftMonths(lastDate, -3));

  const profiles: Profile[] = ["stable", "balanced", "aggressive"];
  const horizon: Horizon = "mid";
  const strategies: Record<string, Chooser> = {
    "모델 종합점수": (reps) => diversify(reps, TOP_N),
    "(비교) 최근 1년 수익률 순": (reps) =>
      diversify([...reps].sort((a, b) => (b.etf.m.ret.y1 ?? -9) - (a.etf.m.ret.y1 ?? -9)), TOP_N),
    "(비교) 샤프지수 순": (reps) =>
      diversify([...reps].sort((a, b) => (b.etf.m.sharpe3y ?? b.etf.m.sharpe1y ?? -9) - (a.etf.m.sharpe3y ?? a.etf.m.sharpe1y ?? -9)), TOP_N),
    "(비교) 낮은 변동성 순": (reps) =>
      diversify([...reps].sort((a, b) => (a.etf.m.vol3y ?? a.etf.m.vol1y ?? 9) - (b.etf.m.vol3y ?? b.etf.m.vol1y ?? 9)), TOP_N),
  };

  // results[profile][strategy] = Row[]
  const results = new Map<string, Row[]>();
  const icAcc = new Map<string, Map<number, number[]>>(); // `${profile}|${factor}` → months → IC 목록
  const factorKeys: FactorKey[] = ["ret", "eff", "safety", "trend", "trust"];

  for (const t of dates) {
    const universe = universeAsOf(loaded, t);
    const byCode = new Map(universe.map((u) => [u.e.code, u]));

    for (const profile of profiles) {
      const prefs = { ...DEFAULT_PREFS, profile, horizon, includeYoung: false, dedupe: true };
      const rec = rankEtfs(universe.map((u) => u.e), prefs);
      const reps = rec.ranked;
      if (reps.length < MIN_CANDIDATES) continue;

      // 팩터별 IC (대표 ETF 전체 대상)
      for (const m of FWD_MONTHS) {
        const pairs = reps
          .map((s) => {
            const u = byCode.get(s.etf.code)!;
            return { s, f: forwardReturnMonths(u.series, u.idx, m) };
          })
          .filter((p): p is { s: Scored; f: number } => p.f !== null);
        if (pairs.length < MIN_CANDIDATES) continue;
        const fr = pairs.map((p) => p.f);
        for (const k of [...factorKeys, "total" as const]) {
          const xs = pairs.map((p) => (k === "total" ? p.s.score : p.s.factors[k as FactorKey]));
          const key = `${profile}|${k}`;
          if (!icAcc.has(key)) icAcc.set(key, new Map());
          const mm = icAcc.get(key)!;
          if (!mm.has(m)) mm.set(m, []);
          mm.get(m)!.push(spearman(xs, fr));
        }
      }

      for (const [sname, choose] of Object.entries(strategies)) {
        const picks = choose(reps);
        const row: Row = { t, fwd: {} };
        for (const m of FWD_MONTHS) {
          const measure = (group: Scored[]) => {
            const ret: number[] = [];
            const mdd: number[] = [];
            for (const s of group) {
              const u = byCode.get(s.etf.code)!;
              const r = forwardReturnMonths(u.series, u.idx, m);
              const d = forwardMaxDrawdown(u.series, u.idx, m);
              if (r !== null && d !== null) {
                ret.push(r);
                mdd.push(d);
              }
            }
            return { ret, mdd };
          };
          const all = measure(reps);
          const top = measure(picks);
          row.fwd[m] =
            all.ret.length >= MIN_CANDIDATES && top.ret.length >= Math.min(5, picks.length)
              ? { top: mean(top.ret), candMean: mean(all.ret), candMedian: median(all.ret), topMdd: mean(top.mdd), candMdd: median(all.mdd) }
              : null;
        }
        const key = `${profile}|${sname}`;
        if (!results.has(key)) results.set(key, []);
        results.get(key)!.push(row);
      }
    }
  }

  const combo = runComboBacktest(loaded, dates, log);
  await writeFile(
    "public/data/backtest.json",
    JSON.stringify({
      ...buildSummary(results, icAcc, profiles, lastDate, loaded.length, dates.length),
      combos: combo.summary,
      comboMonths: combo.nMonths,
    }),
  );
  return (
    renderReport({ results, icAcc, profiles, strategies: Object.keys(strategies), asOf: lastDate, nEtf: loaded.length, nDates: dates.length }) +
    combo.markdown
  );
}

const MODEL = "모델 종합점수";
const NAIVE = "(비교) 최근 1년 수익률 순";

/** 앱의 '방법론·한계' 화면이 읽는 요약. 모델과 단순 1년 수익률 순만 담는다. */
function buildSummary(
  results: Map<string, Row[]>,
  icAcc: Map<string, Map<number, number[]>>,
  profiles: Profile[],
  asOf: string,
  nEtf: number,
  nDates: number,
) {
  const out: Record<string, Record<string, unknown>> = {};
  for (const profile of profiles) {
    out[profile] = {};
    for (const m of FWD_MONTHS) {
      const model = summarize(results.get(`${profile}|${MODEL}`) ?? [], m);
      const naive = summarize(results.get(`${profile}|${NAIVE}`) ?? [], m);
      const ic = icAcc.get(`${profile}|total`)?.get(m) ?? [];
      const icIndep = ic.filter((_, i) => i % m === 0);
      out[profile]![`m${m}`] = {
        n: model.n,
        top: model.top,
        cand: model.cand,
        excess: model.excess,
        win: model.win,
        indepN: model.indepN,
        indepMean: model.indepMean,
        indepCI: model.indepCI,
        topMdd: model.topMdd,
        candMdd: model.candMdd,
        naiveTop: naive.top,
        naiveMdd: naive.topMdd,
        ic: ic.length ? mean(ic) : null,
        icCI: icIndep.length > 1 ? 1.96 * stderr(icIndep) : null,
      };
    }
  }
  return { version: 1, asOf, nEtf, nDates, profiles: out };
}

// ───────── 리포트 ─────────

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
const signed = (x: number, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%p`;

function summarize(rows: Row[], m: number) {
  const valid = rows.filter((r) => r.fwd[m]);
  const excess = valid.map((r) => r.fwd[m]!.top - r.fwd[m]!.candMedian);
  const tops = valid.map((r) => r.fwd[m]!.top);
  const cands = valid.map((r) => r.fwd[m]!.candMedian);
  // 겹치지 않는 표본: m개월 간격
  const step = m;
  const indep = excess.filter((_, i) => i % step === 0);
  return {
    n: valid.length,
    topMdd: valid.length ? mean(valid.map((r) => r.fwd[m]!.topMdd)) : NaN,
    candMdd: valid.length ? mean(valid.map((r) => r.fwd[m]!.candMdd)) : NaN,
    top: tops.length ? mean(tops) : NaN,
    cand: cands.length ? mean(cands) : NaN,
    excess: excess.length ? mean(excess) : NaN,
    win: excess.length ? excess.filter((x) => x > 0).length / excess.length : NaN,
    indepN: indep.length,
    indepMean: indep.length ? mean(indep) : NaN,
    indepCI: indep.length > 1 ? 1.96 * stderr(indep) : NaN,
  };
}

function renderReport(a: {
  results: Map<string, Row[]>;
  icAcc: Map<string, Map<number, number[]>>;
  profiles: Profile[];
  strategies: string[];
  asOf: string;
  nEtf: number;
  nDates: number;
}): string {
  const L: string[] = [];
  L.push("# 백테스트 리포트 (워크포워드)");
  L.push("");
  L.push(`- 생성: \`npm run backtest\` · 데이터 기준일 ${a.asOf} · 대상 ETF ${a.nEtf}개 · 월말 기준일 ${a.nDates}개`);
  L.push("- 방법: 각 월말 시점의 데이터만으로 점수 산출 → 선택한 상위 10개(자산군·테마당 최대 2개)의 이후 3·6·12개월 실제 수익률을 같은 시점 후보군(게이트 통과, 동일 지수 대표) **중앙값**과 비교.");
  L.push("- 후보군·투자 성향 한도·게이트는 실제 앱과 같은 코드를 사용. 단, 과거 시점의 총보수·순자산은 알 수 없어 비용은 중립(50점), 순자산은 통과값으로 고정.");
  L.push("");
  L.push("> **해석 시 주의** — 생존편향(현재 상장 ETF만 포함), 한 번의 장세에 집중된 짧은 표본, 월별 표본의 중첩, 거래비용·세금 미반영. "
    + "'초과수익'은 후보군 중앙값 대비이며 절대 수익을 보장하지 않습니다. 비중첩 표본의 95% 신뢰구간이 0을 포함하면 우연과 구분되지 않습니다.");
  L.push("");
  for (const profile of a.profiles) {
    L.push(`## ${PROFILES[profile].label} (${profile})`);
    L.push("");
    for (const m of FWD_MONTHS) {
      L.push(`### 보유 ${m}개월 후`);
      L.push("");
      L.push("| 선택 방식 | 표본(월) | 상위10 평균수익 | 후보 중앙값 | 평균 초과수익 | 이긴 달 비율 | 비중첩 초과수익 (95% CI) | 보유 중 최대낙폭 (상위10 / 후보 중앙값) |");
      L.push("|---|---:|---:|---:|---:|---:|---|---:|");
      for (const s of a.strategies) {
        const rows = a.results.get(`${profile}|${s}`) ?? [];
        const r = summarize(rows, m);
        if (!r.n) continue;
        const ci = Number.isFinite(r.indepCI) ? `${signed(r.indepMean)} ± ${(r.indepCI * 100).toFixed(1)} (n=${r.indepN})` : "-";
        L.push(`| ${s} | ${r.n} | ${pct(r.top)} | ${pct(r.cand)} | ${signed(r.excess)} | ${pct(r.win, 0)} | ${ci} | ${pct(r.topMdd)} / ${pct(r.candMdd)} |`);
      }
      L.push("");
    }
    L.push("**팩터별 정보계수(IC)** — 점수와 이후 수익률의 순위상관(스피어만). +0.05 이상이면 약한 예측력, 0 근처면 무관, 음수면 역방향.");
    L.push("");
    L.push("| 팩터 | 3개월 | 6개월 | 12개월 |");
    L.push("|---|---:|---:|---:|");
    for (const k of ["ret", "eff", "safety", "trend", "trust", "total"]) {
      const cells = FWD_MONTHS.map((m) => {
        const xs = a.icAcc.get(`${profile}|${k}`)?.get(m) ?? [];
        if (!xs.length) return "-";
        const indep = xs.filter((_, i) => i % m === 0);
        const ci = indep.length > 1 ? 1.96 * stderr(indep) : NaN;
        return `${mean(xs).toFixed(3)}${Number.isFinite(ci) ? ` ±${ci.toFixed(3)}` : ""}`;
      });
      L.push(`| ${k === "total" ? "**종합점수**" : k} | ${cells.join(" | ")} |`);
    }
    L.push("");
  }
  return L.join("\n");
}

export async function backtestToFile(path = "docs/BACKTEST.md") {
  const md = await runBacktest();
  await writeFile(path, md + "\n");
  console.log(`\n리포트 저장: ${path}`);
  return md;
}
