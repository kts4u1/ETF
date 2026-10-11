// 데이터 제공처(네이버·나스닥·야후) 접속 사전 점검. 실패하면 PROBE_BLOCKED=<제공처…> 를 출력하고 종료 코드 1.
// 환경변수: PROBE_TRIES(기본 3), PROBE_SLEEP_SEC(기본 20)
import { fetchNasdaqList } from "../src/sync/us";
import { fetchEtfList, fetchPrices } from "../src/sync/naver";
import { runProbe, type ProbeCheck } from "../src/sync/probe";
import { YahooClient } from "../src/sync/yahoo";

const yahoo = new YahooClient({ retry: { attempts: 2, baseMs: 800 }, timeoutMs: 20_000 });
const nowSec = Math.floor(Date.now() / 1000);

const checks: ProbeCheck[] = [
  {
    source: "네이버",
    name: "국내 ETF 목록",
    run: async () => `${(await fetchEtfList()).length}개`,
  },
  {
    source: "네이버",
    name: "일별 시세(069500)",
    run: async () => {
      const p = await fetchPrices("069500", 30);
      if (p.dates.length < 5) throw new Error(`시세 ${p.dates.length}행`);
      return `${p.dates.length}행, 최근 ${p.dates[p.dates.length - 1]}`;
    },
  },
  {
    source: "나스닥",
    name: "미국 ETF 목록",
    run: async () => `${(await fetchNasdaqList(undefined, { attempts: 2 })).rows.length}행`,
  },
  {
    source: "야후",
    name: "SPY 일별 시세",
    run: async () => {
      const c = await yahoo.fetchChart("SPY", nowSec - 14 * 86_400, nowSec);
      if (c.dates.length < 3) throw new Error(`시세 ${c.dates.length}행`);
      return `${c.dates.length}행, 최근 ${c.dates[c.dates.length - 1]}`;
    },
  },
  {
    source: "야후",
    name: "SPY 펀드 정보(쿠키·crumb 세션)",
    run: async () => {
      const f = await yahoo.fetchFundInfo("SPY");
      return `순자산 ${f.totalAssets ?? "없음"}`;
    },
  },
  {
    source: "야후",
    name: "환율 KRW=X",
    run: async () => {
      const c = await yahoo.fetchChart("KRW=X", nowSec - 14 * 86_400, nowSec, { requireAdjClose: false, tzIndependentDate: true });
      if (c.dates.length < 3) throw new Error(`환율 ${c.dates.length}행`);
      return `${c.dates.length}행, 최근 ${c.dates[c.dates.length - 1]} ${c.close[c.close.length - 1]}`;
    },
  },
];

const r = await runProbe(checks, {
  tries: Number(process.env.PROBE_TRIES ?? 3),
  sleepMs: Number(process.env.PROBE_SLEEP_SEC ?? 20) * 1000,
  log: (m) => console.log(m),
});
if (!r.ok) {
  console.log(`PROBE_BLOCKED=${r.blocked.join(",")}`);
  process.exit(1);
}
console.log("PROBE_OK");
