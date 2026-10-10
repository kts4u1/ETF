import { describe, expect, it } from "vitest";
import { cleanDescription, parsePriceXml, withRetry, HttpError } from "./naver";

describe("cleanDescription", () => {
  it("<br> 계열 태그를 공백으로", () => {
    expect(cleanDescription("가나다.<br><br>라마바.")).toBe("가나다. 라마바.");
    expect(cleanDescription("가<br />나<BR/>다")).toBe("가 나 다");
  });
  it("지수명의 꺾쇠는 보존", () => {
    expect(cleanDescription("기초지수는 <코스피 200 미국채 혼합지수>입니다.")).toBe("기초지수는 <코스피 200 미국채 혼합지수>입니다.");
  });
  it("공백 정리 및 멱등성", () => {
    const once = cleanDescription("  a \n\n b\t c  ");
    expect(once).toBe("a b c");
    expect(cleanDescription(once)).toBe(once);
  });
  it("길면 문장 경계에서 자른다", () => {
    const s = "첫 문장입니다. ".repeat(80);
    const out = cleanDescription(s, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("다.")).toBe(true);
  });
  it("문장 경계가 없으면 말줄임", () => {
    expect(cleanDescription("가".repeat(500), 100)).toMatch(/…$/);
  });
});

describe("parsePriceXml", () => {
  const xml = `<?xml version="1.0" encoding="EUC-KR" ?>
<protocol><chartdata symbol="069500" count="2">
  <item data="20260901|100|110|90|105|1000" />
  <item data="20260902|105|120|100|118|2000" />
</chartdata></protocol>`;
  it("날짜·종가·거래량을 파싱", () => {
    expect(parsePriceXml(xml)).toEqual({ dates: ["20260901", "20260902"], close: [105, 118], volume: [1000, 2000] });
  });
  it("데이터가 없으면 빈 시계열", () => {
    expect(parsePriceXml("<protocol></protocol>")).toEqual({ dates: [], close: [], volume: [] });
  });
});

describe("withRetry", () => {
  it("일시적 오류는 재시도해 성공", async () => {
    let n = 0;
    const r = await withRetry(async () => { if (++n < 3) throw new HttpError(503, "u"); return "ok"; }, 4, 1);
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });
  it("4xx 는 즉시 실패(재시도 안 함)", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new HttpError(404, "u"); }, 4, 1)).rejects.toThrow(/404/);
    expect(n).toBe(1);
  });
  it("429 는 재시도", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new HttpError(429, "u"); }, 3, 1)).rejects.toThrow(/429/);
    expect(n).toBe(3);
  });
});
