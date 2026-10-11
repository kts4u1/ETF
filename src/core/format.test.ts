import { describe, expect, it } from "vitest";
import {
  feeWonPer10M,
  fmtAsOf,
  fmtEok,
  fmtFee,
  fmtFxRate,
  fmtHistory,
  fmtPriceLine,
  fmtRatio,
  fmtSnapshotList,
  fmtSurvivorshipGap,
  fmtUsd,
  fmtWon,
  fmtWonShort,
  priceParts,
} from "./format";

describe("fmtFee", () => {
  it("초저보수는 자릿수를 늘려 구분 가능하게", () => {
    expect(fmtFee(0.0046)).toBe("0.0046%");
    expect(fmtFee(0.0099)).toBe("0.0099%");
    expect(fmtFee(0.05)).toBe("0.05%");
    expect(fmtFee(0.15)).toBe("0.15%");
    expect(fmtFee(0.45)).toBe("0.45%");
    expect(fmtFee(null)).toBe("-");
  });
});

describe("feeWonPer10M", () => {
  it("1,000만원 보유 시 연 보수(원)", () => {
    expect(feeWonPer10M(0.15)).toBe(15_000);
    expect(feeWonPer10M(0.03)).toBe(3_000);
    expect(feeWonPer10M(1)).toBe(100_000);
    expect(feeWonPer10M(0.0046)).toBe(460);
  });
});

describe("fmtWon / fmtEok", () => {
  it("단위와 천 단위 구분", () => {
    expect(fmtWon(2.6e12)).toBe("2.6조");
    expect(fmtWon(1.098e11)).toBe("1,098억");
    expect(fmtWon(1.1e10)).toBe("110억");
    expect(fmtWon(9.202e11)).toBe("9,202억");
    expect(fmtWon(3.2e8)).toBe("3.2억");
    expect(fmtWon(5.2e7)).toBe("5,200만");
    expect(fmtWon(null)).toBe("-");
    expect(fmtEok(244_791)).toBe("24.5조");
    expect(fmtEok(8_386)).toBe("8,386억");
  });
});

describe("fmtRatio", () => {
  it("부호·자릿수", () => {
    expect(fmtRatio(0.1234, 1, true)).toBe("+12.3%");
    expect(fmtRatio(-0.05, 0)).toBe("-5%");
    expect(fmtRatio(null)).toBe("-");
  });
});

describe("fmtHistory", () => {
  it("수집 한도에 닿으면 '8년 이상'", () => {
    expect(fmtHistory(7.94, 2000)).toBe("8년 이상");
    expect(fmtHistory(2.4, 600)).toBe("2.4년");
    expect(fmtHistory(0.3, 75)).toBe("4개월");
  });
});

describe("fmtSurvivorshipGap", () => {
  it("기준일이 없으면 빈 문자열", () => {
    expect(fmtSurvivorshipGap([])).toBe("");
  });
  it("기준일 1개: 그 날짜 이전 폐지분과 그 이후 신규 상장 후 폐지분이 빠진다고 설명", () => {
    const t = fmtSurvivorshipGap(["20260410"]);
    expect(t).toContain("2026-04-10 이전에 상장폐지된 ETF");
    expect(t).toContain("2026-04-10 이후에 새로 상장했다가 현재 이전에 폐지된 ETF");
  });
  it("기준일 여러 개: 가장 이른 날짜만 앞에 쓰고 '기준일들 사이' 공백을 설명", () => {
    const t = fmtSurvivorshipGap(["20251230", "20260410"]);
    expect(t).toContain("2025-12-30 이전에 상장폐지된 ETF");
    expect(t).toContain("기준일들 사이");
    expect(t).not.toContain("2026-04-10");
  });
});

describe("fmtSnapshotList", () => {
  it("3개 이하면 날짜를 모두, 많으면 개수와 범위만", () => {
    expect(fmtSnapshotList(["20260410"])).toBe("2026-04-10");
    expect(fmtSnapshotList(["20251010", "20260410"])).toBe("2025-10-10·2026-04-10");
    expect(fmtSnapshotList(["20230410", "20231010", "20240411"])).toBe("2023-04-10·2023-10-10·2024-04-11");
    expect(fmtSnapshotList(["20201230", "20210630", "20211230", "20220630"])).toBe("4개(2020-12-30~2022-06-30)");
  });
  it("빈 목록은 빈 문자열", () => {
    expect(fmtSnapshotList([])).toBe("");
  });
});

describe("fmtUsd / fmtWonShort", () => {
  it("달러는 소수 둘째 자리와 천 단위 구분", () => {
    expect(fmtUsd(543.2)).toBe("$543.20");
    expect(fmtUsd(1234.5)).toBe("$1,234.50");
    expect(fmtUsd(null)).toBe("-");
    expect(fmtUsd(Number.NaN)).toBe("-");
  });
  it("원화 보조 표기는 만원 단위로 줄이고 경계에서 단위를 바꾼다", () => {
    expect(fmtWonShort(7_600)).toBe("7,600원");
    expect(fmtWonShort(9_999.4)).toBe("9,999원");
    expect(fmtWonShort(76_000)).toBe("7.6만원");
    expect(fmtWonShort(760_480)).toBe("76만원");
    expect(fmtWonShort(1_503_000)).toBe("150만원");
    expect(fmtWonShort(12_345_678)).toBe("1,235만원");
    expect(fmtWonShort(150_000_000)).toBe("1.5억원");
    expect(fmtWonShort(null)).toBe("-");
  });
});

describe("priceParts / fmtPriceLine", () => {
  it("국내 상장은 원화 가격만", () => {
    expect(priceParts({ price: 9_800 })).toEqual({ main: "9,800원", sub: null });
    expect(fmtPriceLine({ price: 35_550 })).toBe("35,550원");
  });
  it("해외 상장은 달러 가격 + 원화 환산값", () => {
    const e = { market: "US" as const, price: 760_480, priceNative: 543.2 };
    expect(priceParts(e)).toEqual({ main: "$543.20", sub: "≈ 76만원" });
    expect(fmtPriceLine(e)).toBe("$543.20 (≈ 76만원)");
  });
  it("현지 가격이 없는 해외 레코드는 원화 가격으로 되돌아간다", () => {
    expect(fmtPriceLine({ market: "US", price: 76_000, priceNative: null })).toBe("76,000원");
    expect(fmtPriceLine({ market: "US", price: 76_000 })).toBe("76,000원");
  });
  it("국내 레코드에 priceNative 가 있어도 달러로 표기하지 않는다", () => {
    expect(fmtPriceLine({ market: "KR", price: 76_000, priceNative: 55 })).toBe("76,000원");
  });
});

describe("fmtAsOf", () => {
  it("해외 데이터가 없으면 예전 문구 그대로", () => {
    expect(fmtAsOf({ asOf: "20261008" })).toBe("시세 기준일 2026-10-08");
  });
  it("국내·해외 기준일과 환율을 따로 적고, 다르면 다르다고 밝힌다", () => {
    const t = fmtAsOf({ asOf: "20261008", asOfUs: "20261007", fxUsdKrw: { rate: 1380.5, date: "20261007" } });
    expect(t).toBe("국내 시세 기준일 2026-10-08 · 해외(미국) 시세 기준일 2026-10-07(국내와 다름) · 원/달러 환율 1,380.50원(2026-10-07)");
  });
  it("기준일이 같으면 '다름' 표시를 하지 않고, 환율이 없으면 생략한다", () => {
    const t = fmtAsOf({ asOf: "20261008", asOfUs: "20261008" });
    expect(t).toBe("국내 시세 기준일 2026-10-08 · 해외(미국) 시세 기준일 2026-10-08");
    expect(fmtFxRate(1400)).toBe("1,400.00원");
  });
});
