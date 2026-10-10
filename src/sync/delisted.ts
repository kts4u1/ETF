/**
 * 상장폐지 ETF 가져오기(선택 기능).
 *
 * 왜 필요한가: 네이버 금융은 현재 상장 중인 ETF만 제공해서, 백테스트에 상장폐지된 ETF(대체로 부진)가 빠지는
 * 생존편향이 생긴다. 상장폐지 목록은 KRX 정보데이터시스템(로그인 필요)·KIND 등에서 받을 수 있지만 자동 수집은
 * 접근 제한으로 불가능하다. 그래서 사용자가 직접 내려받은 CSV(data/delisted.csv)를 넣을 수 있게 했다.
 *
 * CSV 형식: 헤더가 있는 CSV/TSV. 필요한 열(한글/영문 모두 허용)
 *   종목코드(code)  — 6자리. KRX 단축코드의 'A' 접두(A069500)도 허용
 *   종목명(name)    — 분류에 쓴다
 *   상장폐지일(delistedOn) — 선택. YYYYMMDD, YYYY-MM-DD, YYYY/MM/DD
 * 파일이 없으면 이 단계는 건너뛰며, 리포트에는 "상장폐지 ETF 미포함(편향 미보정)"이 표시된다.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanSeries } from "../core/metrics";
import { classify } from "../core/taxonomy";
import type { EtfRecord, PriceSeries } from "../core/types";
import { CACHE_DIR, cachedJson } from "./build-snapshot";
import { fetchPrices } from "./naver";
import { mapPool } from "./pool";

export const DELISTED_FILE = "data/delisted.csv";

export interface DelistedEntry {
  code: string;
  name: string;
  /** YYYYMMDD 또는 null */
  delistedOn: string | null;
}

/** UTF-8 로 읽어 깨진 글자(U+FFFD)가 있으면 KRX 다운로드의 기본 인코딩인 EUC-KR 로 다시 읽는다 */
export function decodeCsv(buf: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("euc-kr").decode(buf);
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
    } else if (c === sep && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const HEAD = {
  code: ["종목코드", "단축코드", "코드", "code", "symbol"],
  name: ["종목명", "한글종목명", "이름", "name"],
  date: ["상장폐지일", "폐지일", "delistedon", "delisted_on", "date"],
};
const findCol = (header: string[], names: string[]) => header.findIndex((h) => names.includes(h.toLowerCase().replace(/\s/g, "")));

export function normalizeDate(v: string): string | null {
  const m = v.trim().match(/^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

export function parseDelistedCsv(text: string): DelistedEntry[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const sep = (lines[0] as string).includes("\t") ? "\t" : ",";
  const header = splitLine(lines[0] as string, sep);
  const ci = findCol(header, HEAD.code);
  const ni = findCol(header, HEAD.name);
  const di = findCol(header, HEAD.date);
  if (ci < 0 || ni < 0) throw new Error(`delisted.csv 헤더에서 '종목코드'와 '종목명' 열을 찾지 못했습니다. (발견한 열: ${header.join(", ")})`);
  const seen = new Set<string>();
  const out: DelistedEntry[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    let code = (cells[ci] ?? "").toUpperCase();
    if (code.length === 7 && code.startsWith("A")) code = code.slice(1); // KRX 단축코드 접두
    const name = cells[ni] ?? "";
    if (!/^[0-9A-Z]{6}$/.test(code) || !name || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name, delistedOn: di >= 0 ? normalizeDate(cells[di] ?? "") : null });
  }
  return out;
}

export async function loadDelistedEntries(path = DELISTED_FILE): Promise<DelistedEntry[]> {
  if (!existsSync(path)) return [];
  return parseDelistedCsv(decodeCsv(await readFile(path)));
}

interface CachedDelisted {
  entry: DelistedEntry;
  series: PriceSeries;
}

/** 목록에 있는 상장폐지 ETF의 시세를 받아 캐시한다. 시세를 구하지 못한 종목은 건너뛰고 사유를 돌려준다. */
export async function syncDelisted(
  entries: DelistedEntry[],
  priceDays: number,
  concurrency: number,
  log: (m: string) => void = () => {},
): Promise<{ ok: number; skipped: { code: string; reason: string }[] }> {
  await mkdir(join(CACHE_DIR, "delisted"), { recursive: true });
  const skipped: { code: string; reason: string }[] = [];
  let ok = 0;
  const run = await mapPool(entries, concurrency, async (entry) => {
    const data = await cachedJson<CachedDelisted>(join(CACHE_DIR, "delisted", `${entry.code}.json`), false, async () => ({
      entry,
      series: await fetchPrices(entry.code, priceDays),
    }));
    return data;
  });
  entries.forEach((e, i) => {
    const err = run.errors.get(i);
    const r = run.results[i];
    if (err) skipped.push({ code: e.code, reason: (err as Error).message });
    else if (!r || r.series.dates.length < 60) skipped.push({ code: e.code, reason: "시세 없음(네이버가 상장폐지 종목 시세를 제공하지 않을 수 있음)" });
    else ok++;
  });
  log(`상장폐지 ETF 시세: ${ok}개 확보, ${skipped.length}개 건너뜀`);
  return { ok, skipped };
}

/** 백테스트 유니버스에 넣을 상장폐지 ETF(정적 정보는 이름 분류만). 캐시에 있는 것만 읽는다. */
export async function loadCachedDelisted(): Promise<{ rec: EtfRecord; series: PriceSeries }[]> {
  const entries = await loadDelistedEntries();
  const out: { rec: EtfRecord; series: PriceSeries }[] = [];
  for (const entry of entries) {
    const path = join(CACHE_DIR, "delisted", `${entry.code}.json`);
    if (!existsSync(path)) continue;
    const cached = JSON.parse(await readFile(path, "utf8")) as { data: CachedDelisted };
    const series = cleanSeries(cached.data.series);
    if (series.dates.length < 60) continue;
    out.push({
      series,
      rec: {
        code: entry.code,
        name: entry.name,
        issuer: null,
        price: series.close[series.close.length - 1] as number,
        changeRate: null,
        aumEok: 0,
        fee: null,
        divYield: null,
        navGap: null,
        description: "",
        tax: classify(entry.name, null),
        // 백테스트에서는 기준일마다 시세로 다시 계산해서 덮어쓴다. 여기 값은 자리표시.
        m: {} as EtfRecord["m"],
      },
    });
  }
  return out;
}
