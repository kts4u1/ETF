// 갱신한 데이터를 커밋할지 판정한다. 마지막 줄에 changed / unchanged / suspicious 를 출력한다(판정 기준은 src/sync/refresh-decision.ts).
// unchanged·suspicious 이면 public/data 를 커밋된 상태로 되돌려, 불필요하거나 의심스러운 데이터가 남지 않게 한다.
// 환경변수 REFRESH_STALE_DAYS(기본 5): 시세만 바뀐 경우 마지막 커밋보다 이만큼 이상 새로울 때 커밋. 1 이면 거래일마다.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { DEFAULT_STALE_DAYS, decideRefresh, type IndexLike, type SnapLike } from "../src/sync/refresh-decision";

const read = <T>(path: string): T | null => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
};
const head = <T>(path: string): T | null => {
  try {
    return JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })) as T;
  } catch {
    return null; // 커밋된 적이 없으면 새 파일
  }
};

const now = read<SnapLike>("public/data/snapshot.json");
if (!now) {
  console.log("public/data/snapshot.json 을 읽을 수 없습니다.");
  execFileSync("git", ["checkout", "--", "public/data"], { stdio: "inherit" });
  console.log("suspicious");
  process.exit(0);
}
const envDays = process.env.REFRESH_STALE_DAYS;
const staleDays = envDays ? Number(envDays) : DEFAULT_STALE_DAYS;
const decision = decideRefresh(head<SnapLike>("public/data/snapshot.json"), now, head<IndexLike>("public/data/us-index.json"), read<IndexLike>("public/data/us-index.json"), { staleDays });

if (decision.result !== "changed") execFileSync("git", ["checkout", "--", "public/data"], { stdio: "inherit" });
for (const r of decision.reasons) console.log(`${decision.result === "suspicious" ? "⚠ 이상 징후" : decision.result === "changed" ? "변경" : "참고"}: ${r}`);
console.log(decision.result);
