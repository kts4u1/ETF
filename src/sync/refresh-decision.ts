/**
 * 데이터 자동 갱신의 "커밋할지" 판정(순수 함수). 무인 실행이 기본 브랜치에 쓰므로 세 가지를 지킨다.
 *
 * 1) 의미 없는 커밋을 만들지 않는다. 파일 바이트는 매번 다르므로(생성 시각, 제공처가 고치는 수정종가 끝자리) 비교하지 않는다.
 * 2) 저장소가 커지지 않게 한다. 수치 파일 하나가 gzip 으로 약 2.4MB 이므로 매일 커밋하면 연 수백 MB 가 된다.
 *    그래서 시세만 바뀐 경우에는 마지막 커밋의 기준일보다 staleDays(기본 5일) 이상 새로울 때만 커밋하고,
 *    ETF 구성이 바뀌면(신규 상장·상장폐지·해외 검색 색인의 신규 티커) 바로 커밋한다 — 새 ETF 가 검색에 빨리 나타나게 한다.
 * 3) 일부가 조용히 빠진 스냅샷을 커밋하지 않는다. 종목이 갑자기 많이 줄거나 기준일이 과거로 가면 suspicious 로 멈춘다.
 *
 * "구성"을 볼 때 해외는 수집 종목 ∪ 검색 색인(미수집) 티커의 합집합을 쓴다. 순자산·거래대금이 기준선 근처인 ETF 가
 * 수집 ↔ 색인으로 오가는 일상적인 변동에는 반응하지 않고, 진짜 신규 상장·상장폐지에만 반응하게 하려는 것이다.
 */
import { failureLimit } from "./failure-policy";

export type RefreshResult = "changed" | "unchanged" | "suspicious";

export interface RefreshDecision {
  result: RefreshResult;
  reasons: string[];
}

export interface SnapLike {
  asOf: string;
  asOfUs?: string;
  etfs: ReadonlyArray<{ code: string; market?: string }>;
}
/** UsIndexFile.etfs 와 같은 모양: [티커, 이름, 사유][] */
export interface IndexLike {
  etfs: ReadonlyArray<ReadonlyArray<string>>;
}

export interface DecideOptions {
  /** 시세만 바뀐 경우 마지막 커밋보다 이 일수 이상 새로울 때 커밋(기본 5). 1 이면 거래일마다 */
  staleDays?: number;
}

export const DEFAULT_STALE_DAYS = 5;
/** 국내 ETF 가 이만큼(2%, 최소 5개) 넘게 사라지면 이상으로 본다 — 정상적인 상장폐지는 한 번에 몇 개 수준 */
export const KR_SHRINK = { rate: 0.02, floor: 5 };
/** 해외 전체 티커(수집 ∪ 색인)가 이만큼(3%, 최소 10개) 넘게 사라지면 이상 */
export const US_SHRINK = { rate: 0.03, floor: 10 };
/** 해외 수집 종목 수가 이 비율 아래로 떨어지면 이상(순자산 파싱 실패 등으로 대량 탈락한 경우) */
export const US_COLLECTED_MIN_KEEP = 0.8;

const isUs = (e: { market?: string }) => e.market === "US";
const codesOf = (s: SnapLike, us: boolean) => new Set(s.etfs.filter((e) => isUs(e) === us).map((e) => e.code));
const tickersOf = (idx: IndexLike | null) => new Set((idx?.etfs ?? []).map((r) => r[0] as string));
const union = (a: Set<string>, b: Set<string>) => new Set([...a, ...b]);
const minus = (a: Set<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();
const head = (xs: string[], n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? ` 외 ${xs.length - n}개` : "");

const utcDay = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) / 86_400_000;
const validYmd = (s: unknown): s is string => typeof s === "string" && /^\d{8}$/.test(s);
const gap = (from: string, to: string) => Math.round(utcDay(to) - utcDay(from));

export function decideRefresh(
  was: SnapLike | null,
  now: SnapLike,
  wasIdx: IndexLike | null,
  nowIdx: IndexLike | null,
  opts: DecideOptions = {},
): RefreshDecision {
  const staleDays = opts.staleDays !== undefined && Number.isInteger(opts.staleDays) && opts.staleDays >= 1 ? opts.staleDays : DEFAULT_STALE_DAYS;
  if (!was) return { result: "changed", reasons: ["이전 스냅샷 없음"] };

  const krWas = codesOf(was, false);
  const krNow = codesOf(now, false);
  const usCollWas = codesOf(was, true);
  const usCollNow = codesOf(now, true);
  const usWas = union(usCollWas, tickersOf(wasIdx));
  const usNow = union(usCollNow, tickersOf(nowIdx));

  // 1) 이상 징후: 커밋하지 않고 멈춘다
  const bad: string[] = [];
  const krGone = minus(krWas, krNow);
  if (krGone.length > failureLimit(krWas.size, KR_SHRINK.rate, KR_SHRINK.floor)) {
    bad.push(`국내 ETF ${krWas.size}개 → ${krNow.size}개(사라진 ${krGone.length}개: ${head(krGone)})`);
  }
  const usGone = minus(usWas, usNow);
  if (usGone.length > failureLimit(usWas.size, US_SHRINK.rate, US_SHRINK.floor)) {
    bad.push(`해외 티커(수집+색인) ${usWas.size}개 → ${usNow.size}개(사라진 ${usGone.length}개: ${head(usGone)})`);
  }
  if (usCollWas.size >= 50 && usCollNow.size < usCollWas.size * US_COLLECTED_MIN_KEEP) {
    bad.push(`해외 수집 종목 ${usCollWas.size}개 → ${usCollNow.size}개(${Math.round((1 - usCollNow.size / usCollWas.size) * 100)}% 감소)`);
  }
  if (validYmd(was.asOf) && validYmd(now.asOf) && now.asOf < was.asOf) bad.push(`국내 기준일이 과거로 갔습니다(${was.asOf} → ${now.asOf})`);
  if (validYmd(was.asOfUs) && validYmd(now.asOfUs) && now.asOfUs < was.asOfUs) bad.push(`해외 기준일이 과거로 갔습니다(${was.asOfUs} → ${now.asOfUs})`);
  if (bad.length) return { result: "suspicious", reasons: bad };

  // 2) 구성 변경: 바로 커밋
  const reasons: string[] = [];
  const added = [...minus(krNow, krWas), ...minus(usNow, usWas)];
  const removed = [...krGone, ...usGone];
  if (added.length || removed.length) {
    const parts = [`신규 ${added.length}개`, `삭제 ${removed.length}개`];
    reasons.push(`ETF 구성 변경(${parts.join(", ")}${added.length ? `; 신규: ${head(added)}` : ""}${removed.length ? `; 삭제: ${head(removed)}` : ""})`);
  }

  // 3) 시세만 새로워진 경우: 마지막 커밋보다 충분히 새로울 때만
  if (validYmd(was.asOf) && validYmd(now.asOf)) {
    const d = gap(was.asOf, now.asOf);
    if (d >= staleDays) reasons.push(`국내 기준일 ${was.asOf} → ${now.asOf}(${d}일)`);
  }
  if (validYmd(was.asOfUs) && validYmd(now.asOfUs)) {
    const d = gap(was.asOfUs, now.asOfUs);
    if (d >= staleDays) reasons.push(`해외 기준일 ${was.asOfUs} → ${now.asOfUs}(${d}일)`);
  } else if (!validYmd(was.asOfUs) && validYmd(now.asOfUs)) {
    reasons.push(`해외 기준일 없음 → ${now.asOfUs}`);
  }

  return reasons.length ? { result: "changed", reasons } : { result: "unchanged", reasons: [`마지막 커밋 대비 구성 변화 없고 시세 기준일 차이가 ${staleDays}일 미만`] };
}
