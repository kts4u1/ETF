import { describe, expect, it } from "vitest";
import { countComboSig, fmtCI, isSig, isSigDrop, isSigRet } from "./significance";

describe("significance: 구간이 없는(null) 칸을 유의하다고 세지 않는다", () => {
  it("isSig: 구간이 0 을 벗어날 때만, null·NaN 은 유의하지 않다", () => {
    expect(isSig({ indepMean: 0.05, indepCI: 0.03 })).toBe(true);
    expect(isSig({ indepMean: 0.05, indepCI: 0.05 })).toBe(false); // 경계: 0 을 포함
    expect(isSig({ indepMean: -0.05, indepCI: 0.01 })).toBe(false); // 양의 방향만 센다
    expect(isSig({ indepMean: 0.05, indepCI: null })).toBe(false); // null 을 0 으로 읽어 유의로 세던 버그
    expect(isSig({ indepMean: 0.05, indepCI: NaN })).toBe(false);
  });
  it("isSigDrop / isSigRet", () => {
    expect(isSigDrop({ dMdd: 0.03, dMddCI: 0.02 })).toBe(true);
    expect(isSigDrop({ dMdd: -0.03, dMddCI: 0.02 })).toBe(false); // 낙폭이 더 큰 쪽은 '개선'이 아니다
    expect(isSigDrop({ dMdd: 0.03, dMddCI: null })).toBe(false);
    expect(isSigRet({ dRet: -0.04, dRetCI: 0.02 })).toBe(true); // 수익 차이는 방향 무관
    expect(isSigRet({ dRet: 0.04, dRetCI: null })).toBe(false);
  });
  it("fmtCI: 없으면 '–', 있으면 %p 한 자리", () => {
    expect(fmtCI(null)).toBe("–");
    expect(fmtCI(NaN)).toBe("–");
    expect(fmtCI(0.0316)).toBe("3.2");
    expect(fmtCI(0)).toBe("0.0"); // 구간이 정말 0 인 것과 구간이 없는 것을 구별한다
  });
});

describe("countComboSig: 조합 주력 전략 칸 집계", () => {
  const cells = [
    { dMdd: 0.03, dMddCI: 0.01, dRet: -0.01, dRetCI: 0.05 }, // 낙폭 개선 유의, 수익 비유의
    { dMdd: 0.02, dMddCI: 0.05, dRet: 0.08, dRetCI: 0.02 }, // 낙폭 개선 비유의(그래도 작음), 수익 차이 유의
    { dMdd: -0.01, dMddCI: 0.005, dRet: 0.0, dRetCI: null }, // 낙폭이 더 큼, 수익 구간 없음
    { dMdd: 0.04, dMddCI: null, dRet: -0.09, dRetCI: 0.03 }, // 구간 없음 → 낙폭 유의로 세지 않음, 수익 차이 유의(음수)
  ];
  it("세 값을 서로 섞지 않고 센다(낙폭 칸에 수익 판정을 쓰는 실수 방지)", () => {
    expect(countComboSig(cells)).toEqual({ lowerMdd: 3, sigMdd: 1, sigRet: 2 });
  });
});
