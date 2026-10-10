import { describe, expect, it } from "vitest";
import type { EtfRecord, PriceSeries } from "../core/types";
import { universeAsOf, type Loaded } from "./bt-common";

/** 2023-01-02 부터 평일마다 하나씩, 완만하게 오르는 시세 */
function make(n: number): PriceSeries {
  const dates: string[] = [];
  const d = new Date(Date.UTC(2023, 0, 2));
  while (dates.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const close = dates.map((_, i) => 100 * Math.pow(1.0005, i) * (1 + 0.004 * Math.sin(i)));
  return { dates, close, volume: dates.map(() => 100_000) };
}

const rec = { code: "000001", name: "테스트" } as EtfRecord;

describe("universeAsOf", () => {
  const full = make(500);
  const lastDate = full.dates[full.dates.length - 1] as string;

  it("기준일이 속한 달에 거래가 있는 ETF 는 포함", () => {
    const loaded: Loaded[] = [{ rec, series: full, ended: false }];
    expect(universeAsOf(loaded, "20240531")).toHaveLength(1);
  });

  it("시세가 끝난(상장폐지) ETF 의 마지막 거래가 기준일보다 앞서면 그 기준일에는 제외한다", () => {
    // 마지막 거래일이 기준일(월말) 이전인 경우: 이후 관측이 없어 평가할 수 없다
    const cut = 400;
    const ended: Loaded = { rec, series: { dates: full.dates.slice(0, cut), close: full.close.slice(0, cut), volume: full.volume.slice(0, cut) }, ended: true };
    const lastTrade = ended.series.dates[cut - 1] as string;
    const monthEnd = `${lastTrade.slice(0, 6)}31`;
    expect(lastTrade < monthEnd).toBe(true); // 테스트 전제: 달의 마지막 날 이전에 끝남
    expect(universeAsOf([ended], monthEnd)).toHaveLength(0);
  });

  it("같은 ETF 도 마지막 거래 이전의 기준일에는 포함된다", () => {
    const cut = 400;
    const ended: Loaded = { rec, series: { dates: full.dates.slice(0, cut), close: full.close.slice(0, cut), volume: full.volume.slice(0, cut) }, ended: true };
    expect(universeAsOf([ended], "20240229")).toHaveLength(1);
  });

  it("마지막 거래가 기준일 당일이면 포함(그 날 종가로 평가 가능, 이후 관측은 시세가 이어지는 한 있음)", () => {
    const cut = 400;
    const ended: Loaded = { rec, series: { dates: full.dates.slice(0, cut), close: full.close.slice(0, cut), volume: full.volume.slice(0, cut) }, ended: true };
    const lastTrade = ended.series.dates[cut - 1] as string;
    expect(universeAsOf([ended], lastTrade)).toHaveLength(1);
  });

  it("종료 표시가 없는 현재 상장 ETF 는 마지막 거래가 기준일 전이어도 이 규칙으로 제외되지 않는다", () => {
    const loaded: Loaded[] = [{ rec, series: full, ended: false }];
    expect(universeAsOf(loaded, `${lastDate.slice(0, 6)}31`)).toHaveLength(1);
  });
});
