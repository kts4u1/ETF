/**
 * KRX "ETF 전종목 시세" 과거 날짜 CSV로 상장폐지 ETF 목록(data/delisted.csv)을 만든다.
 *
 * 원리: 과거 어느 날짜에 상장돼 있었는데 지금은 현재 목록에 없는 ETF = 그 사이 사라진(상장폐지·만기청산) ETF 후보.
 * 후보마다 네이버 시세로 검증한다 — 시세가 기준일 근처까지 이어지면 아직 거래 중(네이버 목록에서만 빠진 것)이므로 제외.
 *
 * 실제로 겪은 실수를 자동으로 잡는다: KRX 화면에서 날짜를 바꾸고도 "조회"를 다시 누르지 않으면 날짜와 상관없이
 * 오늘 데이터가 내려온다(5개 파일이 해시까지 같았다). 파일의 종가를 시세 캐시와 맞춰 실제 날짜를 추정하고,
 * 오늘 데이터면 거부한다.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanSeries } from "../core/metrics";
import { HISTORY_LIMIT_DAYS } from "../core/format";
import type { PriceSeries, Snapshot } from "../core/types";
import { CACHE_DIR, cachedJson } from "./build-snapshot";
import { DELISTED_FILE, decodeCsv, loadDelistedEntries, normalizeDate, type DelistedEntry } from "./delisted";
import { fetchPrices } from "./naver";
import { mapPool } from "./pool";

export const DELISTED_META_FILE = "data/delisted.meta.json";

export interface DelistedMeta {
  /** 사용한 KRX 스냅샷 날짜(YYYYMMDD) 목록, 오름차순 */
  snapshots: string[];
}

// ───────── KRX CSV ─────────

export interface KrxRow {
  code: string;
  name: string;
  close: number;
}

/** KRX "ETF 전종목 시세" CSV. EUC-KR/UTF-8 모두 허용. 필요한 열(종목코드·종목명·종가)이 없으면 오류. */
export function parseKrxEtfCsv(buf: Uint8Array): KrxRow[] {
  const text = decodeCsv(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0] as string);
  const ci = header.indexOf("종목코드");
  const ni = header.indexOf("종목명");
  const pi = header.indexOf("종가");
  if (ci < 0 || ni < 0 || pi < 0) {
    throw new Error(`KRX ETF 전종목 시세 형식이 아닙니다. '종목코드·종목명·종가' 열이 필요합니다. (발견한 열: ${header.slice(0, 8).join(", ")})`);
  }
  const out: KrxRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const code = (c[ci] ?? "").toUpperCase();
    const close = Number((c[pi] ?? "").replace(/,/g, ""));
    if (!/^[0-9A-Z]{6}$/.test(code) || !(c[ni] ?? "") || !Number.isFinite(close)) continue;
    out.push({ code, name: c[ni] as string, close });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

// ───────── 날짜 추정 ─────────

export interface SeriesLike {
  dates: string[];
  close: number[];
}

/**
 * 파일의 종가를 시세 캐시와 맞춰 어느 날짜의 데이터인지 추정한다.
 * 시세는 배당 보정(수정주가)이라 먼 과거일수록 실제 종가와 조금 달라지지만, 배당이 없는 ETF는 정확히 일치하므로
 * "일치 개수가 가장 많은 날짜"는 올바른 날짜를 가리킨다. 일치 비율이 너무 낮으면 null.
 */
export function inferSnapshotDate(
  rows: KrxRow[],
  series: Map<string, SeriesLike>,
  opts: { sample?: number; minRatio?: number } = {},
): { date: string; matched: number; compared: number } | null {
  const common = rows.filter((r) => series.has(r.code)).slice(0, opts.sample ?? 300);
  if (common.length < 20) return null;
  // 날짜 → (코드 → 종가) 조회를 위해 코드별 Map 을 만든다
  const byCode = common.map((r) => ({ r, m: new Map((series.get(r.code) as SeriesLike).dates.map((d, i) => [d, (series.get(r.code) as SeriesLike).close[i] as number])) }));
  const refDates = new Set<string>();
  for (const { m } of byCode) for (const d of m.keys()) refDates.add(d);
  let best: { date: string; matched: number } | null = null;
  for (const d of refDates) {
    let matched = 0;
    for (const { r, m } of byCode) {
      const v = m.get(d);
      if (v !== undefined && Math.abs(v / r.close - 1) < 0.0005) matched++;
    }
    if (!best || matched > best.matched || (matched === best.matched && d > best.date)) best = { date: d, matched };
  }
  if (!best || best.matched / common.length < (opts.minRatio ?? 0.25)) return null;
  return { date: best.date, matched: best.matched, compared: common.length };
}

// ───────── 후보 판정 ─────────

export type CandidateVerdict =
  | { kind: "delisted"; lastDate: string }
  | { kind: "still-trading"; lastDate: string }
  | { kind: "no-prices" };

/**
 * 현재 목록에 없는 ETF를 시세 마지막 날짜로 판정한다.
 * 시세가 데이터 기준일의 7일 이내까지 이어지면 아직 거래 중(네이버 목록에서만 빠진 것)이다.
 */
export function classifyCandidate(lastDate: string | null, nDays: number, datasetAsOf: string): CandidateVerdict {
  if (!lastDate || nDays < 60) return { kind: "no-prices" };
  const cutoff = shiftDays(datasetAsOf, -7);
  return lastDate >= cutoff ? { kind: "still-trading", lastDate } : { kind: "delisted", lastDate };
}

function shiftDays(ymd: string, days: number): string {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + days));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ───────── CSV 직렬화/병합 ─────────

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toDelistedCsv(entries: DelistedEntry[]): string {
  const rows = [...entries].sort((a, b) => (a.delistedOn ?? "").localeCompare(b.delistedOn ?? "") || a.code.localeCompare(b.code));
  return ["종목코드,종목명,상장폐지일", ...rows.map((e) => [e.code, csvCell(e.name), e.delistedOn ?? ""].join(","))].join("\n") + "\n";
}

/** 기존 목록에 새 항목을 합친다. 코드가 같으면 새 정보(상장폐지일)가 우선하되, 없으면 기존 값을 유지한다. */
export function mergeEntries(existing: DelistedEntry[], added: DelistedEntry[]): DelistedEntry[] {
  const map = new Map(existing.map((e) => [e.code, e]));
  for (const a of added) {
    const prev = map.get(a.code);
    map.set(a.code, { code: a.code, name: a.name || prev?.name || "", delistedOn: a.delistedOn ?? prev?.delistedOn ?? null });
  }
  return [...map.values()];
}

export async function loadDelistedMeta(path = DELISTED_META_FILE): Promise<DelistedMeta | null> {
  if (!existsSync(path)) return null;
  try {
    const m = JSON.parse(await readFile(path, "utf8")) as Partial<DelistedMeta>;
    return Array.isArray(m.snapshots) ? { snapshots: m.snapshots.filter((s): s is string => typeof s === "string").sort() } : null;
  } catch {
    return null;
  }
}

// ───────── 실행(I/O) ─────────

export interface DeriveReport {
  files: { path: string; date: string | null; rows: number; verdict: "ok" | "rejected"; note: string }[];
  candidates: number;
  delisted: DelistedEntry[];
  stillTrading: { code: string; name: string; lastDate: string }[];
  noPrices: { code: string; name: string }[];
  total: number;
}

export async function deriveDelisted(
  files: { path: string; date?: string }[],
  log: (m: string) => void = () => {},
): Promise<DeriveReport> {
  const snap = JSON.parse(await readFile("public/data/snapshot.json", "utf8")) as Snapshot;
  const current = new Set(snap.etfs.map((e) => e.code));

  // 현재 ETF의 시세 캐시(날짜 추정용)
  const series = new Map<string, SeriesLike>();
  for (const e of snap.etfs) {
    const p = join(CACHE_DIR, "price", `${e.code}.json`);
    if (!existsSync(p)) continue;
    const s = cleanSeries((JSON.parse(await readFile(p, "utf8")) as { data: PriceSeries }).data);
    series.set(e.code, { dates: s.dates, close: s.close });
  }

  const report: DeriveReport = { files: [], candidates: 0, delisted: [], stillTrading: [], noPrices: [], total: 0 };
  const seenAt = new Map<string, { name: string; date: string }>(); // 후보 코드 → 처음 관측된(가장 이른) 스냅샷
  const snapshots: string[] = [];

  for (const f of files) {
    const rows = parseKrxEtfCsv(await readFile(f.path));
    const given = f.date ? normalizeDate(f.date) : null;
    const inferred = inferSnapshotDate(rows, series);
    const date = given ?? inferred?.date ?? null;
    const base = { path: f.path, date, rows: rows.length };
    if (!date) {
      report.files.push({ ...base, verdict: "rejected", note: "날짜를 추정하지 못했습니다(종가가 시세 캐시와 거의 맞지 않음). --date 로 날짜를 지정하세요." });
      continue;
    }
    if (given && inferred && inferred.date !== given) {
      report.files.push({ ...base, verdict: "rejected", note: `지정한 날짜(${given})와 종가로 추정한 날짜(${inferred.date})가 다릅니다. KRX 화면에서 날짜를 바꾼 뒤 '조회'를 다시 눌렀는지 확인하세요.` });
      continue;
    }
    // 오늘 데이터 거부: 날짜가 기준일 7일 이내이거나, 파일의 종목이 현재 목록과 완전히 같다
    const same = rows.length === current.size && rows.every((r) => current.has(r.code));
    if (date >= shiftDays(snap.asOf, -7) || same) {
      report.files.push({ ...base, verdict: "rejected", note: "과거 데이터가 아니라 현재(오늘) 데이터입니다. KRX 화면에서 날짜를 바꾼 뒤 '조회'를 다시 누르고 받으세요." });
      continue;
    }
    snapshots.push(date);
    let added = 0;
    for (const r of rows) {
      if (current.has(r.code)) continue;
      const prev = seenAt.get(r.code);
      if (!prev || date < prev.date) seenAt.set(r.code, { name: r.name, date });
      added++;
    }
    report.files.push({ ...base, verdict: "ok", note: `${inferred ? `종가 일치 ${inferred.matched}/${inferred.compared}` : "날짜 지정"} · 현재 목록에 없는 ETF ${added}개` });
  }
  report.candidates = seenAt.size;
  if (snapshots.length === 0) return report;

  // 후보 시세 수집 + 판정. 캐시는 syncDelisted 가 쓰는 것과 같은 위치/형식이다.
  await mkdir(join(CACHE_DIR, "delisted"), { recursive: true });
  const list = [...seenAt].map(([code, v]) => ({ code, name: v.name }));
  const run = await mapPool(list, 6, (c) =>
    cachedJson<{ entry: DelistedEntry; series: PriceSeries }>(join(CACHE_DIR, "delisted", `${c.code}.json`), false, async () => ({
      entry: { code: c.code, name: c.name, delistedOn: null },
      series: await fetchPrices(c.code, HISTORY_LIMIT_DAYS),
    })),
  );
  list.forEach((c, i) => {
    const r = run.results[i];
    const s = r ? cleanSeries(r.series) : null;
    const last = s && s.dates.length ? (s.dates[s.dates.length - 1] as string) : null;
    const v = classifyCandidate(last, s?.dates.length ?? 0, snap.asOf);
    if (v.kind === "delisted") report.delisted.push({ code: c.code, name: c.name, delistedOn: v.lastDate });
    else if (v.kind === "still-trading") report.stillTrading.push({ code: c.code, name: c.name, lastDate: v.lastDate });
    else report.noPrices.push({ code: c.code, name: c.name });
  });

  const merged = mergeEntries(await loadDelistedEntries(), report.delisted);
  await mkdir("data", { recursive: true });
  await writeFile(DELISTED_FILE, toDelistedCsv(merged));
  const meta = (await loadDelistedMeta()) ?? { snapshots: [] };
  meta.snapshots = [...new Set([...meta.snapshots, ...snapshots])].sort();
  await writeFile(DELISTED_META_FILE, JSON.stringify(meta, null, 2) + "\n");
  report.total = merged.length;
  log(`data/delisted.csv: 총 ${merged.length}개 (이번에 ${report.delisted.length}개 추가/갱신)`);
  return report;
}
