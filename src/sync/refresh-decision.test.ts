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
