import { backtestToFile } from "./backtest";
import { syncAll } from "./build-snapshot";
import { deriveDelisted, parseDeriveArgs } from "./derive-delisted";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  if (i >= 0) return rest[i + 1];
  const eq = rest.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
};

async function main() {
  switch (cmd) {
    case "sync": {
      const limit = value("limit");
      const usLimit = value("us-limit");
      // 값 없이 `--us-limit` 만 쓴 경우도 조용히 무시하지 않고 막는다
      if ((usLimit !== undefined || flag("us-limit")) && !(Number.isInteger(Number(usLimit)) && Number(usLimit) > 0)) {
        console.log(`--us-limit 는 1 이상의 정수여야 합니다(입력: ${usLimit ?? "값 없음"}).`);
        process.exitCode = 1;
        break;
      }
      const { failed } = await syncAll({
        force: flag("force"),
        limit: limit ? Number(limit) : undefined,
        concurrency: value("concurrency") ? Number(value("concurrency")) : undefined,
        skipHoldings: flag("skip-holdings"),
        skipUs: flag("skip-us"),
        usLimit: usLimit ? Number(usLimit) : undefined,
        log: (m) => console.log(m),
      });
      if (failed.length) {
        console.warn(`\n⚠ ${failed.length}건은 일부 데이터 없이 처리되었거나 제외되었습니다:`);
        for (const f of failed.slice(0, 30)) console.warn("  - " + f);
        if (failed.length > 30) console.warn(`  … 외 ${failed.length - 30}건`);
      }
      break;
    }
    case "backtest":
      await backtestToFile();
      break;
    case "derive-delisted": {
      // 사용법: npm run derive-delisted -- <KRX_전종목시세.csv> [더 많은 파일…] [--date YYYYMMDD(파일이 1개일 때)]
      const parsed = parseDeriveArgs(rest);
      if ("error" in parsed) {
        console.log(parsed.error);
        process.exitCode = 1;
        break;
      }
      const r = await deriveDelisted(parsed.paths.map((path) => ({ path, date: parsed.date })), (m) => console.log(m));
      for (const f of r.files) console.log(`${f.verdict === "ok" ? "✓" : "✗"} ${f.path.split("/").pop()} — ${f.date ?? "날짜 불명"}, ${f.rows}행: ${f.note}`);
      console.log(`\n후보 ${r.candidates}개 → 상장폐지 ${r.delisted.length}개, 거래 중 ${r.stillTrading.length}개(제외), 시세 없음 ${r.noPrices.length}개(제외), 시세 수집 실패 ${r.failed.length}개`);
      for (const d of r.delisted) console.log(`  폐지 ${d.code} ${d.name} (상장폐지일=시세의 마지막 행 ${d.delistedOn})`);
      for (const d of r.stillTrading) console.log(`  거래 중(제외) ${d.code} ${d.name} (마지막 ${d.lastDate})`);
      for (const d of r.noPrices) console.log(`  시세 없음(제외) ${d.code} ${d.name}`);
      if (r.failed.length) {
        for (const d of r.failed) console.log(`  수집 실패 ${d.code} ${d.name}: ${d.reason}`);
        console.log("\n⚠ 시세를 받지 못한 후보가 있어 data/delisted.csv·delisted.meta.json 을 갱신하지 않았습니다. 같은 날 같은 명령을 다시 실행하면 이미 받은 시세는 캐시에서 읽고 나머지만 받습니다.");
        process.exitCode = 3;
      } else if (r.files.some((f) => f.verdict === "rejected")) {
        if (r.files.some((f) => f.verdict === "ok")) console.log("\n거부된 파일이 있습니다. 통과한 파일의 결과는 저장했습니다.");
        process.exitCode = 2;
      }
      break;
    }
    default:
      console.log(
        "사용법:\n  npm run sync [-- --force] [-- --limit N] [-- --concurrency N] [-- --skip-holdings] [-- --skip-us] [-- --us-limit N]\n"
          + "    --limit N      개발용: 국내 ETF 는 상위 N개만(미국은 이 옵션의 영향을 받지 않으니 --us-limit 이나 --skip-us 로 따로 줄이세요)\n"
          + "    --skip-us      미국 상장 ETF 수집을 건너뛰고 국내만 저장(기존 snapshot.json 의 해외 ETF 는 지워집니다)\n"
          + "    --us-limit N   개발용: 미국 ETF 는 거래대금 상위 N개만 다음 단계로(목록 전체의 1개월 시세는 받습니다)\n"
          + "    미국 수집이 실패하면 snapshot.json·series.json·holdings.json 을 하나도 쓰지 않고 오류로 끝납니다.\n"
          + "  npm run backtest   (sync 후 .cache 의 시세로 오프라인 실행)\n  npm run derive-delisted -- <KRX 전종목 시세 CSV…>   (상장폐지 ETF 목록 생성)");
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
