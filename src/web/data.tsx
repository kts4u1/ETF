import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_PREFS, rankEtfs } from "../core/scoring";
import type { HoldingsFile } from "../core/overlap";
import type { EtfRecord, Preferences, Recommendation, Scored, SeriesFile, Snapshot } from "../core/types";
import { readJson, writeJson } from "./storage";

export interface ComboCell {
  n: number;
  ret: number;
  mdd: number;
  p10: number;
  dRet: number;
  dRetCI: number | null;
  dMdd: number;
  dMddCI: number | null;
  mddWin: number;
}
export interface BacktestSummary {
  asOf: string;
  nEtf: number;
  nDates: number;
  profiles: Record<string, Record<string, BacktestCell>>;
  /** 조합 제안 검증: 성향 → 보유기간(m3/m6/m12) → 전략명 → 결과 */
  combos?: Record<string, Record<string, Record<string, ComboCell>>>;
  comboMonths?: number;
  /** 백테스트에 포함된 상장폐지 ETF 수(0이면 생존편향 미보정) */
  delistedIncluded?: number;
  /** 상장폐지 목록을 만든 KRX 스냅샷 기준일(YYYYMMDD, 오름차순). 이 날짜 이후에 폐지된 ETF만 확실히 포함됨 */
  delistedSnapshots?: string[];
}
export interface BacktestCell {
  n: number;
  top: number;
  cand: number;
  excess: number;
  win: number;
  indepN: number;
  indepMean: number;
  indepCI: number;
  topMdd: number;
  candMdd: number;
  naiveTop: number;
  naiveMdd: number;
  ic: number | null;
  icCI: number | null;
}

interface AppData {
  snap: Snapshot;
  byCode: Map<string, EtfRecord>;
  prefs: Preferences;
  setPrefs: (patch: Partial<Preferences>) => void;
  resetPrefs: () => void;
  /** 동일 지수 중복 제거(설정에 따라)된 추천 결과 */
  rec: Recommendation;
  /** 중복 제거 없이 모든 후보를 점수화한 결과 — 탐색/상세에서 점수 조회용 */
  scoreOf: (code: string) => Scored | undefined;
  allScored: Scored[];
  excludedBy: Map<string, string>;
}

const Ctx = createContext<AppData | null>(null);
// 앱 이름이 바뀌어도 저장된 설정(및 App.tsx 의 테마 키)이 사라지지 않도록 예전 접두사를 유지한다.
const PREFS_KEY = "etf-picker:prefs:v1";

function loadPrefs(): Preferences {
  const saved = readJson<Partial<Preferences>>(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...(saved ?? {}) };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<Preferences>(loadPrefs);

  useEffect(() => {
    getJson<Snapshot>("./data/snapshot.json")
      .then(setSnap)
      .catch((e: Error) => setError(e.message));
  }, []);

  const setPrefs = useCallback((patch: Partial<Preferences>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...patch };
      writeJson(PREFS_KEY, next);
      return next;
    });
  }, []);
  const resetPrefs = useCallback(() => {
    setPrefsState(DEFAULT_PREFS);
    writeJson(PREFS_KEY, DEFAULT_PREFS);
  }, []);

  const derived = useMemo(() => {
    if (!snap) return null;
    const byCode = new Map(snap.etfs.map((e) => [e.code, e]));
    const rec = rankEtfs(snap.etfs, prefs);
    const all = prefs.dedupe ? rankEtfs(snap.etfs, { ...prefs, dedupe: false }) : rec;
    const scoreMap = new Map(all.ranked.map((s) => [s.etf.code, s]));
    const excludedBy = new Map(all.excluded.map((x) => [x.etf.code, x.reason]));
    return { byCode, rec, all, scoreMap, excludedBy };
  }, [snap, prefs]);

  if (error) {
    return (
      <div className="state-box" role="alert">
        <h2>데이터를 불러오지 못했습니다</h2>
        <p>{error}</p>
        <p>
          처음 실행이라면 터미널에서 <code>npm run sync</code> 로 ETF 데이터를 먼저 수집해 주세요.
        </p>
      </div>
    );
  }
  if (!snap || !derived) return <div className="state-box">ETF 데이터를 불러오는 중…</div>;

  const value: AppData = {
    snap,
    byCode: derived.byCode,
    prefs,
    setPrefs,
    resetPrefs,
    rec: derived.rec,
    allScored: derived.all.ranked,
    scoreOf: (code) => derived.scoreMap.get(code),
    excludedBy: derived.excludedBy,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppData {
  const v = useContext(Ctx);
  if (!v) throw new Error("DataProvider 밖에서 useApp 을 호출했습니다.");
  return v;
}

// ───────── 지연 로딩 데이터(차트 시계열, 백테스트 요약) ─────────

function useLazy<T>(url: string): { data: T | null; error: boolean } {
  const [state, setState] = useState<{ data: T | null; error: boolean }>(() => ({ data: cache.get(url) as T | null ?? null, error: false }));
  useEffect(() => {
    if (cache.has(url)) return;
    let alive = true;
    getJson<T>(url)
      .then((d) => {
        cache.set(url, d);
        if (alive) setState({ data: d, error: false });
      })
      .catch(() => alive && setState({ data: null, error: true }));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}
const cache = new Map<string, unknown>();

export const useSeries = () => useLazy<SeriesFile>("./data/series.json");
export const useBacktest = () => useLazy<BacktestSummary>("./data/backtest.json");
/** 구성종목(겹침 분석). 약 1MB 라 겹침 화면에서만 지연 로딩한다. */
export const useHoldings = () => useLazy<HoldingsFile>("./data/holdings.json");
