import { backtestToFile } from "./backtest";
import { syncAll } from "./build-snapshot";

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
    default:
      console.log("사용법:\n  npm run sync [-- --force] [-- --limit N] [-- --concurrency N]\n  npm run backtest   (sync 후 .cache 의 시세로 오프라인 실행)");
      process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
