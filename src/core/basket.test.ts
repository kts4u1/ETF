import { describe, expect, it } from "vitest";
import {
  BASKET_MAX,
  NOTE_MAX,
  addItems,
  basketHash,
  codesFromQuery,
  hasItem,
  parseCodeText,
  removeItem,
  resolveCodes,
  sanitizeItems,
  setNote,
  type BasketItem,
} from "./basket";

const item = (code: string, extra: Partial<BasketItem> = {}): BasketItem => ({ code, name: `${code} 이름`, addedAt: "2026-10-01", note: "", ...extra });

describe("sanitizeItems: 저장된 값 복원", () => {
  it("정상 값은 그대로, {items:[…]} 래퍼와 배열 모두 받는다", () => {
    const a = [item("069500"), item("SPY", { note: "분할 매수" })];
    expect(sanitizeItems(a)).toEqual(a);
    expect(sanitizeItems({ v: 1, items: a })).toEqual(a);
  });

  it("손상된 항목·잘못된 코드는 버리고 코드는 대문자로, 중복은 앞의 것만 남긴다", () => {
    const out = sanitizeItems([null, 3, "x", {}, { code: 5 }, { code: "bad code!" }, { code: "spy", name: "SPDR" }, { code: "SPY", name: "두번째" }, { code: "" }]);
    expect(out).toEqual([{ code: "SPY", name: "SPDR", addedAt: "", note: "" }]);
  });

  it("이름이 없으면 코드로, 날짜 형식이 틀리면 빈 값으로, 메모는 NOTE_MAX 자로 자른다", () => {
    const out = sanitizeItems([{ code: "QQQ", name: "  ", addedAt: "어제", note: "가".repeat(NOTE_MAX + 50) }]);
    expect(out[0]).toMatchObject({ name: "QQQ", addedAt: "" });
    expect(out[0]?.note).toHaveLength(NOTE_MAX);
  });

  it("점·하이픈이 든 티커(BRK.B)는 받아들이고, 너무 길거나 특수문자는 거른다", () => {
    expect(sanitizeItems([{ code: "brk.b" }, { code: "A-B" }, { code: "TOOLONGTICKER1" }, { code: "<script>" }]).map((i) => i.code)).toEqual(["BRK.B", "A-B"]);
  });

  it("손상된 JSON 전체(문자열·숫자·null·객체)는 빈 목록", () => {
    for (const bad of ["x", 5, null, undefined, {}, { items: "no" }]) expect(sanitizeItems(bad)).toEqual([]);
  });

  it(`최대 ${BASKET_MAX}개까지만`, () => {
    const many = Array.from({ length: BASKET_MAX + 20 }, (_, i) => ({ code: `E${i}` }));
    expect(sanitizeItems(many)).toHaveLength(BASKET_MAX);
  });
});

describe("담기·빼기·메모", () => {
  it("addItems: 새로 담고, 이미 있으면 건너뛰며, 코드는 대문자로 맞춘다", () => {
    const r1 = addItems([], [{ code: "069500", name: "KODEX 200" }, { code: "spy", name: "SPDR S&P 500" }], "2026-10-11");
    expect(r1).toMatchObject({ added: 2, existing: 0, full: 0 });
    expect(r1.items.map((i) => i.code)).toEqual(["069500", "SPY"]);
    expect(r1.items[0]).toEqual({ code: "069500", name: "KODEX 200", addedAt: "2026-10-11", note: "" });
    const r2 = addItems(r1.items, [{ code: "SPY", name: "다른 이름" }, { code: "QQQ", name: "Invesco QQQ" }], "2026-10-12");
    expect(r2).toMatchObject({ added: 1, existing: 1 });
    expect(r2.items.find((i) => i.code === "SPY")?.name).toBe("SPDR S&P 500"); // 기존 항목은 바뀌지 않는다
  });

  it("addItems: 변화가 없으면 같은 내용의 새 배열(원본 불변)", () => {
    const base = [item("SPY")];
    const r = addItems(base, [{ code: "SPY", name: "x" }], "2026-10-11");
    expect(r.added).toBe(0);
    expect(r.items).toEqual(base);
    expect(r.items).not.toBe(base);
  });

  it(`addItems: ${BASKET_MAX}개가 차면 더 못 담고 full 로 센다`, () => {
    const full = Array.from({ length: BASKET_MAX }, (_, i) => item(`E${i}`));
    const r = addItems(full, [{ code: "NEW1", name: "a" }, { code: "E3", name: "b" }, { code: "NEW2", name: "c" }], "2026-10-11");
    expect(r).toMatchObject({ added: 0, existing: 1, full: 2 });
    expect(r.items).toHaveLength(BASKET_MAX);
  });

  it("addItems: 자리가 남는 만큼만 담고 나머지는 full", () => {
    const base = Array.from({ length: BASKET_MAX - 1 }, (_, i) => item(`E${i}`));
    const r = addItems(base, [{ code: "A1", name: "a" }, { code: "A2", name: "b" }], "2026-10-11");
    expect(r).toMatchObject({ added: 1, full: 1 });
  });

  it("addItems: 날짜 형식이 틀리면 빈 값", () => {
    expect(addItems([], [{ code: "A", name: "a" }], "오늘").items[0]?.addedAt).toBe("");
  });

  it("removeItem·hasItem·setNote: 코드는 대소문자 무관", () => {
    const base = [item("SPY"), item("069500")];
    expect(hasItem(base, "spy")).toBe(true);
    expect(removeItem(base, "spy").map((i) => i.code)).toEqual(["069500"]);
    expect(removeItem(base, "NOPE")).toEqual(base);
    expect(setNote(base, "spy", "  목표가 5만원  ")[0]?.note).toBe("목표가 5만원");
    expect(setNote(base, "SPY", "가".repeat(999))[0]?.note).toHaveLength(NOTE_MAX);
    expect(setNote(base, "없음", "x")).toEqual(base);
  });
});

describe("parseCodeText: 붙여넣은 목록에서 코드 뽑기", () => {
  it("줄·쉼표·공백·세미콜론·탭으로 나눈 코드 목록(대소문자 무관, 중복은 한 번)", () => {
    expect(parseCodeText("069500\nspy, QQQ;  VTI\tspy\n")).toEqual(["069500", "SPY", "QQQ", "VTI"]);
    expect(parseCodeText("069500, SPY, QQQ")).toEqual(["069500", "SPY", "QQQ"]); // 쉼표로만 나열한 한 줄도 모두
  });

  it("이 앱이 내보낸 요약 글을 다시 읽는다: 이름 뒤 마지막 괄호의 코드만, 메모·제목 줄은 무시", () => {
    const text = [
      "[ETF 장바구니] 3개 · 2026-10-08 기준 종가(실시간 시세 아님)",
      "1. TIGER 미국S&P500(H) (360750)",
      "   ↳ 국내 · 20,000원 · 1년 +12.0%",
      "   ↳ 메모: BUY at 50, SPY 말고",
      "2. SPDR S&P 500 ETF Trust (SPY)",
      "   ↳ 미국 · $543.20 (≈ 76만원) · 1년 +20.0%",
      "3. KODEX 200 (069500)",
      "※ 해외(미국) ETF 의 순자산은 원화 환산값입니다.",
      "* Past data does not guarantee future returns, BUY SPY",
    ].join("\n");
    expect(parseCodeText(text)).toEqual(["360750", "SPY", "069500"]);
  });

  it("CSV 를 다시 읽는다: 헤더·BOM 은 건너뛰고 행의 첫 칸이 코드", () => {
    const csv = "﻿code,name,market,price_krw\r\n069500,\"KODEX 200, 대표\",KR,35000\r\nSPY,SPDR,US,760000\r\n";
    expect(parseCodeText(csv)).toEqual(["069500", "SPY"]);
  });

  it("헤더가 없는 CSV 행이나 스프레드시트(탭) 행: 탭으로 나뉜 행은 첫 칸만", () => {
    expect(parseCodeText("069500\tKODEX 200\tKR\n360750\tTIGER 미국S&P500(H)\tKR")).toEqual(["069500", "360750"]);
    expect(parseCodeText("069500\t360750\tSPY")).toEqual(["069500", "360750", "SPY"]); // 탭으로 코드만 나열하면 모두
  });

  it("$ 표시·따옴표가 붙은 티커, # 주석", () => {
    expect(parseCodeText('# 내 목록\n$SPY "QQQ"')).toEqual(["SPY", "QQQ"]);
  });

  it("코드로 볼 수 없는 조각(한글 이름, 특수문자)은 무시한다", () => {
    expect(parseCodeText("삼성 반도체 ★ SOXX")).toEqual(["SOXX"]);
    expect(parseCodeText("")).toEqual([]);
  });

  it("증권사 목록의 '이름 + 코드' 줄: 이름 끝의 (H) 같은 괄호가 아니라 6자리 코드를 읽는다", () => {
    expect(parseCodeText("453850 ACE 미국30년국채액티브(H) 35,000 +0.5%")).toEqual(["453850"]);
    expect(parseCodeText("ACE 미국30년국채액티브(H) 453850")).toEqual(["453850"]);
    expect(parseCodeText("KODEX 미국나스닥100(USD) 379810")).toEqual(["379810"]);
    expect(parseCodeText("0219E0 KODEX 어떤 ETF(합성)")).toEqual(["0219E0"]);
    expect(parseCodeText("1. KODEX 200 (069500)\n2) TIGER 미국S&P500(H) (360750)")).toEqual(["069500", "360750"]);
  });

  it("영어 이름이 섞인 줄: 소문자·일반 단어(Bond, Year)는 티커로 보지 않고, 대문자 티커와 괄호의 티커만", () => {
    const t = parseCodeText("SCHZ Schwab US Aggregate Bond ETF 22.5 -0.1%");
    expect(t).toContain("SCHZ");
    expect(t).not.toContain("BOND");
    expect(t).not.toContain("AGGREGATE");
    expect(t).not.toContain("22.5");
    expect(parseCodeText("Vanguard Total World Stock (VT) 120.5")).toEqual(["VT"]);
    expect(parseCodeText("Pimco Active Bond ETF 100 shares")).toEqual([]); // ETF 같은 대문자 일반어도 티커로 보지 않는다
  });

  it("숫자만 있는 조각은 6자리일 때만 코드로 본다(가격·거래량·수량 제외)", () => {
    expect(parseCodeText("069500 35000 1234567 12")).toEqual(["069500"]);
    expect(parseCodeText("SPY 543 QQQ")).toEqual(["SPY", "QQQ"]);
  });

  it("엑셀을 거친 CSV(=\"069500\" 표기)와 이 앱 CSV 의 코드 열을 읽는다", () => {
    expect(parseCodeText('code,name,market\r\n="069500",KODEX 200,KR\r\n="0219E0","어떤 ETF",KR\r\nSPY,SPDR,US')).toEqual(["069500", "0219E0", "SPY"]);
  });

  it("†·※·* 안내 줄은 건너뛴다(내보낸 글 끝의 설명이 코드로 읽히지 않게)", () => {
    expect(parseCodeText("SPY\n† Fund-level net assets: includes other share classes\n* Past data does not guarantee\n※ 안내")).toEqual(["SPY"]);
  });

  it("개행이 \\r 단독이거나 섞여 있어도 줄로 나눈다", () => {
    expect(parseCodeText("069500\rSPY\r\nQQQ\nVTI")).toEqual(["069500", "SPY", "QQQ", "VTI"]);
  });

  it("후보가 아주 많아도(2,000개 상한) 정상 코드 500개는 모두 읽는다 — 이름 속 단어가 자리를 차지해도 뒤쪽이 잘리지 않게", () => {
    const text = Array.from({ length: 500 }, (_, i) => `E${i} ETF`).join("\n");
    expect(parseCodeText(text).length).toBeGreaterThanOrEqual(500);
    const huge = Array.from({ length: BASKET_MAX * 30 }, (_, i) => `E${i}`).join("\n");
    expect(parseCodeText(huge).length).toBeLessThanOrEqual(BASKET_MAX * 20 + 1);
  });

  it("퍼징: 임의 문자열에서 예외 없이 코드 모양의 값만 돌려준다", () => {
    const alphabet = "AB09 ,;|\t\r\n()=\"'$#[]*†↳.-가힣 ★😀/\\&%+";
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 500; i++) {
      const text = Array.from({ length: Math.floor(rnd() * 120) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
      const out = parseCodeText(text);
      for (const c of out) expect(c).toMatch(/^[A-Z0-9][A-Z0-9.-]{0,11}$/);
      expect(new Set(out).size).toBe(out.length);
    }
    expect(parseCodeText("__proto__ constructor toString")).toEqual([]);
  });
});

describe("resolveCodes / 링크", () => {
  const db = new Map([["069500", { code: "069500" }], ["SPY", { code: "SPY" }]]);
  const lookup = (c: string) => db.get(c);

  it("찾은 것과 못 찾은 것을 나누고, 중복·대소문자를 정리한다", () => {
    const r = resolveCodes(["spy", "069500", "SPY", "NOPE", "nope2"], lookup);
    expect(r.found.map((e) => e.code)).toEqual(["SPY", "069500"]);
    expect(r.unknown).toEqual(["NOPE", "NOPE2"]);
  });

  it("basketHash ⇄ codesFromQuery 왕복", () => {
    const h = basketHash(["069500", "SPY", "BRK.B"]);
    expect(h).toBe("#/basket?codes=069500,SPY,BRK.B");
    const q = new URLSearchParams(h.split("?")[1]);
    expect(codesFromQuery(q.get("codes"))).toEqual(["069500", "SPY", "BRK.B"]);
    expect(codesFromQuery(null)).toEqual([]);
    expect(codesFromQuery("")).toEqual([]);
  });
});
