// 휴대폰(터치) 동작 점검. usage: node scripts/mobile-e2e.cjs <distDir> <outDir>  (전역 playwright 필요, 먼저 npm run build)
// 터치 에뮬레이션으로 탐색 카드(정렬 막대·장바구니·체크박스 탭), 차트 탭(값 표시 유지), 320px 비교 차트, 데스크톱 회귀를 확인한다.
const http=require("http"),fs=require("fs"),path=require("path");
const {chromium}=require(require("child_process").execSync("npm root -g").toString().trim()+"/playwright");
const DIST=process.argv[2],OUT=process.argv[3];fs.mkdirSync(OUT,{recursive:true});
const types={".html":"text/html; charset=utf-8",".js":"text/javascript",".css":"text/css",".json":"application/json",".svg":"image/svg+xml"};
const srv=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split("?")[0]);if(p.endsWith("/"))p+="index.html";const f=path.join(DIST,p);if(!f.startsWith(DIST)||!fs.existsSync(f)){res.statusCode=404;return res.end();}res.setHeader("content-type",types[path.extname(f)]||"application/octet-stream");res.end(fs.readFileSync(f));});
let fails=0;const ok=(c,m)=>{console.log((c?"PASS ":"FAIL ")+m);if(!c)fails++;};
srv.listen(0,async()=>{const base=`http://127.0.0.1:${srv.address().port}/`;const b=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
// ── 폰
{const ctx=await b.newContext({viewport:{width:360,height:740},deviceScaleFactor:2,isMobile:true,hasTouch:true});const pg=await ctx.newPage();
 const errs=[];pg.on("pageerror",e=>errs.push(String(e)));pg.on("console",m=>{if(m.type()==="error")errs.push(m.text())});
 await pg.goto(base+"#/explore",{waitUntil:"networkidle"});await pg.waitForTimeout(400);
 ok(await pg.evaluate(()=>matchMedia("(pointer: coarse)").matches),"터치 에뮬레이션에서 (pointer: coarse) 일치");
 ok(await pg.locator(".sort-bar").isVisible(),"좁은 화면: 정렬 막대 보임");
 ok(!(await pg.locator("table.explore thead").isVisible()),"좁은 화면: 표 머리글 숨김(카드)");
 const rowsBefore=await pg.locator("table.explore tbody tr").count();
 // 정렬: 1년 수익률 내림차순 → 첫 카드 값이 둘째보다 크거나 같다
 await pg.selectOption(".sort-bar select","y1");await pg.waitForTimeout(250);
 const vals=await pg.$$eval("table.explore tbody tr td.num:nth-child(5)",els=>els.slice(0,6).map(e=>parseFloat(e.textContent.replace(/[^0-9.\-]/g,""))));
 ok(vals.length>=2&&vals.every((v,i)=>i===0||vals[i-1]>=v),"정렬 기준 1년 → 내림차순 "+vals.join(","));
 await pg.tap(".sort-bar .btn");await pg.waitForTimeout(250);
 const vals2=await pg.$$eval("table.explore tbody tr td.num:nth-child(5)",els=>els.slice(0,6).map(e=>parseFloat(e.textContent.replace(/[^0-9.\-]/g,""))));
 ok(vals2.length>=2&&vals2.every((v,i)=>i===0||vals2[i-1]<=v),"방향 버튼 → 오름차순 "+vals2.join(","));
 ok((await pg.locator(".sort-bar .btn").textContent()).includes("오름"),"방향 버튼 글자 갱신");
 // 카드의 장바구니 버튼·체크박스 탭
 await pg.tap("table.explore tbody tr:nth-child(1) .basket-btn");await pg.waitForTimeout(250);
 ok(await pg.locator(".nav-count").textContent()==="1","카드 장바구니 버튼 탭 → 담김(배지 1)");
 ok(await pg.locator(".toast").isVisible(),"담은 뒤 알림 표시");
 await pg.tap("table.explore tbody tr:nth-child(1) .tap-check");await pg.tap("table.explore tbody tr:nth-child(2) .tap-check");await pg.waitForTimeout(200);
 ok(await pg.locator("a.btn:has-text('비교')").isVisible(),"카드 체크박스 2개 탭 → 비교 버튼 나타남");
 const chkBox=await pg.locator("table.explore tbody tr:nth-child(1) .tap-check").boundingBox();
 ok(chkBox.width>=44&&chkBox.height>=44,"체크박스 탭 영역 44px 이상 "+Math.round(chkBox.width)+"x"+Math.round(chkBox.height));
 const cardBox=await pg.locator("table.explore tbody tr:nth-child(1)").boundingBox();
 ok(cardBox.x>=0&&cardBox.x+cardBox.width<=360,"카드가 화면 폭 안");
 // 정렬 select 글자 크기(iOS 확대 방지)
 ok(await pg.$eval(".sort-bar select",e=>parseFloat(getComputedStyle(e).fontSize))>=16,"정렬 select 16px 이상");
 // 차트: 탭하면 값 표시, 손가락 떼도 유지, 세로 스크롤(pointercancel)이면 사라짐
 await pg.goto(base+"#/etf/069500",{waitUntil:"networkidle"});await pg.waitForTimeout(700);
 const svg=pg.locator(".chart svg").first();await svg.scrollIntoViewIfNeeded();const bb=await svg.boundingBox();
 await pg.touchscreen.tap(bb.x+bb.width*0.5,bb.y+bb.height*0.5);await pg.waitForTimeout(250);
 ok(await pg.locator(".tooltip").isVisible(),"차트 탭 → 값 표시");
 await pg.waitForTimeout(800);
 ok(await pg.locator(".tooltip").isVisible(),"손가락을 뗀 뒤에도 값 표시 유지");
 await pg.touchscreen.tap(bb.x+bb.width*0.8,bb.y+bb.height*0.5);await pg.waitForTimeout(200);
 const t1=await pg.locator(".tooltip-date").textContent();
 await pg.touchscreen.tap(bb.x+bb.width*0.2,bb.y+bb.height*0.5);await pg.waitForTimeout(200);
 const t2=await pg.locator(".tooltip-date").textContent();
 ok(t1!==t2,"다른 곳을 탭하면 값이 바뀜 "+t1+" → "+t2);
 const tip=await pg.locator(".tooltip").boundingBox();ok(tip.x>=0&&tip.x+tip.width<=360,"툴팁이 화면 안");
 // 비교 차트: 끝 이름표가 svg 안에서 잘리지 않는다(왼쪽 320 도 아래서)
 await ctx.close();}
// ── 320 폭
{const ctx=await b.newContext({viewport:{width:320,height:640},deviceScaleFactor:2,isMobile:true,hasTouch:true});const pg=await ctx.newPage();
 await pg.goto(base+"#/compare?codes=069500,SPY,360750,QQQ",{waitUntil:"networkidle"});await pg.waitForTimeout(700);
 const r=await pg.evaluate(()=>{const svg=document.querySelector(".chart svg");const sr=svg.getBoundingClientRect();const out=[];for(const t of svg.querySelectorAll("text.end-label")){const tr=t.getBoundingClientRect();if(tr.right>sr.right+0.5)out.push(t.textContent+":"+Math.round(tr.right-sr.right));}return {out,svgW:Math.round(sr.width),cardW:Math.round(svg.parentElement.getBoundingClientRect().width)}});
 ok(r.out.length===0,"320px 비교 차트 끝 이름표가 잘리지 않음 "+JSON.stringify(r));
 ok(await pg.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),"320px 비교 화면 가로 넘침 없음");
 const hdr=await pg.evaluate(()=>({h:Math.round(document.querySelector(".topbar").getBoundingClientRect().height),brandText:getComputedStyle(document.querySelector(".brand-text")).display}));
 ok(hdr.brandText==="none"&&hdr.h<=103,"320px: 로고 글자 숨기고 한 줄에 들어감 "+JSON.stringify(hdr));
 await ctx.close();}
// ── 데스크톱 회귀
{const ctx=await b.newContext({viewport:{width:1280,height:900}});const pg=await ctx.newPage();
 await pg.goto(base+"#/explore",{waitUntil:"networkidle"});await pg.waitForTimeout(400);
 ok(!(await pg.locator(".sort-bar").isVisible()),"데스크톱: 정렬 막대 숨김");
 ok(await pg.locator("table.explore thead").isVisible(),"데스크톱: 표 머리글 보임");
 ok((await pg.locator("table.explore tbody tr:nth-child(1) .tap-check").boundingBox()).width<30,"데스크톱: 체크박스 영역 작음(표 레이아웃 유지)");
 const nav=await pg.evaluate(()=>{const t=document.querySelector(".topbar");return {pos:getComputedStyle(t).top,h:Math.round(t.getBoundingClientRect().height)}});
 ok(nav.pos==="0px"&&nav.h<=60,"데스크톱: 상단바 그대로 "+JSON.stringify(nav));
 await pg.screenshot({path:path.join(OUT,"desk-explore.png")});
 await pg.goto(base+"#/compare?codes=069500,SPY",{waitUntil:"networkidle"});await pg.waitForTimeout(600);
 await pg.screenshot({path:path.join(OUT,"desk-compare.png"),fullPage:true});
 ok(await pg.evaluate(()=>getComputedStyle(document.querySelector(".ovl-legend")).display==="none"),"데스크톱: 겹침 범례(A·B) 숨김");
 await ctx.close();}
await b.close();srv.close();console.log(fails?`\n${fails} FAILED`:"\nall passed");process.exit(fails?1:0);});
