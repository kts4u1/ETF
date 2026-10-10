import { backtestToFile } from "./backtest";
import { syncAll } from "./build-snapshot";
import { deriveDelisted } from "./derive-delisted";

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function main() {
  switch (cmd) {
    case "sync": {
      const limit = value("limit");
      const { failed } = await syncAll({
        force: flag("force"),
        limit: limit ? Number(limit) : undefined,
        concurrency: value("concurrency") ? Number(value("concurrency")) : undefined,
        skipHoldings: flag("skip-holdings"),
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
      const date = value("date");
      const paths = rest.filter((a, i) => !a.startsWith("--") && rest[i - 1] !== "--date");
      if (paths.length === 0) {
        console.log("KRX 'ETF 전종목 시세' CSV 경로를 하나 이상 지정하세요.");
        process.exitCode = 1;
        break;
      }
      const r = await deriveDelisted(paths.map((path) => ({ path, date: paths.length === 1 ? date : undefined })), (m) => console.log(m));
      for (const f of r.files) console.log(`${f.verdict === "ok" ? "✓" : "✗"} ${f.path.split("/").pop()} — ${f.date ?? "날짜 불명"}, ${f.rows}행: ${f.note}`);
      console.log(`\n후보 ${r.candidates}개 → 상장폐지 ${r.delisted.length}개, 거래 중 ${r.stillTrading.length}개(제외), 시세 없음 ${r.noPrices.length}개(제외)`);
      for (const d of r.delisted) console.log(`  폐지 ${d.code} ${d.name} (시세 마지막일 ${d.delistedOn})`);
      for (const d of r.stillTrading) console.log(`  거래 중(제외) ${d.code} ${d.name} (마지막 ${d.lastDate})`);
      for (const d of r.noPrices) console.log(`  시세 없음(제외) ${d.code} ${d.name}`);
      if (r.files.some((f) => f.verdict === "rejected")) process.exitCode = 2;
      break;
    }
    default:
      console.log("사용법:\n  npm run sync [-- --force] [-- --limit N] [-- --concurrency N] [-- --skip-holdings]\n  npm run backtest   (sync 후 .cache 의 시세로 오프라인 실행)\n  npm run derive-delisted -- <KRX 전종목 시세 CSV…>   (상장폐지 ETF 목록 생성)");
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
