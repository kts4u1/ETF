// 영어/한국어 화면의 한글 잔존 점검 + 언어 도입 이전 빌드와의 비교용. usage: node scripts/scan-i18n.cjs <distDir> <ko|en> <out.json> (전역 playwright 필요)
// 모든 화면을 지정한 언어로 열어 텍스트를 모으고, en 이면 데이터 값(ETF 이름·운용사·설명·구성종목 이름)을 뺀 한글 잔존을 찾는다.
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
const [DIST, LANG, OUT] = process.argv.slice(2);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const snap = JSON.parse(fs.readFileSync("/home/user/ETF/public/data/snapshot.json", "utf8"));
const hold = JSON.parse(fs.readFileSync("/home/user/ETF/public/data/holdings.json", "utf8"));
const hang = (s) => String(s ?? "").match(/[가-힣]+/g) ?? [];
const dataTokens = new Set();
for (const e of snap.etfs) for (const f of [e.name, e.issuer, e.description]) hang(f).forEach((t) => dataTokens.add(t));
for (const n of hold.names ?? []) hang(n).forEach((t) => dataTokens.add(t));

// 샘플 ETF: 시장 x 자산군 x (첫 태그) 조합마다 상위 1개(순자산 큰 순)
const pick = new Map();
for (const e of [...snap.etfs].sort((a, b) => b.aumEok - a.aumEok)) {
  const key = `${e.market ?? "KR"}|${e.tax.assetClass}|${e.tax.tags[0] ?? "-"}`;
  if (!pick.has(key)) pick.set(key, e.code);
}
const codes = [...new Set([...pick.values(), "069500", "122630", "SPY", "VTI", "IBIT", "TQQQ", "JEPI"])].filter((c) => snap.etfs.some((e) => e.code === c));

const srv = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html"; const f = path.join(DIST, p); if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); } res.setHeader("content-type", types[path.extname(f)] || "application/octet-stream"); res.end(fs.readFileSync(f)); });
srv.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const results = {}; const issues = [];
  const collect = (pg) => pg.evaluate(() => {
    const attrs = [];
    document.querySelectorAll("[title],[aria-label],[placeholder],[alt]").forEach((el) => { for (const a of ["title", "aria-label", "placeholder", "alt"]) { const v = el.getAttribute(a); if (v) attrs.push(`@${a}: ${v}`); } });
    return { text: document.body.innerText, attrs: [...new Set(attrs)], title: document.title, htmlLang: document.documentElement.lang, metaDesc: (document.querySelector('meta[name=description]') || {}).content || "", overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const variants = [];
  for (const profile of ["stable", "balanced", "aggressive"]) for (const horizon of ["short", "mid", "long"]) for (const market of ["all", "KR", "US"]) variants.push({ profile, horizon, market });
  async function open(prefs, width) {
    const ctx = await b.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(([lang, prefsJson]) => { try { localStorage.setItem("etf-picker:lang", lang); if (prefsJson) localStorage.setItem("etf-picker:prefs:v1", prefsJson); } catch (e) {} }, [LANG, prefs ? JSON.stringify(prefs) : null]);
    const pg = await ctx.newPage();
    pg.on("console", (m) => { if (["error", "warning"].includes(m.type())) issues.push(`console.${m.type()}: ${m.text().slice(0, 140)}`); });
    pg.on("pageerror", (e) => issues.push(`pageerror: ${e.message.slice(0, 140)}`));
    await pg.goto(base, { waitUntil: "networkidle" });
    return { ctx, pg };
  }
  const DEF = { profile: "balanced", horizon: "mid", assetClasses: null, market: "all", includeLeveraged: false, includeCoveredCall: true, includeYoung: false, minAumEok: 300, maxFee: null, dedupe: true };
  // 1) 추천 화면: 성향·기간·시장 27개
  for (const v of variants) {
    const { ctx, pg } = await open({ ...DEF, ...v }, 1280);
    results[`home|${v.profile}|${v.horizon}|${v.market}`] = await collect(pg); await ctx.close();
  }
  // 2) 나머지 화면(기본 설정)
  const { ctx, pg } = await open(null, 1280);
  const routes = ["#/explore", "#/learn", "#/method", "#/combo", "#/compare?codes=069500,SPY,VTI,QQQ", "#/compare", ...codes.map((c) => `#/etf/${c}`)];
  for (const r of routes) { await pg.evaluate((x) => { location.hash = x; }, r); await pg.waitForTimeout(700); results[r] = await collect(pg); }
  // 탐색: 검색·더보기·정렬
  await pg.evaluate(() => { location.hash = "#/explore"; }); await pg.waitForTimeout(500);
  const sb = pg.getByRole("searchbox").first(); await sb.fill("spy"); await pg.waitForTimeout(400); results["explore:search"] = await collect(pg);
  await sb.fill("zzzzqq"); await pg.waitForTimeout(400); results["explore:empty"] = await collect(pg);
  await ctx.close();
  // 3) 조합 화면 prefs 변형
  for (const profile of ["stable", "balanced", "aggressive"]) for (const market of ["all", "KR", "US"]) {
    const o = await open({ ...DEF, profile, market }, 1280); await o.pg.evaluate(() => { location.hash = "#/combo"; }); await o.pg.waitForTimeout(900);
    results[`combo|${profile}|${market}`] = await collect(o.pg); await o.ctx.close();
  }
  // 4) 390px 가로 넘침
  const narrow = await open(null, 390);
  for (const r of ["#/", "#/explore", "#/learn", "#/method", "#/combo", "#/etf/SPY", "#/etf/069500", "#/compare?codes=069500,SPY,VTI,QQQ"]) { await narrow.pg.evaluate((x) => { location.hash = x; }, r); await narrow.pg.waitForTimeout(600); const c = await collect(narrow.pg); if (c.overflow > 0) issues.push(`[390] ${r} horizontal overflow ${c.overflow}px`); }
  await narrow.ctx.close();
  // 한글 잔존(en)
  const left = {};
  if (LANG === "en") for (const [k, v] of Object.entries(results)) {
    const bad = new Map();
    for (const line of [...v.text.split("\n"), ...v.attrs, v.title, v.metaDesc]) for (const t of hang(line)) if (!dataTokens.has(t)) { const a = bad.get(t) ?? []; if (a.length < 2) a.push(line.slice(0, 120)); bad.set(t, a); }
    if (bad.size) left[k] = Object.fromEntries(bad);
    if (v.htmlLang !== "en") issues.push(`${k}: html lang=${v.htmlLang}`);
  }
  fs.writeFileSync(OUT, JSON.stringify({ results, left, issues: [...new Set(issues)] }, null, 1));
  const tok = new Map(); for (const v of Object.values(left)) for (const [t, ctxs] of Object.entries(v)) tok.set(t, (tok.get(t) ?? 0) + 1);
  console.log(LANG, "routes", Object.keys(results).length, "| pages with leftover Hangul:", Object.keys(left).length, "| distinct tokens:", tok.size);
  console.log([...tok.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t, n]) => `${t}(${n})`).join(" "));
  console.log("issues:", [...new Set(issues)].join(" || ") || "none");
  await b.close(); srv.close();
});
