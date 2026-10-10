// 개발용: 실제 스냅샷으로 조합 제안을 콘솔에 출력. npx tsx scripts/combos-preview.ts [profile] [size] [weighting]
import { readFileSync } from "node:fs";
import { exposureOf, type HoldingsFile } from "../src/core/overlap";
import { proposeCombos, roleOf, selectPool, weeklyReturns, type ComboCandidate, type Weighting } from "../src/core/portfolio";
import { DEFAULT_PREFS, rankEtfs } from "../src/core/scoring";
import type { Profile, SeriesFile, Snapshot } from "../src/core/types";

const snap = JSON.parse(readFileSync("public/data/snapshot.json", "utf8")) as Snapshot;
const series = JSON.parse(readFileSync("public/data/series.json", "utf8")) as SeriesFile;
const holdings = JSON.parse(readFileSync("public/data/holdings.json", "utf8")) as HoldingsFile;

const profiles: Profile[] = process.argv[2] ? [process.argv[2] as Profile] : ["stable", "balanced", "aggressive"];
const sizes = process.argv[3] ? [Number(process.argv[3]) as 2 | 3] : [2, 3];
const weighting = (process.argv[4] ?? "inverse-vol") as Weighting;

const weekly = (code: string) => {
  const s = series.s[code];
  if (!s) return [];
  const vals: (number | null)[] = series.grid.map((_, g) => (g - s.o >= 0 && g - s.o < s.c.length ? (s.c[g - s.o] as number) : null));
  return weeklyReturns(vals);
};
const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
for (const profile of profiles) {
  const rec = rankEtfs(snap.etfs, { ...DEFAULT_PREFS, profile, horizon: "mid" });
  const pool: ComboCandidate[] = selectPool(rec.ranked, 10).map((s) => ({ etf: s.etf, score: s.score, returns: weekly(s.etf.code), exposure: exposureOf(holdings, s.etf.code) }));
  for (const size of sizes) {
    const res = proposeCombos(pool, profile, { size, weighting, poolSize: 12, limit: 3 });
    console.log(`\n=== ${profile} / ${size}개 / ${weighting} (풀 ${pool.length}) → ${res.length}개 제안`);
    res.forEach((p, i) => {
      console.log(` #${i + 1} 점수 ${p.score.toFixed(1)} (품질 ${p.quality.toFixed(0)}, 분산 ${p.diversification.toFixed(0)}, 겹침 ${p.avgOverlap === null ? "-" : p.avgOverlap.toFixed(0) + "%"}) | ${p.stats.weeks}주: 연 ${pct(p.stats.cagr, 0)} 변동성 ${pct(p.stats.vol, 0)}(구성평균 ${pct(p.stats.avgMemberVol, 0)}) 낙폭 ${pct(p.stats.mdd, 0)} DR ${p.stats.diversificationRatio.toFixed(2)}`);
      for (const m of p.members) console.log(`     ${String(Math.round(m.weight * 100)).padStart(3)}% ${m.cand.etf.name.padEnd(28)} [${roleOf(m.cand.etf)}] 점수 ${m.cand.score.toFixed(0)}`);
    });
  }
}
