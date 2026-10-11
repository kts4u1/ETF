// 갱신한 데이터가 의미 있게 바뀌었는지 판정한다(마지막 줄에 changed / unchanged 를 출력).
// 매번 달라지는 생성 시각(generatedAt)과 제공처가 소수점 끝자리만 고쳐 주는 수정종가 때문에 파일이 항상 다르게 나오므로,
// 파일 바이트가 아니라 "ETF 구성(코드 집합), 국내·해외 시세 기준일, 해외 검색 색인"이 바뀌었는지를 본다.
// unchanged 이면 public/data 를 커밋된 상태로 되돌려 불필요한 커밋을 막는다.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const head = (path) => {
  try {
    return JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null; // 커밋된 적이 없으면 새 파일
  }
};
const codes = (snap) => (snap?.etfs ?? []).map((e) => e.code).sort().join(",");
const indexKey = (idx) => (idx?.etfs ?? []).map((r) => r.join("|")).join("\n");

const was = head("public/data/snapshot.json");
const now = read("public/data/snapshot.json");
const wasIdx = head("public/data/us-index.json");
const nowIdx = read("public/data/us-index.json");
const reasons = [];
if (!was) reasons.push("이전 스냅샷 없음");
else {
  if (was.asOf !== now.asOf) reasons.push(`국내 기준일 ${was.asOf} → ${now.asOf}`);
  if (was.asOfUs !== now.asOfUs) reasons.push(`해외 기준일 ${was.asOfUs} → ${now.asOfUs}`);
  if (codes(was) !== codes(now)) reasons.push("ETF 구성 변경(신규·삭제)");
}
if (indexKey(wasIdx) !== indexKey(nowIdx)) reasons.push("해외 검색 색인 변경");

if (reasons.length === 0) {
  execFileSync("git", ["checkout", "--", "public/data"], { stdio: "inherit" });
  console.log("unchanged");
} else {
  console.log(`변경: ${reasons.join(", ")}`);
  console.log("changed");
}
