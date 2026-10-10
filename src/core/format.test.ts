import { describe, expect, it } from "vitest";
import { feeWonPer10M, fmtEok, fmtFee, fmtHistory, fmtRatio, fmtWon } from "./format";

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
