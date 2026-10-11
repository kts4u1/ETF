import { describe, expect, it } from "vitest";
import { DEFAULT_STALE_DAYS, decideRefresh, type IndexLike, type SnapLike } from "./refresh-decision";

const kr = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ code: String(100000 + from + i) }));
const us = (syms: string[]) => syms.map((code) => ({ code, market: "US" }));
const tickers = (n: number, prefix = "T", from = 0) => Array.from({ length: n }, (_, i) => `${prefix}${from + i}`);
const snap = (asOf: string, asOfUs: string, krN: number, usSyms: string[], krFrom = 0): SnapLike => ({ asOf, asOfUs, etfs: [...kr(krN, krFrom), ...us(usSyms)] });
const idx = (syms: string[]): IndexLike => ({ etfs: syms.map((s) => [s, `${s} fund`, "low-trading"]) });

// 기준 상태: 국내 1,000개, 해외 수집 200개 + 색인 800개
const COLLECTED = tickers(200, "C");
const INDEXED = tickers(800, "X");
const WAS = snap("20261002", "20261002", 1000, COLLECTED);
const WAS_IDX = idx(INDEXED);

describe("decideRefresh: 커밋할지 판정", () => {
  it("이전 스냅샷이 없으면 changed", () => {
    expect(decideRefresh(null, WAS, null, WAS_IDX).result).toBe("changed");
  });

  it("구성이 같고 기준일이 며칠밖에 안 지났으면 unchanged — 시세 끝자리·생성 시각이 달라도 무관", () => {
    const d = decideRefresh(WAS, snap("20261006", "20261005", 1000, COLLECTED), WAS_IDX, WAS_IDX);
    expect(d.result).toBe("unchanged");
    expect(d.reasons[0]).toContain(`${DEFAULT_STALE_DAYS}일 미만`);
  });

  it("마지막 커밋보다 5일 이상 새로우면 changed(국내·해외 각각)", () => {
    expect(decideRefresh(WAS, snap("20261007", "20261002", 1000, COLLECTED), WAS_IDX, WAS_IDX).reasons.join()).toContain("국내 기준일 20261002 → 20261007(5일)");
    expect(decideRefresh(WAS, snap("20261002", "20261007", 1000, COLLECTED), WAS_IDX, WAS_IDX).reasons.join()).toContain("해외 기준일 20261002 → 20261007(5일)");
    expect(decideRefresh(WAS, snap("20261006", "20261006", 1000, COLLECTED), WAS_IDX, WAS_IDX).result).toBe("unchanged"); // 4일
  });

  it("staleDays=1 이면 거래일마다 changed", () => {
    expect(decideRefresh(WAS, snap("20261005", "20261002", 1000, COLLECTED), WAS_IDX, WAS_IDX, { staleDays: 1 }).result).toBe("changed");
    expect(decideRefresh(WAS, WAS, WAS_IDX, WAS_IDX, { staleDays: 1 }).result).toBe("unchanged");
  });

  it("잘못된 staleDays(0, 소수, NaN)는 기본값을 쓴다", () => {
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(decideRefresh(WAS, snap("20261005", "20261002", 1000, COLLECTED), WAS_IDX, WAS_IDX, { staleDays: bad }).result).toBe("unchanged");
    }
  });

  it("국내 신규 상장은 기준일 차이와 상관없이 바로 changed", () => {
    const d = decideRefresh(WAS, snap("20261002", "20261002", 1001, COLLECTED), WAS_IDX, WAS_IDX);
    expect(d.result).toBe("changed");
    expect(d.reasons[0]).toMatch(/신규 1개, 삭제 0개; 신규: 101000/);
  });

  it("국내 상장폐지 몇 개는 정상 changed(허용 한도 안)", () => {
    const d = decideRefresh(WAS, snap("20261002", "20261002", 997, COLLECTED), WAS_IDX, WAS_IDX); // 끝의 3개가 빠짐
    expect(d.result).toBe("changed");
    expect(d.reasons[0]).toContain("삭제 3개");
  });

  it("해외 신규 상장(검색 색인에 새 티커)은 바로 changed", () => {
    const d = decideRefresh(WAS, WAS, WAS_IDX, idx([...INDEXED, "NEWCO"]));
    expect(d.result).toBe("changed");
    expect(d.reasons[0]).toContain("신규: NEWCO");
  });

  it("수집 ↔ 색인으로 오가는 경계선 종목의 변동은 구성 변경이 아니다(합집합이 같다)", () => {
    const moved = COLLECTED.slice(0, 15); // 수집에서 빠져 색인으로
    const now = snap("20261002", "20261002", 1000, COLLECTED.slice(15));
    expect(decideRefresh(WAS, now, WAS_IDX, idx([...INDEXED, ...moved])).result).toBe("unchanged");
  });

  it("국내 ETF 가 한도(2%=20개)를 넘게 사라지면 suspicious — 수집 실패로 빠진 스냅샷을 커밋하지 않는다", () => {
    expect(decideRefresh(WAS, snap("20261009", "20261009", 980, COLLECTED), WAS_IDX, WAS_IDX).result).toBe("changed"); // 20개 = 한도 이내
    const d = decideRefresh(WAS, snap("20261009", "20261009", 979, COLLECTED), WAS_IDX, WAS_IDX);
    expect(d.result).toBe("suspicious");
    expect(d.reasons[0]).toContain("국내 ETF 1000개 → 979개");
  });

  it("국내가 작아도 최소 5개까지는 정상으로 본다", () => {
    const was = snap("20261002", "20261002", 100, []);
    expect(decideRefresh(was, snap("20261002", "20261002", 95, []), null, null).result).toBe("changed");
    expect(decideRefresh(was, snap("20261002", "20261002", 94, []), null, null).result).toBe("suspicious");
  });

  it("해외 티커(수집+색인)가 한도(3%=30개)를 넘게 사라지면 suspicious", () => {
    expect(decideRefresh(WAS, WAS, WAS_IDX, idx(INDEXED.slice(0, 770))).result).toBe("changed"); // 30개
    const d = decideRefresh(WAS, WAS, WAS_IDX, idx(INDEXED.slice(0, 769)));
    expect(d.result).toBe("suspicious");
    expect(d.reasons[0]).toContain("해외 티커");
  });

  it("해외 수집 종목이 20% 넘게 줄면(색인으로 옮겨져 합집합은 같아도) suspicious — 순자산 파싱 실패 같은 대량 탈락", () => {
    const now = snap("20261002", "20261002", 1000, COLLECTED.slice(0, 159));
    const d = decideRefresh(WAS, now, WAS_IDX, idx([...INDEXED, ...COLLECTED.slice(159)]));
    expect(d.result).toBe("suspicious");
    expect(d.reasons[0]).toMatch(/해외 수집 종목 200개 → 159개/);
    expect(decideRefresh(WAS, snap("20261002", "20261002", 1000, COLLECTED.slice(0, 160)), WAS_IDX, idx([...INDEXED, ...COLLECTED.slice(160)])).result).toBe("unchanged");
  });

  it("수집 종목이 50개 미만인 작은 상태에서는 비율 검사를 하지 않는다", () => {
    const was = snap("20261002", "20261002", 100, tickers(40, "S"));
    expect(decideRefresh(was, snap("20261002", "20261002", 100, tickers(20, "S")), null, idx(tickers(20, "S", 20))).result).toBe("unchanged");
  });

  it("해외 수집을 건너뛴 결과(색인 없음, 해외 없음)는 suspicious", () => {
    expect(decideRefresh(WAS, { asOf: "20261009", etfs: kr(1000) }, WAS_IDX, null).result).toBe("suspicious");
  });

  it("기준일이 과거로 가면 suspicious", () => {
    expect(decideRefresh(WAS, snap("20260930", "20261002", 1000, COLLECTED), WAS_IDX, WAS_IDX).reasons[0]).toContain("국내 기준일이 과거로");
    expect(decideRefresh(WAS, snap("20261002", "20260930", 1000, COLLECTED), WAS_IDX, WAS_IDX).reasons[0]).toContain("해외 기준일이 과거로");
  });

  it("이전에 색인 파일이 없었다면(처음 도입) 해외 티커 증가는 신규로 보고 changed", () => {
    const d = decideRefresh(WAS, WAS, null, WAS_IDX);
    expect(d.result).toBe("changed");
    expect(d.reasons[0]).toContain("신규 800개");
  });

  it("이전 스냅샷에 해외 기준일이 없었는데 이번에 생기면 changed", () => {
    const was: SnapLike = { asOf: "20261002", etfs: kr(1000) };
    const d = decideRefresh(was, snap("20261002", "20261002", 1000, COLLECTED), null, WAS_IDX);
    expect(d.result).toBe("changed");
    expect(d.reasons.join()).toContain("해외 기준일 없음 → 20261002");
  });

  it("suspicious 가 changed 보다 우선한다(신규가 있어도 대량 감소가 있으면 멈춘다)", () => {
    const now: SnapLike = { asOf: "20261009", asOfUs: "20261009", etfs: [...kr(900, 0), ...kr(5, 5000), ...us(COLLECTED)] };
    expect(decideRefresh(WAS, now, WAS_IDX, WAS_IDX).result).toBe("suspicious");
  });
});

describe("decideRefresh: 일시 오류로 못 받은 종목, 승인, 기준일 검증", () => {
  it("이번에 일시 오류로 못 받은 종목(unavailable)은 삭제로 세지 않는다 — 빠졌다가 돌아올 때 불필요한 커밋이 두 번 생기지 않게", () => {
    const now = snap("20261002", "20261002", 970, COLLECTED); // 국내 끝의 30개가 이번에 없음
    const missing = kr(1000).slice(970).map((e) => e.code);
    expect(decideRefresh(WAS, now, WAS_IDX, WAS_IDX).result).toBe("suspicious"); // 알 수 없으면 대량 감소
    const d = decideRefresh(WAS, now, WAS_IDX, WAS_IDX, { unavailable: missing });
    expect(d.result).toBe("unchanged");
  });

  it("해외 티커도 같다: 못 받은 수집 종목 몇 개는 삭제가 아니고, 그것 때문에 changed 가 되지도 않는다", () => {
    const now = snap("20261002", "20261002", 1000, COLLECTED.slice(3));
    expect(decideRefresh(WAS, now, WAS_IDX, WAS_IDX).result).toBe("changed"); // 모르면 삭제 3개
    expect(decideRefresh(WAS, now, WAS_IDX, WAS_IDX, { unavailable: COLLECTED.slice(0, 3) }).result).toBe("unchanged");
  });

  it("못 받은 종목이 아닌 것이 함께 사라지면 그 부분은 삭제로 센다", () => {
    const now = snap("20261002", "20261002", 995, COLLECTED); // 5개 없음
    const d = decideRefresh(WAS, now, WAS_IDX, WAS_IDX, { unavailable: kr(1000).slice(995, 997).map((e) => e.code) });
    expect(d.result).toBe("changed");
    expect(d.reasons[0]).toContain("삭제 3개");
  });

  it("acceptShrink: 대량 감소를 승인하면 changed 로 받아들이고 사유에 남긴다", () => {
    const now = snap("20261002", "20261002", 900, COLLECTED);
    expect(decideRefresh(WAS, now, WAS_IDX, WAS_IDX).result).toBe("suspicious");
    const d = decideRefresh(WAS, now, WAS_IDX, WAS_IDX, { acceptShrink: true });
    expect(d.result).toBe("changed");
    expect(d.reasons[0]).toMatch(/^승인된 대량 감소 — 국내 ETF 1000개 → 900개/);
    expect(d.reasons[1]).toContain("삭제 100개");
  });

  it("acceptShrink 로도 기준일 이상은 풀리지 않는다", () => {
    const now = snap("20260930", "20261002", 900, COLLECTED);
    const d = decideRefresh(WAS, now, WAS_IDX, WAS_IDX, { acceptShrink: true });
    expect(d.result).toBe("suspicious");
    expect(d.reasons[0]).toContain("과거로");
  });

  it("국내 기준일이 8자리 숫자가 아니면 suspicious(검사가 조용히 건너뛰어지지 않는다)", () => {
    for (const bad of ["", "2026-10-09", "abc", "202610"]) {
      const d = decideRefresh(WAS, { ...WAS, asOf: bad }, WAS_IDX, WAS_IDX);
      expect(d.result, `asOf=${JSON.stringify(bad)}`).toBe("suspicious");
      expect(d.reasons[0]).toContain("올바르지 않습니다");
    }
    expect(decideRefresh(WAS, { ...WAS, asOfUs: "bad" }, WAS_IDX, WAS_IDX).reasons[0]).toContain("해외 기준일이 올바르지 않습니다");
  });

  it("이전에 있던 해외 기준일이 사라지면 suspicious", () => {
    const d = decideRefresh(WAS, { asOf: "20261002", etfs: WAS.etfs }, WAS_IDX, WAS_IDX);
    expect(d.result).toBe("suspicious");
    expect(d.reasons[0]).toContain("해외 기준일이 사라졌습니다");
  });

  it("today 를 주면 이틀 넘게 미래인 기준일은 suspicious, 하루 앞(시간대 차이)은 정상", () => {
    const now = (asOf: string, asOfUs: string) => snap(asOf, asOfUs, 1000, COLLECTED);
    expect(decideRefresh(WAS, now("20261008", "20261008"), WAS_IDX, WAS_IDX, { today: "20261007" }).result).toBe("changed"); // +1일 (6일 차이로 changed)
    expect(decideRefresh(WAS, now("20261009", "20261008"), WAS_IDX, WAS_IDX, { today: "20261007" }).result).toBe("changed"); // +2일 = 허용 끝
    const d = decideRefresh(WAS, now("20261010", "20261008"), WAS_IDX, WAS_IDX, { today: "20261007" });
    expect(d.result).toBe("suspicious");
    expect(d.reasons[0]).toContain("국내 기준일이 미래입니다");
    expect(decideRefresh(WAS, now("20261008", "20261012"), WAS_IDX, WAS_IDX, { today: "20261007" }).reasons[0]).toContain("해외 기준일이 미래입니다");
  });

  it("today 를 주지 않으면(또는 형식이 틀리면) 미래 검사는 하지 않는다", () => {
    expect(decideRefresh(WAS, snap("20301231", "20301231", 1000, COLLECTED), WAS_IDX, WAS_IDX).result).toBe("changed");
    expect(decideRefresh(WAS, snap("20301231", "20301231", 1000, COLLECTED), WAS_IDX, WAS_IDX, { today: "x" }).result).toBe("changed");
  });

  it("연말·윤년 경계의 일수 계산: 20261230 → 20270104 는 5일, 20280228 → 20280303 은 4일(윤년)", () => {
    const a = snap("20261230", "20261230", 10, []);
    expect(decideRefresh(a, snap("20270104", "20261230", 10, []), null, null).reasons.join()).toContain("(5일)");
    const b = snap("20280228", "20280228", 10, []);
    expect(decideRefresh(b, snap("20280303", "20280228", 10, []), null, null).result).toBe("unchanged");
  });

  it("해외 수집 종목 수의 비율 검사는 정확히 50개부터 적용된다", () => {
    const was50 = snap("20261002", "20261002", 100, tickers(50, "S"));
    expect(decideRefresh(was50, snap("20261002", "20261002", 100, tickers(40, "S")), null, idx(tickers(10, "S", 40))).result).toBe("unchanged"); // 80% 유지
    expect(decideRefresh(was50, snap("20261002", "20261002", 100, tickers(39, "S")), null, idx(tickers(11, "S", 39))).result).toBe("suspicious");
    const was49 = snap("20261002", "20261002", 100, tickers(49, "S"));
    expect(decideRefresh(was49, snap("20261002", "20261002", 100, tickers(10, "S")), null, idx(tickers(39, "S", 10))).result).toBe("unchanged");
  });

  it("force: 커밋할 변화가 없어도 changed 로 본다 — 하지만 이상 징후는 강제로 넘길 수 없다", () => {
    const same = decideRefresh(WAS, WAS, WAS_IDX, WAS_IDX, { force: true });
    expect(same.result).toBe("changed");
    expect(same.reasons[0]).toContain("강제 갱신");
    expect(decideRefresh(WAS, WAS, WAS_IDX, WAS_IDX).result).toBe("unchanged");
    expect(decideRefresh(WAS, snap("20261009", "20261009", 900, COLLECTED), WAS_IDX, WAS_IDX, { force: true }).result).toBe("suspicious");
    expect(decideRefresh(WAS, snap("20260930", "20261002", 1000, COLLECTED), WAS_IDX, WAS_IDX, { force: true }).result).toBe("suspicious");
  });

  it("force 이고 이미 바꿀 이유가 있으면 이유는 그대로(강제 문구를 덧붙이지 않는다)", () => {
    const d = decideRefresh(WAS, snap("20261002", "20261002", 1001, COLLECTED), WAS_IDX, WAS_IDX, { force: true });
    expect(d.reasons).toHaveLength(1);
    expect(d.reasons[0]).toContain("신규 1개");
  });
});
