// 휴대폰 화면 감사. usage: node scripts/mobile-audit.cjs <distDir> <outDir> [shots]  (전역 playwright 필요, 먼저 npm run build)
// 9개 화면 × 폭 320·360·390·412 × 한국어·영어 × 라이트·다크마다 가로 넘침, 터치 대상 크기, 입력칸 글자 크기, 고정 헤더 높이를 재서 요약한다.
// 가로 넘침이나 16px 미만 입력칸(iOS 가 확대함)이 있으면 종료 코드 1. 터치 대상 목록은 참고용(문장 안 링크는 제외, 목록 속 이름 링크는 24px 이상이면 허용).
const http = require("http"), fs = require("fs"), path = require("path");
const { chromium } = require(require("child_process").execSync("npm root -g").toString().trim() + "/playwright");
const DIST = process.argv[2], OUT = process.argv[3], SHOTS = process.argv[4] === "shots";
fs.mkdirSync(OUT, { recursive: true });
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f)) { res.statusCode = 404; return res.end(); }
  res.setHeader("content-type", types[path.extname(f)] || "application/octet-stream"); res.end(fs.readFileSync(f));
});
const ROUTES = [
  ["home", "#/"], ["explore", "#/explore"], ["etf-kr", "#/etf/069500"], ["etf-us", "#/etf/SPY"],
  ["compare", "#/compare?codes=069500,SPY"], ["combo", "#/combo"], ["basket", "#/basket"], ["learn", "#/learn"], ["method", "#/method"],
];
const WIDTHS = [320, 360, 390, 412];
const BASKET = JSON.stringify([
  { code: "069500", name: "KODEX 200", addedAt: "2026-10-01", note: "코어" },
  { code: "SPY", name: "SPDR S&P 500 ETF Trust", addedAt: "2026-10-02", note: "" },
  { code: "360750", name: "TIGER 미국S&P500", addedAt: "2026-10-03", note: "적립식으로 매달 사는 후보" },
]);
srv.listen(0, async () => {
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const report = [];
  for (const w of WIDTHS) for (const lang of ["ko", "en"]) for (const theme of ["light", "dark"]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
    await ctx.addInitScript(([lang, theme, basket]) => {
      try { localStorage.setItem("etf-picker:lang", lang); localStorage.setItem("etf-picker:theme", theme); localStorage.setItem("etf-picker:basket:v1", basket); } catch {}
    }, [lang, theme, BASKET]);
    const pg = await ctx.newPage();
    for (const [name, hash] of ROUTES) {
      await pg.goto(base + hash, { waitUntil: "networkidle" });
      await pg.waitForTimeout(450);
      const r = await pg.evaluate(() => {
        const vw = window.innerWidth;
        const doc = document.documentElement;
        const overflow = doc.scrollWidth - vw;
        // 화면 밖으로 삐져나온 요소(스크롤 영역 안쪽은 제외)
        const out = [];
        const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) return true; } return false; };
        for (const el of document.body.querySelectorAll("*")) {
          if (el.closest("thead")) continue;
          const rc = el.getBoundingClientRect();
          if (rc.width === 0 || rc.height === 0) continue;
          if ((rc.right > vw + 1 || rc.left < -1) && !inScroller(el) && getComputedStyle(el).position !== "fixed") { out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}[${Math.round(rc.left)},${Math.round(rc.right)}]`); if (out.length > 4) break; }
        }
        const vis = (el) => { if (el.closest("thead") && getComputedStyle(el.closest("thead")).position === "absolute") return false; const rc = el.getBoundingClientRect(); const cs = getComputedStyle(el); return rc.width > 0 && rc.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest(".sr-only") && !el.closest("[hidden]"); };
        const small = [];
        for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button]")) {
          if (!vis(el)) continue;
          let rc = el.getBoundingClientRect();
          // 라벨로 감싼 체크박스는 라벨 전체가 눌리는 영역
          const lab = el.closest("label"); if (lab && (el.type === "checkbox" || el.type === "radio")) rc = lab.getBoundingClientRect();
          // 문장 안의 링크는 WCAG 가 예외로 둔다 → 블록 안 글줄 링크는 제외
          if (el.tagName === "A" && getComputedStyle(el).display === "inline" && el.closest("p, li, small, .hint, .muted, dd, td")) continue;
          if (rc.width < 44 || rc.height < 44) small.push({ t: (el.tagName.toLowerCase() + (el.className ? "." + String(el.className).split(" ")[0] : "")), txt: (el.textContent || el.getAttribute("aria-label") || el.placeholder || "").trim().slice(0, 18), w: Math.round(rc.width), h: Math.round(rc.height) });
        }
        const fields = [];
        for (const el of document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea")) { if (!vis(el)) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16) fields.push(`${el.tagName.toLowerCase()}:${fs}`); }
        const tb = document.querySelector(".topbar"); const tbh = tb ? Math.round(tb.getBoundingClientRect().height) : 0;
        const nav = document.querySelector("nav"); const navOver = nav ? nav.scrollWidth - nav.clientWidth : 0;
        const tiny = []; // 12px 미만 글자
        for (const el of document.querySelectorAll("main *, footer *")) { if (el.children.length) continue; if (!el.textContent.trim() || !vis(el)) continue; const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 11.5) tiny.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 14)}:${fs}`); }
        return { overflow, out, small, fields, tbh, navOver, tiny: [...new Set(tiny)].slice(0, 5), h: doc.scrollHeight };
      });
      report.push({ w, lang, theme, route: name, ...r });
      if (SHOTS && lang === "ko" && theme === "light" && (w === 360)) await pg.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: false });
    }
    await ctx.close();
  }
  await b.close(); srv.close();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  // 요약
  const bad = report.filter((r) => r.overflow > 0 || r.out.length);
  console.log("== 가로 넘침/삐져나옴 ==", bad.length ? "" : "없음");
  for (const r of bad) console.log(`${r.w} ${r.lang} ${r.theme} ${r.route}: overflow=${r.overflow} ${r.out.join(" ")}`);
  console.log("== 상단바 높이(폭별, ko/light) ==");
  for (const w of WIDTHS) { const x = report.find((r) => r.w === w && r.lang === "ko" && r.theme === "light" && r.route === "home"); const y = report.find((r) => r.w === w && r.lang === "en" && r.theme === "light" && r.route === "home"); console.log(w, "ko", x.tbh, "en", y.tbh, "navOver ko/en", x.navOver, y.navOver); }
  console.log("== 입력칸 글자 16px 미만 ==");
  const fl = new Map(); for (const r of report) for (const f of r.fields) fl.set(r.route + " " + f, 1); console.log([...fl.keys()].join(" | ") || "없음");
  console.log("== 11.5px 미만 글자 ==");
  const tl = new Map(); for (const r of report) for (const f of r.tiny) tl.set(r.route + " " + f, 1); console.log([...tl.keys()].join(" | ") || "없음");
  console.log("== 44px 미만 터치 대상(360, ko, light) ==");
  for (const [name] of ROUTES) { const r = report.find((q) => q.w === 360 && q.lang === "ko" && q.theme === "light" && q.route === name); const g = new Map(); for (const s of r.small) { const k = `${s.t} ${s.w}x${s.h}${s.w > 100 && s.h < 44 ? " «" + s.txt + "»" : ""}`; g.set(k, (g.get(k) || 0) + 1); } console.log(name, "총", r.small.length, [...g].map(([k, n]) => `${k}×${n}`).join(", ")); }
  const fieldBad = report.some((r) => r.fields.length);
  if (bad.length || fieldBad) { console.log("\n실패: 가로 넘침 또는 16px 미만 입력칸"); process.exit(1); }
});
