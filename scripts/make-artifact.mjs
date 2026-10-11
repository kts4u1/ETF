// 빌드(dist/)를 claude.ai 아티팩트로 게시할 수 있는 모양으로 만든다.
//   - .artifact/etf-search.html : 번들 JS·CSS 를 안에 넣은 단일 페이지(아티팩트는 <html>·<head> 없이 내용만 받는다)
//   - .artifact/data/*.json      : 앱이 상대 경로(./data/…)로 읽는 데이터 파일
// 마지막 줄에 Artifact 도구의 `files` 인자로 쓸 JSON({게시 경로: 원본 경로})을 출력한다.
// 사용: npm run artifact   (= npm run build && node scripts/make-artifact.mjs)
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2] ?? "dist";
const out = process.argv[3] ?? ".artifact";

const html = readFileSync(join(dist, "index.html"), "utf8");
const find = (re, what) => {
  const m = re.exec(html);
  if (!m) throw new Error(`dist/index.html 에서 ${what} 을(를) 찾지 못했습니다. 먼저 npm run build 를 실행하세요.`);
  return m[1];
};
const js = readFileSync(join(dist, "assets", find(/assets\/(index-[^"]+\.js)/, "JS 번들")), "utf8");
const css = readFileSync(join(dist, "assets", find(/assets\/(index-[^"]+\.css)/, "CSS 번들")), "utf8");
const desc = find(/name="description" content="([^"]+)"/, "meta description");
if (/<\/script/i.test(js) || /<\/style/i.test(css)) throw new Error("번들에 닫는 태그가 들어 있어 인라인할 수 없습니다(이스케이프 필요).");

const page = `<title>ETF Search</title>
<meta name="description" content="${desc}">
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "data"), { recursive: true });
writeFileSync(join(out, "etf-search.html"), page);
const files = {};
for (const f of readdirSync(join(dist, "data")).filter((n) => n.endsWith(".json")).sort()) {
  copyFileSync(join(dist, "data", f), join(out, "data", f));
  files[`data/${f}`] = `${out}/data/${f}`;
}
console.log(`페이지 ${(page.length / 1024).toFixed(0)}KB, 데이터 파일 ${Object.keys(files).length}개 → ${out}/`);
console.log(JSON.stringify(files));
