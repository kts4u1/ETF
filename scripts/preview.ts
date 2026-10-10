// 개발용: 스냅샷으로 추천 결과를 콘솔에 출력. npx tsx scripts/preview.ts [profile] [horizon] [topN]
import { readFileSync } from "node:fs";
import { DEFAULT_PREFS, rankEtfs } from "../src/core/scoring";
import type { Horizon, Profile, Snapshot } from "../src/core/types";

const snap = JSON.parse(readFileSync("public/data/snapshot.json", "utf8")) as Snapshot;
const profiles: Profile[] = process.argv[2] ? [process.argv[2] as Profile] : ["stable", "balanced", "aggressive"];
const horizons: Horizon[] = process.argv[3] ? [process.argv[3] as Horizon] : ["mid"];
const topN = Number(process.argv[4] ?? 10);
const pct = (v: number | null) => (v === null ? "  -  " : (v * 100).toFixed(0).padStart(4) + "%");
for (const profile of profiles) for (const horizon of horizons) {
  const r = rankEtfs(snap.etfs, { ...DEFAULT_PREFS, profile, horizon });
  console.log(`\n=== ${profile} / ${horizon}  (후보 ${r.universeSize}, 제외 ${r.excluded.length}, 대표 ${r.ranked.length}) ===`);
  r.ranked.slice(0, topN).forEach((s, i) => {
    const e = s.etf, m = e.m;
    console.log(
      `${String(i + 1).padStart(2)}. ${s.score.toFixed(1).padStart(5)} ${e.name.padEnd(30)} ${e.tax.assetClass.padEnd(13)}` +
      ` 1y${pct(m.ret.y1)} 3yC${pct(m.cagr3y)} vol${pct(m.vol3y ?? m.vol1y)} mdd${pct(m.mdd3y ?? m.mdd1y)} fee${String(e.fee).padStart(5)} aum${String(Math.round(e.aumEok)).padStart(6)} grp${s.groupRank}/${s.groupSize}` +
      ` [${(["ret","eff","safety","trend","cost","trust"] as const).map(k=>s.factors[k].toFixed(0)).join(",")}]`,
    );
  });
}
