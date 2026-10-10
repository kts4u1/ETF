import { classify } from "./taxonomy";
import type { EtfRecord, Metrics } from "./types";

/** 테스트용 ETF 레코드 생성기. 기본값은 모든 게이트를 통과하는 평범한 국내 주식 ETF. */
export function makeEtf(over: Omit<Partial<EtfRecord>, "m"> & { m?: Partial<Metrics> } = {}): EtfRecord {
  const name = over.name ?? "KODEX 테스트";
  const baseM: Metrics = {
    asOf: "20261008",
    days: 1500,
    firstDate: "20200101",
    years: 6,
    ret: { m1: 0.01, m3: 0.03, m6: 0.06, y1: 0.12, y3: 0.4, y5: 0.8 },
    cagr1y: 0.12,
    cagr3y: 0.12,
    cagr5y: 0.12,
    vol1y: 0.2,
    vol3y: 0.2,
    mdd1y: -0.15,
    mdd3y: -0.25,
    mddAll: -0.3,
    drawdown: -0.05,
    sharpe1y: 0.45,
    sharpe3y: 0.45,
    mom12_1: 0.1,
    trend200: 0.05,
    avgValue20: 2e9,
  };
  return {
    code: over.code ?? name.replace(/\s/g, ""),
    name,
    issuer: "테스트운용",
    price: 10000,
    changeRate: 0,
    aumEok: 5000,
    fee: 0.2,
    divYield: 1,
    navGap: 0,
    description: "",
    tax: classify(name, 2),
    ...over,
    m: { ...baseM, ...(over.m ?? {}) },
  };
}
