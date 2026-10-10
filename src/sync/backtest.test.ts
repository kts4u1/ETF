import { describe, expect, it } from "vitest";
import { survivorshipText } from "./backtest";

describe("survivorshipText: 리포트의 생존편향 문구", () => {
  it("상장폐지 ETF가 있고 KRX 기준일을 알면 '부분 보정'과 놓치는 범위를 밝힌다", () => {
    const t = survivorshipText({ delistedIncluded: 21, delistedSkipped: 0, delistedSnapshots: ["20260410"] });
    expect(t.bullet).toContain("상장폐지 ETF 21개 포함");
    expect(t.bullet).toContain("KRX 전종목 시세 2026-04-10 기준");
    expect(t.bullet).toContain("부분 보정입니다");
    expect(t.bullet).toContain("2026-04-10 이전에 상장폐지된 ETF");
    expect(t.bullet).not.toContain("시세를 읽지 못해");
    expect(t.caution).toContain("일부만 포함");
    expect(t.caution).not.toContain("현재 상장 ETF만");
  });
  it("기준일 메타가 없으면 범위를 지어내지 않고 '목록에 없는 ETF는 빠져 있다'고만 쓴다", () => {
    const t = survivorshipText({ delistedIncluded: 3, delistedSkipped: 0, delistedSnapshots: [] });
    expect(t.bullet).toContain("상장폐지 ETF 3개 포함");
    expect(t.bullet).toContain("목록에 없는 상장폐지 ETF는 여전히 빠져 있습니다");
    expect(t.bullet).not.toContain("부분 보정");
  });
  it("상장폐지 ETF가 없으면 미보정이라고 쓰고 '현재 상장 ETF만 포함'", () => {
    const t = survivorshipText({ delistedIncluded: 0, delistedSkipped: 0, delistedSnapshots: [] });
    expect(t.bullet).toContain("생존편향 미보정");
    expect(t.caution).toBe("생존편향(현재 상장 ETF만 포함)");
  });
  it("목록은 있는데 시세를 못 읽어 일부 또는 전부 빠졌으면 그 사실을 보고서에 남긴다", () => {
    const some = survivorshipText({ delistedIncluded: 18, delistedSkipped: 3, delistedSnapshots: ["20260410"] });
    expect(some.bullet).toContain("21개 중 3개는 시세를 읽지 못해 제외");
    const all = survivorshipText({ delistedIncluded: 0, delistedSkipped: 21, delistedSnapshots: ["20260410"] });
    expect(all.bullet).toContain("생존편향 미보정");
    expect(all.bullet).toContain("21개 중 21개는 시세를 읽지 못해 제외");
  });
});
