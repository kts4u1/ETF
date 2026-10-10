import { describe, expect, it, vi } from "vitest";
import type { HoldingRow } from "../core/holdings";
import type { EtfRecord } from "../core/types";
import { buildHoldingsData } from "./build-holdings";

const row = (id: string, name: string, weight: number): HoldingRow => ({ id, code: id.slice(-6), name, weight });
const KR_ROWS: Record<string, HoldingRow[]> = {
  "069500": [row("KR7005930003", "삼성전자", 30), row("KR7000660001", "SK하이닉스", 20), row("KR7035420009", "NAVER", 50)],
  "360750": [row("KR7005930003", "삼성전자", 60), row("KR7035420009", "NAVER", 40)],
};

const etf = (code: string, market?: "US", tags: string[] = []): EtfRecord => ({ code, name: code, ...(market ? { market } : {}), tax: { tags } }) as unknown as EtfRecord;

describe("buildHoldingsData: 해외 상장 ETF 는 구성종목을 찾지 않는다", () => {
  const domestic = [etf("069500"), etf("360750")];
  const mixed = [...domestic, etf("SPY", "US"), etf("QQQ", "US")];
  const snapOf = (etfs: EtfRecord[]) => ({ asOf: "20261008", etfs });

  it("해외 ETF 는 unavailable 에 overseas-listed 로 기록되고 로더를 부르지 않는다", async () => {
    const load = vi.fn(async (code: string) => KR_ROWS[code] ?? null);
    const r = await buildHoldingsData(snapOf(mixed), load);
    expect(r.file.unavailable.SPY).toBe("overseas-listed");
    expect(r.file.unavailable.QQQ).toBe("overseas-listed");
    expect(r.file.etfs.SPY).toBeUndefined();
    expect(load.mock.calls.map((c) => c[0]).sort()).toEqual(["069500", "360750"]);
  });

  it("캐시에 구성종목이 있어 보여도 해외 ETF 는 겹침 계산에 끼지 않는다", async () => {
    const r = await buildHoldingsData(snapOf(mixed), async () => KR_ROWS["069500"] ?? null);
    expect(r.file.unavailable.SPY).toBe("overseas-listed");
    expect(Object.keys(r.file.etfs).sort()).toEqual(["069500", "360750"]);
  });

  it("국내 ETF 의 결과는 해외 ETF 가 섞여 있어도 같다", async () => {
    const load = async (code: string) => KR_ROWS[code] ?? null;
    const a = await buildHoldingsData(snapOf(domestic), load);
    const b = await buildHoldingsData(snapOf(mixed), load);
    expect(b.file.etfs).toEqual(a.file.etfs);
    expect(b.file.ids).toEqual(a.file.ids);
    expect(b.file.names).toEqual(a.file.names);
    expect(b.file.asOf).toBe(a.file.asOf);
    expect(b.available).toBe(a.available);
    expect(a.available).toBe(2);
    expect(a.file.unavailable).toEqual({});
  });

  it("국내 ETF 의 사용 불가 사유는 그대로(데이터 없음·파생 구조)이고 total 은 전체 ETF 수", async () => {
    const snap = snapOf([etf("069500"), etf("111111"), etf("222222", undefined, ["leveraged"]), etf("SPY", "US")]);
    const r = await buildHoldingsData(snap, async (code) => (code === "069500" || code === "222222" ? (KR_ROWS["069500"] ?? null) : null));
    expect(r.file.unavailable).toEqual({ "111111": "no-data", "222222": "derivative-structure", SPY: "overseas-listed" });
    expect(Object.keys(r.file.etfs)).toEqual(["069500"]);
    expect(r.available).toBe(1);
    expect(r.total).toBe(4);
  });
});
