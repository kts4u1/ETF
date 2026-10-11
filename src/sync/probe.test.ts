import { describe, expect, it } from "vitest";
import { runProbe, type ProbeCheck } from "./probe";

const noSleep = async () => {};

describe("runProbe: 제공처 접속 사전 점검", () => {
  it("모두 성공하면 ok", async () => {
    const checks: ProbeCheck[] = [
      { source: "네이버", name: "목록", run: async () => "1172개" },
      { source: "야후", name: "SPY", run: async () => {} },
    ];
    const r = await runProbe(checks, { sleep: noSleep });
    expect(r.ok).toBe(true);
    expect(r.blocked).toEqual([]);
    expect(r.results.map((x) => x.detail)).toEqual(["1172개", ""]);
  });

  it("일시적 실패는 다시 시도해 통과하고, 몇 번째 시도였는지 남긴다", async () => {
    let n = 0;
    const logs: string[] = [];
    const r = await runProbe([{ source: "야후", name: "SPY", run: async () => { if (++n < 3) throw new Error("HTTP 429"); return "ok"; } }], { tries: 3, sleep: noSleep, log: (m) => logs.push(m) });
    expect(r.ok).toBe(true);
    expect(r.results[0]?.tries).toBe(3);
    expect(logs[0]).toContain("3번째 시도");
  });

  it("끝까지 실패한 제공처는 중복 없이 blocked 에 담고, 마지막 오류를 보여 준다", async () => {
    const sleeps: number[] = [];
    const r = await runProbe(
      [
        { source: "야후", name: "SPY", run: async () => { throw new Error("HTTP 429: chart"); } },
        { source: "야후", name: "환율", run: async () => { throw new Error("HTTP 429: fx"); } },
        { source: "네이버", name: "목록", run: async () => "ok" },
      ],
      { tries: 2, sleepMs: 7, sleep: async (ms) => { sleeps.push(ms); } },
    );
    expect(r.ok).toBe(false);
    expect(r.blocked).toEqual(["야후"]);
    expect(r.results[0]).toMatchObject({ ok: false, detail: "HTTP 429: chart", tries: 2 });
    expect(sleeps).toEqual([7, 7]); // 점검마다 시도 사이에만 대기(마지막 시도 뒤에는 대기 없음)
  });

  it("tries 가 0 이하여도 한 번은 시도한다", async () => {
    const r = await runProbe([{ source: "a", name: "b", run: async () => "ok" }], { tries: 0, sleep: noSleep });
    expect(r.ok).toBe(true);
  });
});
