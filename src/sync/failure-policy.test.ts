import { describe, expect, it } from "vitest";
import { DOMESTIC_DETAIL_RULE, DOMESTIC_PRICE_RULE, US_STAGE_RULE, assertWithinLimit, failureLimit } from "./failure-policy";

describe("failureLimit: 후보의 비율과 최소 건수 중 큰 쪽", () => {
  it("작은 후보는 최소 건수, 큰 후보는 비율(내림)", () => {
    expect(failureLimit(0, 0.003, 2)).toBe(2);
    expect(failureLimit(20, 0.003, 2)).toBe(2);
    expect(failureLimit(666, 0.003, 2)).toBe(2); // 1.998 → 내림 1 → 최소 2
    expect(failureLimit(1000, 0.003, 2)).toBe(3);
    expect(failureLimit(1172, 0.003, 2)).toBe(3);
    expect(failureLimit(2704, 0.003, 2)).toBe(8);
    expect(failureLimit(5201, 0.003, 2)).toBe(15);
  });
});

describe("assertWithinLimit: 실제 규모에서의 경계", () => {
  const run = (rule: typeof US_STAGE_RULE, failures: number, total: number) => () => assertWithinLimit("테스트", failures, total, rule);
  it("국내 시세: 1,172개 중 3개까지 통과, 4개부터 중단", () => {
    expect(run(DOMESTIC_PRICE_RULE, 3, 1172)).not.toThrow();
    expect(run(DOMESTIC_PRICE_RULE, 4, 1172)).toThrow(/1172개 중 4개.*허용 3개/);
  });
  it("국내 상세: 1,172개 중 11개까지 통과, 12개부터 중단(작은 후보는 최소 5개)", () => {
    expect(run(DOMESTIC_DETAIL_RULE, 11, 1172)).not.toThrow();
    expect(run(DOMESTIC_DETAIL_RULE, 12, 1172)).toThrow();
    expect(run(DOMESTIC_DETAIL_RULE, 5, 100)).not.toThrow();
    expect(run(DOMESTIC_DETAIL_RULE, 6, 100)).toThrow();
  });
  it("해외 단계: 1차 15·2차 8·3차 4 까지 통과", () => {
    expect(run(US_STAGE_RULE, 15, 5201)).not.toThrow();
    expect(run(US_STAGE_RULE, 16, 5201)).toThrow();
    expect(run(US_STAGE_RULE, 8, 2704)).not.toThrow();
    expect(run(US_STAGE_RULE, 9, 2704)).toThrow();
    expect(run(US_STAGE_RULE, 4, 1589)).not.toThrow();
    expect(run(US_STAGE_RULE, 5, 1589)).toThrow();
  });
  it("메시지에 재실행 방법이 들어 있다", () => {
    expect(run(US_STAGE_RULE, 99, 100)).toThrow(/같은 날 다시 실행/);
  });
});
