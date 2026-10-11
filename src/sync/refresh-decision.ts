/**
 * 데이터 자동 갱신의 "커밋할지" 판정(순수 함수). 무인 실행이 기본 브랜치에 쓰므로 세 가지를 지킨다.
 *
 * 1) 의미 없는 커밋을 만들지 않는다. 파일 바이트는 매번 다르므로(생성 시각, 제공처가 고치는 수정종가 끝자리) 비교하지 않는다.
 * 2) 저장소가 커지지 않게 한다. 수치 파일 하나가 gzip 으로 약 2.4MB 이므로 매일 커밋하면 연 수백 MB 가 된다.
 *    그래서 시세만 바뀐 경우에는 마지막 커밋의 기준일보다 staleDays(기본 5일) 이상 새로울 때만 커밋하고,
 *    ETF 구성이 바뀌면(신규 상장·상장폐지·해외 검색 색인의 신규 티커) 바로 커밋한다 — 새 ETF 가 검색에 빨리 나타나게 한다.
 * 3) 일부가 조용히 빠진 스냅샷을 커밋하지 않는다. 종목이 갑자기 많이 줄거나 기준일이 과거·미래·형식 오류면 suspicious 로 멈춘다.
 *    정당한 큰 변화(필터 기준 변경, 대규모 상장폐지)는 사람이 acceptShrink 로 승인해 받아들일 수 있다(기준일 검사는 승인과 무관).
 *    이번 수집에서 일시 오류로 못 받은 종목(unavailable)은 "삭제"로 세지 않는다 — 다음에 복귀할 때 불필요한 커밋이 두 번 생기는 것을 막는다.
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
  /** 이번 수집에서 일시 오류로 못 받은 종목 코드. 이전에 있었는데 지금 없어도 삭제로 세지 않는다 */
  unavailable?: Iterable<string>;
  /** 오늘(UTC, YYYYMMDD). 있으면 기준일이 이보다 이틀 넘게 미래인 스냅샷을 이상으로 본다 */
  today?: string;
  /** 사람이 대량 감소를 승인했다: 종목 감소 검사만 건너뛴다(기준일 검사는 그대로) */
  acceptShrink?: boolean;
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
/** 기준일은 오늘(UTC)보다 이만큼(일)까지 앞설 수 있다: 한국 시간대로 하루 빠를 수 있어서 */
export const FUTURE_SLACK_DAYS = 2;

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

  const unavailable = new Set(opts.unavailable ?? []);
  const krGone = minus(krWas, krNow).filter((c) => !unavailable.has(c));
  const usGone = minus(usWas, usNow).filter((c) => !unavailable.has(c));

  // 1) 이상 징후: 커밋하지 않고 멈춘다. 기준일 문제는 승인으로 풀 수 없고, 종목 감소는 승인(acceptShrink)으로 받아들일 수 있다.
  const badDates: string[] = [];
  if (!validYmd(now.asOf)) badDates.push(`국내 기준일이 올바르지 않습니다(${JSON.stringify(now.asOf)})`);
  else if (validYmd(was.asOf) && now.asOf < was.asOf) badDates.push(`국내 기준일이 과거로 갔습니다(${was.asOf} → ${now.asOf})`);
  if (now.asOfUs !== undefined && !validYmd(now.asOfUs)) badDates.push(`해외 기준일이 올바르지 않습니다(${JSON.stringify(now.asOfUs)})`);
  else if (validYmd(was.asOfUs) && now.asOfUs === undefined) badDates.push(`해외 기준일이 사라졌습니다(이전 ${was.asOfUs})`);
  else if (validYmd(was.asOfUs) && validYmd(now.asOfUs) && now.asOfUs < was.asOfUs) badDates.push(`해외 기준일이 과거로 갔습니다(${was.asOfUs} → ${now.asOfUs})`);
  if (opts.today && validYmd(opts.today)) {
    if (validYmd(now.asOf) && gap(opts.today, now.asOf) > FUTURE_SLACK_DAYS) badDates.push(`국내 기준일이 미래입니다(${now.asOf}, 오늘 ${opts.today})`);
    if (validYmd(now.asOfUs) && gap(opts.today, now.asOfUs) > FUTURE_SLACK_DAYS) badDates.push(`해외 기준일이 미래입니다(${now.asOfUs}, 오늘 ${opts.today})`);
  }
  if (badDates.length) return { result: "suspicious", reasons: badDates };

  const shrink: string[] = [];
  if (krGone.length > failureLimit(krWas.size, KR_SHRINK.rate, KR_SHRINK.floor)) {
    shrink.push(`국내 ETF ${krWas.size}개 → ${krNow.size}개(사라진 ${krGone.length}개: ${head(krGone)})`);
  }
  if (usGone.length > failureLimit(usWas.size, US_SHRINK.rate, US_SHRINK.floor)) {
    shrink.push(`해외 티커(수집+색인) ${usWas.size}개 → ${usNow.size}개(사라진 ${usGone.length}개: ${head(usGone)})`);
  }
  if (usCollWas.size >= 50 && usCollNow.size < usCollWas.size * US_COLLECTED_MIN_KEEP) {
    shrink.push(`해외 수집 종목 ${usCollWas.size}개 → ${usCollNow.size}개(${Math.round((1 - usCollNow.size / usCollWas.size) * 100)}% 감소)`);
  }
  if (shrink.length && !opts.acceptShrink) return { result: "suspicious", reasons: shrink };

  // 2) 구성 변경: 바로 커밋
  const reasons: string[] = [];
  if (shrink.length) reasons.push(`승인된 대량 감소 — ${shrink.join("; ")}`);
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
