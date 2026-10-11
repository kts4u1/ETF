// 갱신한 데이터를 커밋할지 판정한다. 마지막 줄에 changed / unchanged / suspicious 를 출력한다(판정 기준은 src/sync/refresh-decision.ts).
// unchanged·suspicious 이면 public/data 를 커밋된 상태로 되돌려, 불필요하거나 의심스러운 데이터가 남지 않게 한다.
// 환경변수
//   REFRESH_STALE_DAYS(기본 5)   시세만 바뀐 경우 마지막 커밋보다 이만큼 이상 새로울 때 커밋. 1 이면 거래일마다.
//   REFRESH_ACCEPT_SHRINK=1      종목이 크게 줄어든 것을 사람이 승인했다(필터 기준 변경·대규모 상장폐지 등). 기준일 검사는 그대로 한다.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { SYNC_FAILURES_FILE } from "../src/sync/build-snapshot";
import { DEFAULT_STALE_DAYS, decideRefresh, type IndexLike, type SnapLike } from "../src/sync/refresh-decision";

const read = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};
const restore = () => execFileSync("git", ["checkout", "--", "public/data"], { stdio: "inherit" });
const RECOVERY =
  "복구: 정상적인 변화라면 GitHub Actions 의 Run workflow 에서 accept_shrink 를 켜서 다시 실행하거나, 로컬에서 npm run sync 로 받아 diff 를 확인한 뒤 public/data 를 직접 커밋·푸시하세요(기준선이 갱신됩니다). 그렇지 않다면 제공처 응답이나 수집 기준 변경을 확인하세요.";

/** HEAD 의 파일. 커밋된 적이 없으면 null. 있는데 읽지 못하면(용량 초과 등) 안전장치가 꺼지지 않도록 예외로 둔다 */
function head<T>(path: string): T | null {
  try {
    execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], { stdio: "ignore" });
  } catch {
    return null; // 커밋된 적이 없는 새 파일
  }
  return JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] })) as T;
}

const now = read<SnapLike>("public/data/snapshot.json");
if (!now) {
  console.log("public/data/snapshot.json 을 읽을 수 없습니다.");
  restore();
  console.log(RECOVERY);
  console.log("suspicious");
  process.exit(0);
}
const envDays = process.env.REFRESH_STALE_DAYS;
const staleDays = envDays ? Number(envDays) : DEFAULT_STALE_DAYS;
const unavailable = read<{ retryable?: string[] }>(SYNC_FAILURES_FILE)?.retryable ?? [];
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const decision = decideRefresh(head<SnapLike>("public/data/snapshot.json"), now, head<IndexLike>("public/data/us-index.json"), read<IndexLike>("public/data/us-index.json"), {
  staleDays,
  unavailable,
  today,
  acceptShrink: process.env.REFRESH_ACCEPT_SHRINK === "1",
});

if (decision.result !== "changed") restore();
for (const r of decision.reasons) console.log(`${decision.result === "suspicious" ? "⚠ 이상 징후" : decision.result === "changed" ? "변경" : "참고"}: ${r}`);
if (decision.result === "suspicious") console.log(RECOVERY);
console.log(decision.result);
