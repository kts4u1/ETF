/**
 * 데이터 제공처 접속 사전 점검. 전체 수집(약 9,500회 호출, 몇 분~)을 시작하기 전에 제공처마다 가벼운 요청 몇 개를 보내,
 * GitHub 러너 같은 새 환경에서 네이버·야후·나스닥이 막혀 있으면 수 초 안에 이유와 함께 끝낸다(막힌 채 60분 제한까지 돌지 않도록).
 * 일시적 오류에 속지 않도록 점검마다 tries 번 시도한다.
 */
export interface ProbeCheck {
  /** 제공처 이름(결과 요약에 쓴다) */
  source: string;
  /** 점검 이름 */
  name: string;
  run: () => Promise<string | void>;
}

export interface ProbeResult {
  source: string;
  name: string;
  ok: boolean;
  /** 성공 시 짧은 설명, 실패 시 마지막 오류 */
  detail: string;
  tries: number;
}

export interface ProbeOptions {
  tries?: number;
  sleepMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runProbe(checks: ProbeCheck[], opts: ProbeOptions = {}): Promise<{ ok: boolean; blocked: string[]; results: ProbeResult[] }> {
  const tries = Math.max(1, opts.tries ?? 3);
  const sleepMs = opts.sleepMs ?? 20_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  const results: ProbeResult[] = [];
  for (const c of checks) {
    let detail = "";
    let ok = false;
    let n = 0;
    while (n < tries && !ok) {
      n++;
      try {
        detail = (await c.run()) ?? "";
        ok = true;
      } catch (e) {
        detail = msg(e);
        if (n < tries) await sleep(sleepMs);
      }
    }
    results.push({ source: c.source, name: c.name, ok, detail, tries: n });
    log(`${ok ? "✓" : "✗"} ${c.source} / ${c.name}${n > 1 ? ` (${n}번째 시도)` : ""}: ${detail}`);
  }
  const blocked = [...new Set(results.filter((r) => !r.ok).map((r) => r.source))];
  return { ok: blocked.length === 0, blocked, results };
}
