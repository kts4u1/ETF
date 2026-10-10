// 개발용: 미국 상장 ETF 목록을 분류기(src/core/taxonomy-us.ts)에 통과시켜 분포와 의심 항목을 출력한다.
//
//   npx tsx scripts/audit-taxonomy-us.ts <목록.json> [--no-category] [--list] [--limit N]
//
// 목록 형식 두 가지를 읽는다.
//   · [{ s, cat, fam, legal, name }, …]            (info-summary.json: 야후 펀드 정보 요약)
//   · { data: { data: { rows: [{ symbol, companyName }] } } }  (나스닥 ETF 목록 원문 — 카테고리가 없어 이름만으로 분류)
// --no-category 는 카테고리를 지우고 이름만으로 분류한다(카테고리 폴백 점검). --list 는 의심 항목을 전부 출력한다.
import { readFileSync } from "node:fs";
import { classifyUs, isKnownUsCategory, singleStockUnderlying, US_STOCK_THEME, type UsEtfInfo } from "../src/core/taxonomy-us";
import type { Taxonomy } from "../src/core/types";

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
// --limit 다음 인자는 숫자 값이지 파일이 아니다.
const file = args.find((a, idx) => !a.startsWith("--") && !(limitArg >= 0 && idx === limitArg + 1));
if (!file) {
  console.error("사용법: npx tsx scripts/audit-taxonomy-us.ts <목록.json> [--no-category] [--list] [--limit N]");
  process.exit(1);
}
const noCategory = args.includes("--no-category");
const listAll = args.includes("--list");
const LIMIT = listAll ? Infinity : limitArg >= 0 ? Number(args[limitArg + 1]) || 12 : 12;

type Row = { s: string; cat: string | null; fam: string | null; legal: string | null; name: string };
const raw: unknown = JSON.parse(readFileSync(file, "utf8"));
let rows: Row[];
if (Array.isArray(raw)) {
  rows = (raw as Partial<Row>[]).map((r) => ({ s: r.s ?? "", cat: r.cat ?? null, fam: r.fam ?? null, legal: r.legal ?? null, name: r.name ?? "" }));
} else {
  const list = (raw as { data?: { data?: { rows?: { symbol: string; companyName: string }[] } } }).data?.data?.rows;
  if (!list) {
    console.error("알 수 없는 목록 형식입니다(info-summary.json 또는 나스닥 ETF 목록 원문이어야 합니다).");
    process.exit(1);
  }
  rows = list.map((r) => ({ s: r.symbol, cat: null, fam: null, legal: null, name: r.companyName.trim() }));
}
if (noCategory) rows = rows.map((r) => ({ ...r, cat: null }));

interface Item {
  row: Row;
  t: Taxonomy;
}
const items: Item[] = rows.map((row) => {
  const info: UsEtfInfo = { symbol: row.s, name: row.name, category: row.cat, family: row.fam, legalType: row.legal };
  return { row, t: classifyUs(info) };
});

// ───────── 출력 도우미 ─────────
const count = <K extends string>(keys: K[]): [K, number][] => {
  const m = new Map<K, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};
const fmt = (c: [string, number][], n = c.length) => c.slice(0, n).map(([k, v]) => `${k} ${v}`).join(" · ");
const show = (title: string, hits: Item[], extra?: (i: Item) => string) => {
  console.log(`\n■ ${title}: ${hits.length}건`);
  for (const h of hits.slice(0, LIMIT)) {
    console.log(`  ${h.row.s.padEnd(6)} ${(h.row.cat ?? "-").slice(0, 22).padEnd(22)} ${h.row.name.slice(0, 64)}${extra ? `  → ${extra(h)}` : ""}`);
  }
  if (hits.length > LIMIT) console.log(`  … 외 ${hits.length - LIMIT}건 (--list 로 전부 출력)`);
};
const label = (t: Taxonomy) => `${t.assetClass}/${t.region}/${t.theme ?? "-"}${t.broad ? "*" : ""}${t.tags.length ? ` [${t.tags.join(",")}]` : ""}${t.leverage !== 1 ? ` x${t.leverage}` : ""}`;

// ───────── 분포 ─────────
console.log(`분류 대상 ${items.length}개 (${noCategory || !Array.isArray(raw) ? "이름만" : "카테고리 + 이름"})`);
console.log(`\n자산군: ${fmt(count(items.map((i) => i.t.assetClass)))}`);
console.log(`지역: ${fmt(count(items.map((i) => i.t.region)))}`);
console.log(`태그: ${fmt(count(items.flatMap((i) => i.t.tags)))}`);
console.log(`레버리지 배수: ${fmt(count(items.filter((i) => i.t.leverage !== 1).map((i) => `x${i.t.leverage}`)))}`);
console.log(`광범위 지수(broad): ${items.filter((i) => i.t.broad).length}개, 테마 없음: ${items.filter((i) => i.t.theme === null).length}개`);
for (const cls of count(items.map((i) => i.t.assetClass))) {
  const sub = items.filter((i) => i.t.assetClass === cls[0]);
  console.log(`\n[${cls[0]}] ${cls[1]}개 — 지역 ${fmt(count(sub.map((i) => i.t.region)))}`);
  console.log(`  테마: ${fmt(count(sub.map((i) => i.t.theme ?? "(없음)")), 30)}`);
}

// ───────── 의심 항목 ─────────
const SECTOR_CATEGORIES = new Set([
  "Technology", "Health", "Financial", "Industrials", "Consumer Cyclical", "Consumer Defensive", "Communications", "Utilities",
  "Equity Energy", "Natural Resources", "Miscellaneous Sector", "Equity Precious Metals", "Equity Digital Assets", "Energy Limited Partnership",
]);
console.log("\n══════ 의심 항목 ══════");

show("주식인데 테마가 없고 카테고리가 섹터형", items.filter((i) => i.t.assetClass === "global-equity" && i.t.theme === null && i.row.cat !== null && SECTOR_CATEGORIES.has(i.row.cat)), (i) => label(i.t));

const unknownCats = count(items.filter((i) => i.row.cat !== null && !isKnownUsCategory(i.row.cat)).map((i) => i.row.cat as string));
console.log(`\n■ 카테고리 미매핑: ${unknownCats.length}종 ${unknownCats.reduce((s, c) => s + c[1], 0)}건 ${unknownCats.length ? `— ${fmt(unknownCats)}` : ""}`);

show(
  "레버리지·인버스인데 이름에 배수 표기가 없음(카테고리·ProShares 이름으로 추정한 배수)",
  items.filter((i) => i.t.leverage !== 1 && !/(?<![\w.])-?\d(?:\.\d+)?\s?x(?![a-z])/i.test(i.row.name)),
  (i) => label(i.t),
);

show(
  "이름에 인버스·버퍼·커버드콜·VIX 표기가 있는데 태그가 없음",
  items.filter((i) => {
    const t = i.t;
    const n = i.row.name;
    return (
      (/\bInverse\b|\bBear\b|-\dx/i.test(n) && !t.tags.includes("inverse")) ||
      (/Buffer|Floor\b/i.test(n) && !t.tags.includes("defined-outcome")) ||
      // 버퍼 상품은 이름에 Premium Income 이 있어도 커버드콜이 아니라 버퍼·목표수익으로 둔다
      (/Covered[- ]Call|BuyWrite|Premium Income|Option Income|YieldMax/i.test(n) && !t.tags.includes("covered-call") && !t.tags.includes("defined-outcome")) ||
      (/\bVIX\b/i.test(n) && !t.tags.includes("volatility"))
    );
  }),
  (i) => label(i.t),
);

show("hedged 태그가 붙음(붙으면 안 된다)", items.filter((i) => i.t.tags.includes("hedged")));

show("ETN 이름(수집 단계에서 제외돼야 한다)", items.filter((i) => /\bETNs?\b/.test(i.row.name)), (i) => label(i.t));

show(
  "자산군이 카테고리의 상식과 어긋남(채권 카테고리인데 채권·현금성이 아니거나, 주식 카테고리인데 채권)",
  items.filter((i) => {
    const c = i.row.cat;
    if (!c) return false;
    const bondish = /Bond|Government|Muni|Inflation-Protected|Bank Loan|Mortgage|Securitized/.test(c) && !c.startsWith("Trading--");
    return (bondish && i.t.assetClass !== "bond" && i.t.assetClass !== "cash") || (/^(?:Large|Mid-Cap|Small) /.test(c) && i.t.assetClass !== "global-equity");
  }),
  (i) => label(i.t),
);

show("브랜드가 이름의 접두사가 아님", items.filter((i) => i.t.brand !== "" && !(i.row.name.startsWith(i.t.brand) && (i.row.name.length === i.t.brand.length || /\s/.test(i.row.name.charAt(i.t.brand.length))))), (i) => `brand="${i.t.brand}"`);
show("브랜드가 비어 있음", items.filter((i) => i.t.brand === ""), (i) => label(i.t));

// 단일 종목 상품: 기초 종목이 테마 표에 없으면 테마가 비어 버린다.
const singles = items.filter((i) => i.t.tags.includes("concentrated")).map((i) => ({ i, u: singleStockUnderlying(i.row.name) }));
const unmapped = count(singles.filter((s) => s.u && !US_STOCK_THEME[s.u.toLowerCase()]).map((s) => (s.u as string).toUpperCase()));
console.log(`\n■ 단일 종목 상품 ${singles.length}건 중 테마 표에 없는 기초 종목 ${unmapped.length}종: ${fmt(unmapped, 60)}`);

// ───────── groupKey ─────────
const groups = new Map<string, Item[]>();
for (const i of items) {
  const g = groups.get(i.t.groupKey);
  if (g) g.push(i);
  else groups.set(i.t.groupKey, [i]);
}
const multi = [...groups].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
console.log(`\n■ groupKey: 고유 ${groups.size}개, 2개 이상 묶인 그룹 ${multi.length}개(${multi.reduce((s, [, v]) => s + v.length, 0)}종목)`);
for (const [k, v] of multi.slice(0, listAll ? Infinity : 40)) {
  console.log(`  ${k}  ←  ${v.map((x) => `${x.row.s}(${x.row.name.slice(0, 38)})`).join(" | ")}`);
}
if (!listAll && multi.length > 40) console.log(`  … 외 ${multi.length - 40}그룹`);
