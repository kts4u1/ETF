// 개발용: 저장된 네이버 목록 JSON으로 분류 결과를 점검한다. (npx tsx scripts/audit-taxonomy.ts <list.json>)
import { readFileSync } from "node:fs";
import { classify, type NaverTab } from "../src/core/taxonomy";

const raw = readFileSync(process.argv[2]!);
const list = JSON.parse(new TextDecoder("euc-kr").decode(raw)).result.etfItemList as {
  itemname: string; etfTabCode: number;
}[];
const only = process.argv[3];
const by = new Map<string, string[]>();
for (const i of list) {
  const t = classify(i.itemname, i.etfTabCode as NaverTab);
  const key = `${t.assetClass}/${t.region}/${t.theme ?? "-"}${t.broad ? "*" : ""}`;
  if (!by.has(key)) by.set(key, []);
  by.get(key)!.push(i.itemname + (t.tags.length ? ` [${t.tags.join(",")}]` : "") + (t.leverage !== 1 ? ` x${t.leverage}` : ""));
}
const keys = [...by.keys()].sort();
for (const k of keys) {
  if (only && !k.startsWith(only)) continue;
  const v = by.get(k)!;
  console.log(`${k} (${v.length}): ${v.slice(0, only ? 400 : 5).join(" | ")}`);
}
