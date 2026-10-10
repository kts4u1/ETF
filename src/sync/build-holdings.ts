import { readFile, writeFile } from "node:fs/promises";
import { buildExposures, type EtfInput } from "../core/holdings";
import type { HoldingsFile } from "../core/overlap";
import type { Snapshot } from "../core/types";
import { OUT_DIR, loadCachedHoldings } from "./build-snapshot";

/**
 * ETF마다 저장하는 종목 수의 상한. 종목 수가 아니라 "비중 0.01% 이상 전부"를 저장하는 것이 핵심이다.
 * 처음에는 상위 150개만 저장했는데, 같은 지수(S&P500, 504종목)를 추종하는 ETF끼리의 겹침이
 * 실제 97.5%인데 82.1%로 크게 과소 추정되었다(꼬리의 합이 크기 때문). 평균 오차는 작아도 사용자가
 * 실제로 비교하는 대형 지수 ETF 쌍에서 오차가 가장 컸다.
 */
export const HOLDINGS_MAX_ENTRIES = 3000;

/** 구성종목이 실제 노출을 나타내지 않는 구조(스왑·레버리지·인버스) */
const isDerivativeStructure = (tags: string[]) => tags.some((t) => t === "leveraged" || t === "inverse" || t === "synthetic");

export async function buildHoldingsFile(maxEntries = HOLDINGS_MAX_ENTRIES): Promise<{ file: HoldingsFile; available: number; total: number }> {
  const snap = JSON.parse(await readFile(`${OUT_DIR}/snapshot.json`, "utf8")) as Snapshot;
  const inputs: EtfInput[] = [];
  for (const e of snap.etfs) {
    const rows = await loadCachedHoldings(e.code);
    inputs.push({ code: e.code, name: e.name, rows: rows ?? [], derivativeStructure: isDerivativeStructure(e.tax.tags) });
  }
  const exposures = buildExposures(inputs);

  const ids: string[] = [];
  const names: string[] = [];
  const index = new Map<string, number>();
  const intern = (id: string, name: string) => {
    let i = index.get(id);
    if (i === undefined) {
      i = ids.length;
      ids.push(id);
      names.push(name);
      index.set(id, i);
    }
    return i;
  };

  const file: HoldingsFile = { version: 1, asOf: snap.asOf, topK: maxEntries, ids, names, etfs: {}, unavailable: {} };
  for (const [code, r] of exposures) {
    if (r.unavailable) {
      file.unavailable[code] = r.unavailable;
      continue;
    }
    // 비중 ×100 을 정수로 저장하므로 0.005% 미만은 0이 된다 — 그런 꼬리는 겹침에 기여하지 않으므로 버린다
    const top = [...r.atoms]
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxEntries)
      .filter(([, w]) => Math.round(w * 100) >= 1);
    file.etfs[code] = {
      t: Math.round(r.total * 100) / 100,
      n: r.atoms.size,
      lt: Math.round(r.lookThrough * 100) / 100,
      i: top.map(([id]) => intern(id, r.names.get(id) ?? id)),
      w: top.map(([, w]) => Math.round(w * 100)),
    };
  }
  await writeFile(`${OUT_DIR}/holdings.json`, JSON.stringify(file));
  return { file, available: Object.keys(file.etfs).length, total: snap.etfs.length };
}
